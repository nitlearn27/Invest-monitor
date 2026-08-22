// The goal card: the total corpus — what everything you hold is worth today,
// profits included — against the long-term goal, with the invested line beneath
// it so the gap between the two reads as profit. Two charts: the journey (corpus
// valued day by day on a goal-scaled axis, continued as a dashed projection that
// compounds your monthly investment at an assumed return) and the monthly
// investment pace. Data from lib/goal.js; hand-rolled SVG like MfWhatIf.
//
// Reading order is deliberate: where you stand → what moved this month → the
// journey chart → the ETA (with the plan behind a disclosure, since it's a
// dial you set once, not a daily read) → the monthly pace. Sections are split
// by hairlines rather than nested boxes so the charts get the full width —
// on mobile the card chrome is dropped entirely (see App.css).
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { goalProgress, projectToGoal } from '../lib/goal.js'
import { marketVsBuys } from '../lib/market.js'
import ReturnSheet from './ReturnSheet.jsx'
import { CORPUS_GOAL } from '../config.js'
import { formatINR, formatINRCompact, formatPct, formatDate } from '../lib/format.js'

const CORPUS = '#5b8cff'
const INVESTED = '#9aa7c2'
const PROJECTED = '#22c7a9'
const GOAL_C = '#ffbf63'
const SURFACE = '#0a1d38'

const MONTH_BARS = 12
const RATES = [0.08, 0.1, 0.12]

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

const yearLabel = (t) => new Date(t).toLocaleString('en-IN', { month: 'short', year: '2-digit' }).replace(' ', " '")
const monthYear = (d) => d.toLocaleString('en-IN', { month: 'short', year: 'numeric' })

// ---- pulse-tile micro-visuals -------------------------------------------
// Each tile carries a small chart of its own number's history, so the three
// figures read as a picture of the month rather than three lines of text.

// Filled sparkline of the recent corpus, min–max scaled so the shape of the
// last few weeks is visible even when the move is 1% of the total.
function Spark({ values, color, height = 38 }) {
  const wrapRef = useRef(null)
  const width = useWidth(wrapRef)
  if (values.length < 2) return <div ref={wrapRef} className="gpulse__viz" style={{ height }} />

  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const x = (i) => (i / (values.length - 1)) * width
  const y = (v) => 3 + (1 - (v - min) / span) * (height - 8)
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')

  return (
    <div ref={wrapRef} className="gpulse__viz" style={{ height }}>
      <svg width={width} height={height} aria-hidden="true">
        <defs>
          <linearGradient id="gpulse-spark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.5" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line}L${width},${height}L0,${height}Z`} fill="url(#gpulse-spark)" />
        <path d={line} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
        <circle cx={width} cy={y(values[values.length - 1])} r="2.8" fill={color} />
      </svg>
    </div>
  )
}

// The last few months of contributions; the current month is the bright one.
function MiniBars({ values, color, height = 38 }) {
  const wrapRef = useRef(null)
  const width = useWidth(wrapRef)
  const max = Math.max(...values.map(Math.abs), 1)
  const slot = width / Math.max(values.length, 1)
  const barW = Math.max(4, Math.min(16, slot * 0.55))

  return (
    <div ref={wrapRef} className="gpulse__viz" style={{ height }}>
      <svg width={width} height={height} aria-hidden="true">
        {values.map((v, i) => {
          const h = Math.max(2, (Math.abs(v) / max) * (height - 6))
          return (
            <rect
              key={i}
              x={slot * (i + 0.5) - barW / 2}
              y={height - h}
              width={barW}
              height={h}
              rx={2}
              fill={color}
              opacity={i === values.length - 1 ? 1 : 0.32}
            />
          )
        })}
      </svg>
    </div>
  )
}

// This month's growth split into the part you paid for and the part the market
// handed over — the one visual that makes "markets gave" mean something.
function SplitBar({ added, market, height = 38 }) {
  const total = Math.abs(added) + Math.abs(market) || 1
  const pct = (v) => `${(Math.abs(v) / total) * 100}%`
  return (
    <div className="gpulse__viz gpulse__viz--split" style={{ height }}>
      <div className="gpulse__split">
        <span className="gpulse__split-seg gpulse__split-seg--you" style={{ width: pct(added) }} />
        <span
          className={`gpulse__split-seg gpulse__split-seg--${market >= 0 ? 'mkt' : 'loss'}`}
          style={{ width: pct(market) }}
        />
      </div>
      <div className="gpulse__split-key">
        <span>you {Math.round((Math.abs(added) / total) * 100)}%</span>
        <span>market {Math.round((Math.abs(market) / total) * 100)}%</span>
      </div>
    </div>
  )
}

// Journey chart: corpus (filled) and invested (thin line) on a y-axis that
// always spans the whole goal — the gap left to close is the subject, not the
// recent wiggle — continuing as the dashed compounded projection.
function JourneyChart({ g, projection }) {
  const wrapRef = useRef(null)
  const width = useWidth(wrapRef)
  const height = width < 480 ? 250 : 300
  const [hover, setHover] = useState(null)

  const pad = { l: 8, r: 12, t: 12, b: 22 }
  const t0 = g.samples[0]
  const t1 = projection ? projection.points[projection.points.length - 1].t : g.now
  const x = (t) => pad.l + ((t - t0) / (t1 - t0 || 1)) * (width - pad.l - pad.r)
  const y = (v) => pad.t + (1 - v / (g.goal * 1.04)) * (height - pad.t - pad.b)

  // One hoverable list: real samples up to today, then the projected months.
  const points = useMemo(
    () => [
      ...g.samples.map((t, i) => ({ t, i, projected: false })),
      ...(projection ? projection.points.slice(1).map((p) => ({ t: p.t, v: p.v, projected: true })) : []),
    ],
    [g.samples, projection],
  )

  const path = (values) => {
    let d = ''
    values.forEach((v, i) => {
      if (v == null) return
      d += `${d ? 'L' : 'M'}${x(g.samples[i]).toFixed(1)},${y(v).toFixed(1)}`
    })
    return d
  }
  const area = g.value
    ? `${path(g.value)}L${x(g.now).toFixed(1)},${y(0).toFixed(1)}L${x(g.samples[g.valueFrom]).toFixed(1)},${y(0).toFixed(1)}Z`
    : null

  const step = g.goal / 5
  const ticks = Array.from({ length: 5 }, (_, i) => step * (i + 1))
  const xTickCount = width < 480 ? 3 : 5
  const xTicks = Array.from({ length: xTickCount }, (_, i) => t0 + (i * (t1 - t0)) / (xTickCount - 1))

  const nearest = (px) => {
    const t = t0 + ((px - pad.l) / (width - pad.l - pad.r || 1)) * (t1 - t0)
    let best = 0
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(points[i].t - t) < Math.abs(points[best].t - t)) best = i
    }
    return best
  }
  const onMove = (e) => {
    const rect = wrapRef.current.getBoundingClientRect()
    setHover(nearest(e.clientX - rect.left))
  }
  const onKey = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const d = e.key === 'ArrowLeft' ? -1 : 1
    setHover((h) => Math.min(points.length - 1, Math.max(0, (h ?? g.samples.length - 1) + d)))
  }

  const hp = hover != null ? points[hover] : null
  // A projected point carries its own value; a real sample reads both series.
  const hCorpus = hp ? (hp.projected ? hp.v : (g.value?.[hp.i] ?? null)) : null
  const hInvested = hp && !hp.projected ? g.invested[hp.i] : null
  const hx = hp ? x(hp.t) : 0
  const flip = hx > width / 2

  return (
    <div
      ref={wrapRef}
      className="gtrack__chart"
      tabIndex={0}
      role="img"
      aria-label={`Total corpus ${formatINR(g.currentValue)} of a ${formatINRCompact(g.goal)} goal; use arrow keys to read the path`}
      onPointerMove={onMove}
      onPointerLeave={() => setHover(null)}
      onBlur={() => setHover(null)}
      onKeyDown={onKey}
    >
      <svg width={width} height={height}>
        <defs>
          <linearGradient id="gtrack-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CORPUS} stopOpacity="0.42" />
            <stop offset="100%" stopColor={CORPUS} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={pad.l}
              x2={width - pad.r}
              y1={y(v)}
              y2={y(v)}
              className={v === g.goal ? 'gtrack__grid gtrack__grid--goal' : 'gtrack__grid'}
            />
            <text x={pad.l} y={y(v) - 4} className={v === g.goal ? 'gtrack__tick gtrack__tick--goal' : 'gtrack__tick'}>
              {formatINRCompact(v)}
              {v === g.goal ? ' goal' : ''}
            </text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text
            key={t}
            x={x(t)}
            y={height - 6}
            textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
            className="gtrack__tick"
          >
            {yearLabel(t)}
          </text>
        ))}

        {area && <path d={area} fill="url(#gtrack-fill)" />}
        <path d={path(g.invested)} fill="none" stroke={INVESTED} strokeWidth={1.6} strokeLinejoin="round" />
        {g.value && <path d={path(g.value)} fill="none" stroke={CORPUS} strokeWidth={2.2} strokeLinejoin="round" />}
        {projection && (
          <path
            d={projection.points
              .map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`)
              .join('')}
            fill="none"
            stroke={PROJECTED}
            strokeWidth={2}
            strokeDasharray="5 5"
            strokeLinecap="round"
          />
        )}
        <circle cx={x(g.now)} cy={y(g.currentValue)} r={4.5} fill={CORPUS} stroke={SURFACE} strokeWidth={2} />

        {hp && (
          <g>
            <line x1={hx} x2={hx} y1={pad.t} y2={height - pad.b} className="gtrack__crosshair" />
            {hCorpus != null && (
              <circle
                cx={hx}
                cy={y(hCorpus)}
                r={4}
                fill={hp.projected ? PROJECTED : CORPUS}
                stroke={SURFACE}
                strokeWidth={2}
              />
            )}
            {hInvested != null && (
              <circle cx={hx} cy={y(hInvested)} r={3.5} fill={INVESTED} stroke={SURFACE} strokeWidth={2} />
            )}
          </g>
        )}
      </svg>

      {hp && (
        <div className="gtrack__tooltip" style={flip ? { right: width - hx + 10 } : { left: hx + 10 }}>
          <div className="gtrack__tooltip-date">
            {formatDate(new Date(hp.t))}
            {hp.projected && ' · projected'}
          </div>
          {hCorpus != null && (
            <div className="gtrack__tooltip-row">
              <span className="gtrack__key" style={{ '--k': hp.projected ? PROJECTED : CORPUS }} />
              <strong>{formatINR(Math.round(hCorpus))}</strong>
              <span>{((hCorpus / g.goal) * 100).toFixed(1)}% of goal</span>
            </div>
          )}
          {hInvested != null && (
            <>
              <div className="gtrack__tooltip-row">
                <span className="gtrack__key" style={{ '--k': INVESTED }} />
                <strong>{formatINR(Math.round(hInvested))}</strong>
                <span>invested</span>
              </div>
              {hCorpus != null && (
                <div className="gtrack__tooltip-row">
                  <span className="gtrack__key gtrack__key--ghost" />
                  <strong className={hCorpus - hInvested >= 0 ? 'pos' : 'neg'}>
                    {formatINR(Math.round(hCorpus - hInvested))}
                  </strong>
                  <span>gain</span>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// Pace chart: what actually went in, month by month — the "this month against
// last month" read — with the trailing average as a reference line.
//
// Two bands on ONE shared time axis:
//   top    — how the mid/small-cap MARKET moved (index-fund NAV, rebased to 100)
//   bottom — the monthly-total bars, each split into the mid/small slice of that
//            month's money and everything else
// Deliberately two bands rather than lines overlaid on the bars: rupees and
// index level share no unit, so drawing them against one y-scale would invent a
// correlation the data doesn't hold. One crosshair spans both, which is what
// makes "was I buying into a fall or a rally?" readable.
function PaceChart({ months, avg, market = null, split = null, segments = [] }) {
  const wrapRef = useRef(null)
  const width = useWidth(wrapRef)
  const [hover, setHover] = useState(null)

  const shown = months.slice(-MONTH_BARS)
  const hasMarket = !!market && shown.some((m) => market.get(m.month)?.rebased)

  const pad = { l: 4, r: 4, t: 22, b: 22 }
  const mktH = hasMarket ? 56 : 0
  const mktGap = hasMarket ? 18 : 0
  const barH = 132
  const mktTop = pad.t
  const mktBot = mktTop + mktH
  const y0 = mktBot + mktGap + barH
  const height = y0 + pad.b

  const max = Math.max(...shown.map((m) => Math.abs(m.added)), avg, 1)
  const slot = (width - pad.l - pad.r) / shown.length
  const barW = Math.max(8, Math.min(38, slot * 0.66))
  const avgY = y0 - (avg / max) * barH
  const cxOf = (i) => pad.l + slot * (i + 0.5)

  // Market band scale — both segments rebased to 100 at the window start, so
  // one axis carries both and the band compares shape, not NAV size.
  const mkt = useMemo(() => {
    if (!hasMarket) return null
    const vals = []
    for (const m of shown) {
      const r = market.get(m.month)?.rebased
      if (!r) continue
      for (const s of segments) if (r[s.key] != null) vals.push(r[s.key])
    }
    if (!vals.length) return null
    const lo = Math.min(...vals)
    const hi = Math.max(...vals)
    const padv = (hi - lo) * 0.16 || 4
    return { min: lo - padv, max: hi + padv }
  }, [hasMarket, shown, market, segments])

  const mY = (v) => mktBot - ((v - mkt.min) / (mkt.max - mkt.min || 1)) * mktH

  // Every bar carries its own value on top: no hunting in a tooltip, and the
  // "am I ahead of my usual month?" read is the bar against the average line.
  const labelEvery = slot < 34 ? 2 : 1
  const active = hover != null ? shown[hover] : null

  return (
    <div ref={wrapRef} className="gtrack__chart" onPointerLeave={() => setHover(null)}>
      <svg width={width} height={height}>
        <defs>
          <linearGradient id="gtrack-bar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CORPUS} stopOpacity="1" />
            <stop offset="100%" stopColor={CORPUS} stopOpacity="0.35" />
          </linearGradient>
        </defs>

        {/* ---- market band ---- */}
        {mkt && (
          <>
            <text x={pad.l} y={mktTop - 7} className="gtrack__bandlabel">
              Mid &amp; small cap market
            </text>
            {segments.map((s) => {
              const pts = shown.map((m, i) => {
                const v = market.get(m.month)?.rebased?.[s.key]
                return { v: v == null ? null : v, x: cxOf(i), y: v == null ? null : mY(v) }
              })
              // A month the index has no history for breaks the line rather
              // than joining across the gap.
              const runs = []
              let cur = []
              for (const p of pts) {
                if (p.v == null) {
                  if (cur.length) runs.push(cur)
                  cur = []
                } else cur.push(p)
              }
              if (cur.length) runs.push(cur)
              return (
                <g key={s.key}>
                  {runs.map((r, i) => (
                    <path
                      key={i}
                      d={r.map((p, j) => `${j ? 'L' : 'M'}${p.x} ${p.y}`).join(' ')}
                      fill="none"
                      stroke={s.color}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ))}
                  {hover != null && pts[hover]?.v != null && (
                    <circle cx={pts[hover].x} cy={pts[hover].y} r="4" fill={s.color} stroke="var(--bg)" strokeWidth="2" />
                  )}
                </g>
              )
            })}
            <line x1={pad.l} x2={width - pad.r} y1={mktBot + 7} y2={mktBot + 7} className="gtrack__grid" />
          </>
        )}

        {/* ---- monthly bars, split by cap ---- */}
        {avg > 0 && (
          <>
            <line x1={pad.l} x2={width - pad.r} y1={avgY} y2={avgY} className="gtrack__avgline" />
            <text x={width - pad.r} y={avgY - 5} textAnchor="end" className="gtrack__avglabel">
              6-mo avg {formatINRCompact(avg)}
            </text>
          </>
        )}
        {shown.map((m, i) => {
          const total = Math.abs(m.added)
          const h = Math.max(2, (total / max) * barH)
          const cx = cxOf(i)
          const last = i === shown.length - 1
          const on = hover === i || (hover == null && last)
          const parts = split?.get(m.month) || {}
          // Mid/small sit at the foot of the bar, the rest of the month's money
          // above them: the bar keeps its true total height (so the average line
          // still means what it did) while showing how much went to these two.
          // The stack is clamped to the bar it sits in: goal.js's `added` and the
          // MF transaction sum are computed independently, and a disagreement
          // must show as a full bar, never as a segment poking out the top.
          let acc = 0
          const stack = []
          for (const s of segments) {
            const v = parts[s.key] || 0
            if (v <= 0 || total <= 0) continue
            const sh = Math.min((v / max) * barH, h - acc)
            if (sh <= 0) break
            stack.push({ key: s.key, color: s.color, y: y0 - acc - sh, h: sh })
            acc += sh
          }
          const restH = Math.max(0, h - acc)
          return (
            <g key={m.month} onPointerEnter={() => setHover(i)}>
              <rect x={cx - slot / 2} y={mktTop} width={slot} height={y0 - mktTop} fill="transparent" />
              {restH > 0 && (
                <rect
                  x={cx - barW / 2}
                  y={y0 - acc - restH}
                  width={barW}
                  height={restH}
                  rx={4}
                  fill={m.added < 0 ? 'var(--neg)' : 'url(#gtrack-bar)'}
                  opacity={on ? 1 : 0.5}
                />
              )}
              {stack.map((s) => (
                <rect
                  key={s.key}
                  x={cx - barW / 2}
                  y={s.y}
                  width={barW}
                  height={Math.max(1, s.h - 1)}
                  rx={2}
                  fill={s.color}
                  opacity={on ? 0.95 : 0.45}
                />
              ))}
              {(shown.length - 1 - i) % labelEvery === 0 && (
                <text
                  x={cx}
                  y={height - 6}
                  textAnchor="middle"
                  className={on ? 'gtrack__tick gtrack__tick--on' : 'gtrack__tick'}
                >
                  {m.label.split(' ')[0]}
                </text>
              )}
              {on && (
                <text x={cx} y={y0 - h - 7} textAnchor="middle" className="gtrack__barval">
                  {formatINRCompact(m.added)}
                </text>
              )}
            </g>
          )
        })}
        {hover != null && mkt && (
          <line x1={cxOf(hover)} x2={cxOf(hover)} y1={mktTop} y2={y0} className="gtrack__cross" />
        )}
        <line x1={pad.l} x2={width - pad.r} y1={y0} y2={y0} className="gtrack__grid" />
      </svg>

      {active && mkt && (
        <div
          className="gtrack__mkttip"
          style={{ left: Math.min(Math.max(cxOf(hover), 88), Math.max(88, width - 88)), transform: 'translateX(-50%)' }}
        >
          <div className="gtrack__mkttip-head">
            <span>{active.label}</span>
            <span>{formatINRCompact(active.added)}</span>
          </div>
          {segments.map((s) => {
            const ch = market.get(active.month)?.change?.[s.key]
            const put = split?.get(active.month)?.[s.key] || 0
            return (
              <div key={s.key} className="gtrack__mkttip-row">
                <span className="gtrack__mkttip-dot" style={{ background: s.color }} />
                <span className="gtrack__mkttip-name">{s.label}</span>
                <span className={`gtrack__mkttip-mkt ${ch >= 0 ? 'pos' : 'neg'}`}>
                  {ch == null ? '—' : `${ch >= 0 ? '+' : ''}${ch.toFixed(1)}%`}
                </span>
                <span className="gtrack__mkttip-put">{put ? formatINRCompact(put) : '—'}</span>
              </div>
            )
          })}
          <div className="gtrack__mkttip-foot">market move · what you put in</div>
        </div>
      )}
    </div>
  )
}

export default function GoalTracker({
  holdings = [],
  transactions = [],
  mfTransactions = [],
  navMap = null,
  priceHistory = null,
  goal = CORPUS_GOAL,
  onOpenMonth = null,
}) {
  const g = useMemo(
    () => goalProgress({ transactions, mfTransactions, holdings, navMap, priceHistory, goal }),
    [transactions, mfTransactions, holdings, navMap, priceHistory, goal],
  )
  // The plan the projection runs on: what you'll put in each month (seeded from
  // your own 6-month pace) and the return you assume it earns.
  const [planned, setPlanned] = useState(null)
  const [rate, setRate] = useState(0.1)
  const [planOpen, setPlanOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)

  // Market band + per-cap split for the monthly-investment chart, keyed by
  // month so the chart stays driven by goal.js's own month rows.
  const pace = useMemo(() => {
    const { rows, segments } = marketVsBuys(navMap, mfTransactions, { months: MONTH_BARS })
    const market = new Map()
    const split = new Map()
    for (const r of rows) {
      market.set(r.month, { rebased: r.rebased, change: r.change })
      split.set(r.month, r.invested)
    }
    return { market, split, segments }
  }, [navMap, mfTransactions])

  const monthly = planned ?? (g ? Math.round(g.avg6 / 1000) * 1000 : 0)
  const projection = useMemo(
    () => (g ? projectToGoal({ current: g.currentValue, goal: g.goal, monthly, annualReturn: rate }) : null),
    [g, monthly, rate],
  )
  if (!g) return null

  const { thisMonth, lastMonth, growth } = g
  const step = g.goal / 5
  const gainPos = g.gain >= 0
  const atPace = Math.round(g.avg6 / 1000) * 1000

  // What moved since last month — the daily-visit read. Each figure carries its
  // own micro-chart and opens the detail behind it: the two money-in tiles jump
  // to the Monthly tab, the market tile opens the return breakdown.
  const signed = (v) => `${v >= 0 ? '▲' : '▼'} ${formatINR(Math.round(Math.abs(v)))}`
  const sparkValues = (g.value || []).slice(-70).filter((v) => v != null)
  const paceValues = g.months.slice(-6).map((m) => m.added)
  const pulse = [
    growth && {
      key: 'corpus',
      label: 'Corpus this month',
      value: signed(growth.total),
      tone: growth.total >= 0 ? 'pos' : 'neg',
      foot: `from ${formatINRCompact(growth.from)} at the end of ${lastMonth.label}`,
      viz: sparkValues.length > 1 ? <Spark values={sparkValues} color={CORPUS} /> : null,
      action: onOpenMonth && { label: 'Monthly', run: () => onOpenMonth(thisMonth.month) },
    },
    {
      key: 'added',
      label: `You put in · ${thisMonth.label}`,
      value: formatINR(Math.round(thisMonth.added)),
      foot: `${formatINRCompact(g.avg6)} a month on your 6-month pace`,
      viz: paceValues.length > 1 ? <MiniBars values={paceValues} color={INVESTED} /> : null,
      action: onOpenMonth && { label: 'Monthly', run: () => onOpenMonth(thisMonth.month) },
    },
    growth && {
      key: 'market',
      label: 'Markets gave',
      value: signed(growth.market),
      tone: growth.market >= 0 ? 'pos' : 'neg',
      foot:
        g.detail?.returnPct != null
          ? `${g.detail.returnPct >= 0 ? '+' : ''}${g.detail.returnPct.toFixed(2)}% on what you were holding`
          : 'growth on what you already hold',
      viz: <SplitBar added={growth.added} market={growth.market} />,
      action: g.detail && { label: 'Breakdown', run: () => setSheetOpen(true) },
    },
  ].filter(Boolean)

  return (
    <div className="card gtrack">
      {/* Invested is the headline — it's the number the user acts on. The corpus
          sits below it, since that's what the goal is measured against. */}
      <div className="gtrack__top">
        <div className="gtrack__hero">
          <span className="gtrack__now">{formatINR(Math.round(g.currentInvested))}</span>
          <span className="gtrack__now-label">invested</span>
          <span className={`gtrack__gain ${gainPos ? 'pos' : 'neg'}`}>
            {gainPos ? '▲' : '▼'} {formatINR(Math.round(Math.abs(g.gain)))}
            <span className="gtrack__gain-pct">{formatPct(g.gainPct)}</span>
          </span>
        </div>
        <div className="gtrack__split">
          <span className="gtrack__split-item">
            <span className="gtrack__key" style={{ '--k': CORPUS }} />
            Corpus <strong>{formatINR(Math.round(g.currentValue))}</strong>
          </span>
          <span className="gtrack__split-item gtrack__pct">
            {g.pct.toFixed(1)}% of {formatINRCompact(g.goal)}
          </span>
          <span className="gtrack__split-item">{formatINRCompact(g.remaining)} to go</span>
        </div>

        <div className="gtrack__bar" role="img" aria-label={`${g.pct.toFixed(1)} percent of the goal reached`}>
          <div className="gtrack__bar-fill" style={{ width: `${g.pct}%` }}>
            <span className="gtrack__bar-knob" />
          </div>
          {[1, 2, 3, 4].map((i) => (
            <span key={i} className="gtrack__tickmark" style={{ left: `${i * 20}%` }}>
              <span className="gtrack__tickmark-label">{formatINRCompact(step * i)}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="gtrack__pulse">
        {pulse.map((p) => {
          const Tag = p.action ? 'button' : 'div'
          return (
            <Tag
              key={p.key}
              className={`gpulse gpulse--${p.key}`}
              {...(p.action ? { type: 'button', onClick: p.action.run } : {})}
            >
              <span className="gpulse__top">
                <span className="gpulse__label">{p.label}</span>
                {p.action && <span className="gpulse__go">{p.action.label}</span>}
              </span>
              <span className={`gpulse__val ${p.tone || ''}`}>{p.value}</span>
              {p.viz}
              <span className="gpulse__foot">{p.foot}</span>
            </Tag>
          )
        })}
      </div>

      <section className="gtrack__section">
        <div className="gtrack__section-head">
          <h4 className="gtrack__section-title">Journey to {formatINRCompact(g.goal)}</h4>
          <div className="gtrack__legend">
            <span className="gtrack__legend-item">
              <span className="gtrack__key" style={{ '--k': CORPUS }} /> corpus
            </span>
            <span className="gtrack__legend-item">
              <span className="gtrack__key" style={{ '--k': INVESTED }} /> invested
            </span>
            {projection && (
              <span className="gtrack__legend-item">
                <span className="gtrack__key gtrack__key--dash" style={{ '--k': PROJECTED }} /> projected
              </span>
            )}
            <span className="gtrack__legend-item">
              <span className="gtrack__key" style={{ '--k': GOAL_C }} /> goal
            </span>
          </div>
        </div>
        <JourneyChart g={g} projection={projection} />
      </section>

      {/* The ETA is the payoff of the dashed line above, so it sits right under
          it. The plan behind it (amount + assumed return) is a dial you set
          once — tucked behind the summary chip until tapped. */}
      <section className="gtrack__section">
        <div className="gtrack__eta">
          <span className="gtrack__eta-main">
            {projection ? (
              <>
                <span className="gtrack__eta-label">On this pace you hit {formatINRCompact(g.goal)} by</span>
                <span className="gtrack__eta-date">
                  {projection.date ? monthYear(projection.date) : 'beyond 48 yrs'}
                  {projection.monthsNeeded && (
                    <span className="gtrack__eta-yrs">{(projection.monthsNeeded / 12).toFixed(1)} yrs away</span>
                  )}
                </span>
              </>
            ) : (
              <>
                <span className="gtrack__eta-label">No date yet</span>
                <span className="gtrack__eta-date">Set a monthly amount</span>
              </>
            )}
          </span>
          <button
            className={`gtrack__eta-toggle ${planOpen ? 'open' : ''}`}
            onClick={() => setPlanOpen((o) => !o)}
            aria-expanded={planOpen}
          >
            {formatINRCompact(monthly)}/mo · {(rate * 100).toFixed(0)}%
            <span className="gtrack__caret" aria-hidden="true" />
          </button>
        </div>

        {planOpen && (
          <div className="gtrack__planbox">
            <label className="gtrack__plan-field">
              <span className="gtrack__plan-label">Investing every month</span>
              <input
                className="gtrack__plan-input"
                type="number"
                min="0"
                step="5000"
                value={monthly}
                onChange={(e) => setPlanned(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
            <div className="gtrack__plan-field">
              <span className="gtrack__plan-label">Assumed return</span>
              <div className="segmented segmented--sm" role="group" aria-label="Assumed annual return">
                {RATES.map((r) => (
                  <button key={r} className={rate === r ? 'active' : ''} onClick={() => setRate(r)}>
                    {(r * 100).toFixed(0)}%
                  </button>
                ))}
              </div>
            </div>
            {planned != null && atPace !== planned && (
              <button className="gtrack__plan-reset" onClick={() => setPlanned(null)}>
                reset to my pace ({formatINRCompact(atPace)})
              </button>
            )}
          </div>
        )}
      </section>

      <section className="gtrack__section">
        <div className="gtrack__section-head">
          <h4 className="gtrack__section-title">Monthly investment</h4>
          <span className="gtrack__section-note">last {Math.min(MONTH_BARS, g.months.length)} months</span>
        </div>
        <PaceChart
          months={g.months}
          avg={g.avg6}
          market={pace.market}
          split={pace.split}
          segments={pace.segments}
        />
      </section>

      {sheetOpen && <ReturnSheet detail={g.detail} onClose={() => setSheetOpen(false)} />}
    </div>
  )
}
