// Buying-pattern analysis for the Mutual Funds tab: per market-cap category,
// compare the value path of the user's actual INDmoney buys against "what if
// every one of those buys had gone into <other fund of the category>", plus a
// NAV-trend view (each fund rebased to 100, buys marked). Data from whatif.js.
import { useMemo, useRef, useState, useLayoutEffect } from 'react'
import { whatIfByCategory } from '../lib/whatif.js'
import { formatINR, formatINRCompact, formatDate } from '../lib/format.js'

// Series slots (validated for CVD + contrast on the app's dark navy surface).
// Slot 0 is always "Your buys"; funds take slots 1..3 in a frozen order, the
// same in both views — color follows the fund, never its rank.
const SLOTS = ['#5b8cff', '#18a3b8', '#c08618', '#e25663']
const SURFACE = '#0a1d38' // marker ring / crosshair contrast

const shortName = (name) =>
  name
    .replace(/\b(fund|direct|growth|plan|regular)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()

const DAY = 24 * 60 * 60 * 1000

// Trailing-window presets — one control above the cards scopes every chart.
const RANGES = [
  { key: '1m', label: '1M', days: 30 },
  { key: '3m', label: '3M', days: 91 },
  { key: '6m', label: '6M', days: 182 },
  { key: '1y', label: '1Y', days: 365 },
  { key: 'all', label: 'All', days: null },
]

// Month-level labels for long spans, day-level for short windows.
const tickLabel = (t, spanDays) =>
  spanDays <= 130
    ? new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short' })
    : new Date(t).toLocaleString('en-IN', { month: 'short', year: '2-digit' }).replace(' ', " '")

// Clean y-axis ticks: ~4 rounded steps spanning [min, max].
function niceTicks(min, max, count = 4) {
  const span = max - min || 1
  const step0 = span / count
  const mag = 10 ** Math.floor(Math.log10(step0))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0)
  const start = Math.ceil(min / step) * step
  const ticks = []
  for (let v = start; v <= max; v += step) ticks.push(v)
  return ticks
}

function useWidth(ref) {
  const [w, setW] = useState(640)
  useLayoutEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver((es) => setW(es[0].contentRect.width))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [ref])
  return w
}

// Generic multi-series line chart with crosshair + tooltip (hover, focus and
// arrow keys land on the nearest sample; every series is read out at that X).
function LineChart({ samples, series, markers = [], yFormat, zeroLine = false }) {
  const wrapRef = useRef(null)
  const width = useWidth(wrapRef)
  const height = width < 480 ? 180 : 230
  const [hover, setHover] = useState(null) // sample index

  const pad = { l: 8, r: 12, t: 10, b: 22 }
  const values = series.flatMap((s) => s.values).filter((v) => v != null)
  const vMin = Math.min(...values, zeroLine ? 0 : Infinity)
  const vMax = Math.max(...values)
  const yPad = (vMax - vMin || 1) * 0.06
  const y0 = vMin - yPad
  const y1 = vMax + yPad
  const t0 = samples[0]
  const t1 = samples[samples.length - 1]
  const x = (t) => pad.l + ((t - t0) / (t1 - t0 || 1)) * (width - pad.l - pad.r)
  const y = (v) => pad.t + (1 - (v - y0) / (y1 - y0)) * (height - pad.t - pad.b)

  const path = (vals) => {
    let d = ''
    vals.forEach((v, i) => {
      if (v == null) return
      d += `${d ? 'L' : 'M'}${x(samples[i]).toFixed(1)},${y(v).toFixed(1)}`
    })
    return d
  }

  const nearestIndex = (px) => {
    const t = t0 + ((px - pad.l) / (width - pad.l - pad.r || 1)) * (t1 - t0)
    let best = 0
    for (let i = 1; i < samples.length; i++) {
      if (Math.abs(samples[i] - t) < Math.abs(samples[best] - t)) best = i
    }
    return best
  }

  const onMove = (e) => {
    const rect = wrapRef.current.getBoundingClientRect()
    setHover(nearestIndex(e.clientX - rect.left))
  }
  const onKey = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const step = e.key === 'ArrowLeft' ? -1 : 1
    setHover((h) => Math.min(samples.length - 1, Math.max(0, (h ?? samples.length - 1) + step)))
  }

  const yTicks = niceTicks(y0, y1)
  // X ticks are spread evenly in TIME then snapped to the nearest sample — the
  // sample grid is denser near today, so even indices would bunch rightwards.
  const xTickCount = width < 480 ? 3 : 5
  const xTicks = [
    ...new Set(
      Array.from({ length: xTickCount }, (_, i) => {
        const target = t0 + (i * (t1 - t0)) / (xTickCount - 1)
        let best = 0
        for (let j = 1; j < samples.length; j++) {
          if (Math.abs(samples[j] - target) < Math.abs(samples[best] - target)) best = j
        }
        return best
      }),
    ),
  ]

  // Tooltip placement: flip to the left of the crosshair past mid-chart.
  const hx = hover != null ? x(samples[hover]) : 0
  const flip = hx > width / 2

  return (
    <div
      ref={wrapRef}
      className="whatif__chart"
      tabIndex={0}
      role="img"
      aria-label="Line chart; use left and right arrow keys to read values"
      onPointerMove={onMove}
      onPointerLeave={() => setHover(null)}
      onBlur={() => setHover(null)}
      onKeyDown={onKey}
    >
      <svg width={width} height={height}>
        {yTicks.map((v) => (
          <g key={v}>
            <line
              x1={pad.l}
              x2={width - pad.r}
              y1={y(v)}
              y2={y(v)}
              className={v === 0 && zeroLine ? 'whatif__grid whatif__grid--zero' : 'whatif__grid'}
            />
            <text x={pad.l} y={y(v) - 4} className="whatif__tick">
              {yFormat(v === 0 ? 0 : v)}
            </text>
          </g>
        ))}
        {xTicks.map((i) => (
          <text
            key={i}
            x={x(samples[i])}
            y={height - 6}
            textAnchor={i === 0 ? 'start' : i === samples.length - 1 ? 'end' : 'middle'}
            className="whatif__tick"
          >
            {tickLabel(samples[i], (t1 - t0) / DAY)}
          </text>
        ))}
        {series.map((s) => (
          <path
            key={s.name}
            d={path(s.values)}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {markers.map((m, i) => (
          <circle key={i} cx={x(m.t)} cy={y(m.v)} r={4.5} fill={m.color} stroke={SURFACE} strokeWidth={2} />
        ))}
        {hover != null && (
          <g>
            <line x1={hx} x2={hx} y1={pad.t} y2={height - pad.b} className="whatif__crosshair" />
            {series.map(
              (s) =>
                s.values[hover] != null && (
                  <circle key={s.name} cx={hx} cy={y(s.values[hover])} r={4} fill={s.color} stroke={SURFACE} strokeWidth={2} />
                ),
            )}
          </g>
        )}
      </svg>
      {hover != null && (
        <div
          className="whatif__tooltip"
          style={flip ? { right: width - hx + 10 } : { left: hx + 10 }}
        >
          <div className="whatif__tooltip-date">{formatDate(new Date(samples[hover]))}</div>
          {series.map(
            (s) =>
              s.values[hover] != null && (
                <div key={s.name} className="whatif__tooltip-row">
                  <span className="whatif__key" style={{ background: s.color }} />
                  <strong>{yFormat(s.values[hover])}</strong>
                  <span>{s.name}</span>
                </div>
              ),
          )}
        </div>
      )}
    </div>
  )
}

function CategoryCard({ cat, cutoff }) {
  const single = cat.funds.length < 2
  const [view, setView] = useState('nav') // nav | value — NAV trend is the default
  const mode = single ? 'nav' : view

  // Trailing-window slice. NAV series are rebased to 100 at the window start so
  // the comparison always reads from the visible origin; the samples always end
  // at today, so the final-value chips are window-independent.
  const win = useMemo(() => {
    if (!cutoff) return cat
    let i = cat.samples.findIndex((s) => s >= cutoff)
    if (i <= 0) return cat
    i = Math.min(i, cat.samples.length - 2) // keep at least 2 points
    const slice = (arr) => arr.slice(i)
    return {
      ...cat,
      samples: slice(cat.samples),
      invested: slice(cat.invested),
      actual: slice(cat.actual),
      alts: cat.alts.map((a) => ({ ...a, values: slice(a.values) })),
      nav: cat.nav.map((n) => {
        const base = n.values[i]
        const rebase = (v) => (v != null && base ? (v / base) * 100 : null)
        return {
          ...n,
          values: slice(n.values).map(rebase),
          buys: n.buys.filter((b) => b.t >= cat.samples[i]).map((b) => ({ ...b, v: rebase(b.v) })),
        }
      }),
    }
  }, [cat, cutoff])
  const last = win.samples.length - 1

  // Cashflows are identical across scenarios, so plot the GAIN over invested —
  // raw cumulative value is dominated by the contribution staircase and the
  // scenario lines become indistinguishable (verified on real data).
  const gains = (vals) => vals.map((v, i) => v - win.invested[i])
  const valueSeries = [
    { name: 'Your buys', color: SLOTS[0], values: gains(win.actual) },
    ...win.alts.map((a, i) => ({ name: `All-in ${shortName(a.name)}`, color: SLOTS[i + 1], values: gains(a.values) })),
  ]
  const navSeries = win.nav.map((n, i) => ({ name: shortName(n.name), color: SLOTS[i + 1], values: n.values }))
  const navMarkers = win.nav.flatMap((n, i) => n.buys.map((b) => ({ ...b, color: SLOTS[i + 1] })))

  const gain = (v) => (v - win.invested[last]) / win.invested[last]
  const scenarios = [
    { name: 'Your buys', color: SLOTS[0], final: win.actual[last] },
    ...win.alts.map((a, i) => ({ name: `All-in ${shortName(a.name)}`, color: SLOTS[i + 1], final: a.values[last] })),
  ]
  const best = Math.max(...scenarios.map((s) => s.final))

  return (
    <div className="card whatif__card">
      <div className="whatif__head">
        <div>
          <div className="card__title">{cat.label}</div>
          <div className="whatif__sub">
            {formatINR(cat.investedTotal)} across {cat.txnCount} buys
            {cat.excluded > 0 && ` · ${cat.excluded} older buy${cat.excluded > 1 ? 's' : ''} excluded (no NAV history)`}
            {single && ' · only fund in this category — nothing to compare'}
          </div>
        </div>
        {!single && (
          <div className="segmented segmented--sm">
            <button className={mode === 'nav' ? 'active' : ''} onClick={() => setView('nav')}>
              NAV trend
            </button>
            <button className={mode === 'value' ? 'active' : ''} onClick={() => setView('value')}>
              What-if gain
            </button>
          </div>
        )}
      </div>

      <div className="whatif__legend">
        {(mode === 'value' ? valueSeries : navSeries).map((s) => (
          <span key={s.name} className="whatif__legend-item">
            <span className="whatif__key" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
        {mode === 'nav' && (
          <span className="whatif__legend-item">
            <span className="whatif__dot" />
            your buys
          </span>
        )}
      </div>

      {mode === 'value' ? (
        <LineChart samples={win.samples} series={valueSeries} yFormat={formatINRCompact} zeroLine />
      ) : (
        <LineChart
          samples={win.samples}
          series={navSeries}
          markers={navMarkers}
          yFormat={(v) => v.toFixed(0)}
        />
      )}

      {mode === 'value' && (
        <div className="whatif__chips">
          {scenarios.map((s) => (
            <div key={s.name} className={`whatif__chip${s.final === best ? ' whatif__chip--best' : ''}`}>
              <span className="whatif__key" style={{ background: s.color }} />
              <span className="whatif__chip-name">{s.name}</span>
              <strong>{formatINRCompact(s.final)}</strong>
              <span className={gain(s.final) >= 0 ? 'pos' : 'neg'}>
                {(gain(s.final) * 100).toFixed(1)}%
              </span>
              {s.final === best && <span className="whatif__best">best</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function MfWhatIf({ mfTransactions = [], navMap }) {
  const cats = useMemo(() => whatIfByCategory(mfTransactions, navMap), [mfTransactions, navMap])
  const [range, setRange] = useState('6m')
  const [now] = useState(() => Date.now())
  if (!cats.length) return null

  const days = RANGES.find((r) => r.key === range)?.days
  const cutoff = days ? now - days * DAY : null

  return (
    <section className="whatif">
      <h2 className="section-title">Buying-pattern analysis</h2>
      <p className="whatif__intro">
        Each category shows the NAV trend of your funds (rebased to 100, dots mark your buys) — the
        prices your decisions were made against. Switch to What-if gain to replay your INDmoney
        buys as if every one had gone into a single fund of that category, and see whether the fund
        you picked was the right call.
      </p>
      <div className="whatif__filters">
        <div className="segmented segmented--sm" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button
              key={r.key}
              className={range === r.key ? 'active' : ''}
              onClick={() => setRange(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      {cats.map((c) => (
        <CategoryCard key={c.key} cat={c} cutoff={cutoff} />
      ))}
    </section>
  )
}
