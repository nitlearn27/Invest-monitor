// The goal card: the total corpus — what everything you hold is worth today,
// profits included — against the long-term goal, with the invested line beneath
// it so the gap between the two reads as profit. Two charts: the journey (corpus
// valued day by day on a goal-scaled axis, continued as a dashed projection that
// compounds your monthly investment at an assumed return) and the monthly
// investment pace. Data from lib/goal.js; hand-rolled SVG like MfWhatIf.
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { goalProgress, projectToGoal } from '../lib/goal.js'
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

// Journey chart: corpus (filled) and invested (thin line) on a y-axis that
// always spans the whole goal — the gap left to close is the subject, not the
// recent wiggle — continuing as the dashed compounded projection.
function JourneyChart({ g, projection }) {
  const wrapRef = useRef(null)
  const width = useWidth(wrapRef)
  const height = width < 480 ? 210 : 260
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
function PaceChart({ months, avg }) {
  const wrapRef = useRef(null)
  const width = useWidth(wrapRef)
  const height = 150
  const pad = { l: 4, r: 4, t: 14, b: 20 }

  const shown = months.slice(-MONTH_BARS)
  const max = Math.max(...shown.map((m) => Math.abs(m.added)), avg, 1)
  const plotH = height - pad.t - pad.b
  const slot = (width - pad.l - pad.r) / shown.length
  const barW = Math.max(6, Math.min(30, slot * 0.62))
  const y0 = pad.t + plotH

  return (
    <div ref={wrapRef} className="gtrack__chart">
      <svg width={width} height={height}>
        {shown.map((m, i) => {
          const h = Math.max(1, (Math.abs(m.added) / max) * plotH)
          const cx = pad.l + slot * (i + 0.5)
          const last = i === shown.length - 1
          return (
            <g key={m.month}>
              <rect
                x={cx - barW / 2}
                y={y0 - h}
                width={barW}
                height={h}
                rx={3}
                fill={m.added < 0 ? 'var(--neg)' : CORPUS}
                opacity={last ? 1 : 0.45}
              >
                <title>{`${m.label}: ${formatINR(m.added)}`}</title>
              </rect>
              {(shown.length - 1 - i) % 2 === 0 && (
                <text x={cx} y={height - 6} textAnchor="middle" className="gtrack__tick">
                  {m.label.split(' ')[0]}
                </text>
              )}
              {last && (
                <text x={cx} y={y0 - h - 5} textAnchor="middle" className="gtrack__barval">
                  {formatINRCompact(m.added)}
                </text>
              )}
            </g>
          )
        })}
        {avg > 0 && (
          <line
            x1={pad.l}
            x2={width - pad.r}
            y1={y0 - (avg / max) * plotH}
            y2={y0 - (avg / max) * plotH}
            className="gtrack__avgline"
          />
        )}
        <line x1={pad.l} x2={width - pad.r} y1={y0} y2={y0} className="gtrack__grid" />
      </svg>
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
}) {
  const g = useMemo(
    () => goalProgress({ transactions, mfTransactions, holdings, navMap, priceHistory, goal }),
    [transactions, mfTransactions, holdings, navMap, priceHistory, goal],
  )
  // The plan the projection runs on: what you'll put in each month (seeded from
  // your own 6-month pace) and the return you assume it earns.
  const [planned, setPlanned] = useState(null)
  const [rate, setRate] = useState(0.1)

  const monthly = planned ?? (g ? Math.round(g.avg6 / 1000) * 1000 : 0)
  const projection = useMemo(
    () => (g ? projectToGoal({ current: g.currentValue, goal: g.goal, monthly, annualReturn: rate }) : null),
    [g, monthly, rate],
  )
  if (!g) return null

  const { thisMonth, lastMonth, growth } = g
  const step = g.goal / 5
  const gainPos = g.gain >= 0

  return (
    <div className="card gtrack">
      {/* Invested is the headline — it's the number the user acts on. The corpus
          sits below it, since that's what the goal is measured against. */}
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
        <div className="gtrack__bar-fill" style={{ width: `${g.pct}%` }} />
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className="gtrack__tickmark" style={{ left: `${i * 20}%` }}>
            <span className="gtrack__tickmark-label">{formatINRCompact(step * i)}</span>
          </span>
        ))}
      </div>

      <div className="gtrack__kpis">
        {lastMonth?.valueEnd != null && (
          <div className="gtrack__kpi">
            <span className="gtrack__kpi-label">Corpus end of {lastMonth.label}</span>
            <span className="gtrack__kpi-val">{formatINR(Math.round(lastMonth.valueEnd))}</span>
          </div>
        )}
        {growth && (
          <div className="gtrack__kpi">
            <span className="gtrack__kpi-label">Corpus grew this month</span>
            <span className={`gtrack__kpi-val ${growth.total >= 0 ? 'pos' : 'neg'}`}>
              {growth.total >= 0 ? '▲' : '▼'} {formatINR(Math.round(Math.abs(growth.total)))}
              <span className="gtrack__kpi-sub">
                {' '}
                {formatINRCompact(growth.added)} in · {formatINRCompact(growth.market)} market
              </span>
            </span>
          </div>
        )}
        <div className="gtrack__kpi">
          <span className="gtrack__kpi-label">Invested this month · {thisMonth.label}</span>
          <span className="gtrack__kpi-val">{formatINR(Math.round(thisMonth.added))}</span>
        </div>
        {lastMonth && (
          <div className="gtrack__kpi">
            <span className="gtrack__kpi-label">Invested last month · {lastMonth.label}</span>
            <span className="gtrack__kpi-val">{formatINR(Math.round(lastMonth.added))}</span>
          </div>
        )}
        <div className="gtrack__kpi">
          <span className="gtrack__kpi-label">Avg invested · 6 mo</span>
          <span className="gtrack__kpi-val">{formatINR(Math.round(g.avg6))}</span>
        </div>
      </div>

      <div className="gtrack__plan">
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
        {planned != null && Math.round(g.avg6 / 1000) * 1000 !== planned && (
          <button className="gtrack__plan-reset" onClick={() => setPlanned(null)}>
            reset to my pace
          </button>
        )}
        {projection && (
          <div className="gtrack__eta">
            <span className="gtrack__eta-label">reaches {formatINRCompact(g.goal)} in</span>
            <span className="gtrack__eta-date">
              {projection.date ? monthYear(projection.date) : 'beyond 48 yrs'}
              {projection.monthsNeeded && (
                <span className="gtrack__eta-yrs"> · {(projection.monthsNeeded / 12).toFixed(1)} yrs</span>
              )}
            </span>
          </div>
        )}
      </div>

      <div className="gtrack__charts">
        <section className="gtrack__pane">
          <div className="gtrack__pane-head">
            <h4 className="gtrack__pane-title">Journey to the goal</h4>
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

        <section className="gtrack__pane gtrack__pane--narrow">
          <div className="gtrack__pane-head">
            <h4 className="gtrack__pane-title">Monthly investment</h4>
            <span className="gtrack__pane-note">last {Math.min(MONTH_BARS, g.months.length)} months</span>
          </div>
          <PaceChart months={g.months} avg={g.avg6} />
        </section>
      </div>
    </div>
  )
}
