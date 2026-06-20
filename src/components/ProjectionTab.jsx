// Goal-tracking overview: current value vs. the Dec-2026 target per goal bucket,
// with the shortfall still to invest. Current values are summed from the holding
// sources named in each row's "Sheets" column (see lib/projection.js).
import { computeProjection } from '../lib/projection.js'
import { formatINR } from '../lib/format.js'
import { EmptyState } from './StateViews.jsx'

const pctStr = (v) => (v == null ? '—' : `${v.toFixed(1)}%`)

// Gradient fill: blue while in progress, green once the goal is met.
const fillBg = (item) =>
  item.met
    ? 'linear-gradient(90deg, var(--pos), #59e3b8)'
    : 'linear-gradient(90deg, var(--accent), var(--accent-2))'

// Order goals so the ones needing the most money show first; untracked last.
const byFocus = (a, b) => {
  if (a.tracked !== b.tracked) return a.tracked ? -1 : 1
  return (b.shortfall || 0) - (a.shortfall || 0)
}

export default function ProjectionTab({ rows = [], holdings = [] }) {
  if (!rows.length) {
    return (
      <div className="tab">
        <EmptyState title="No projection data">
          Add a “Projection” sheet to the Drive folder (Name · 2026-Dec target · Sheets), then Refresh.
        </EmptyState>
      </div>
    )
  }

  const { items, totals } = computeProjection(rows, holdings)

  return (
    <div className="tab">
      <div className="strip">
        <div className="strip__item">
          <span className="strip__label">Current (tracked)</span>
          <span className="strip__value">{formatINR(totals.current)}</span>
        </div>
        <div className="strip__item">
          <span className="strip__label">Dec-2026 goal</span>
          <span className="strip__value">{formatINR(totals.target2026)}</span>
        </div>
        <div className="strip__item">
          <span className="strip__label">Shortfall to invest</span>
          <span className="strip__value">{formatINR(totals.shortfall)}</span>
        </div>
        <div className="strip__item">
          <span className="strip__label">Progress to goal</span>
          <span className="strip__value">{pctStr(totals.pct)}</span>
        </div>
      </div>

      <h3 className="section-title">Progress to Dec-2026 goal</h3>
      <div className="goals">
        {[...items].sort(byFocus).map((item) => (
          <div className={`goal ${item.met ? 'goal--met' : ''} ${!item.tracked ? 'goal--untracked' : ''}`} key={item.name}>
            <div className="goal__head">
              <span className="goal__name">{item.name}</span>
              <span className="goal__pct">{pctStr(item.pct)}</span>
            </div>

            <div className="goal__remaining-block">
              {!item.tracked ? (
                <>
                  <span className="goal__remaining-label">Not tracked</span>
                  <span className="goal__remaining goal__remaining--muted">—</span>
                </>
              ) : item.met ? (
                <>
                  <span className="goal__remaining-label">Goal reached</span>
                  <span className="goal__remaining goal__remaining--met">✓ Goal met</span>
                </>
              ) : (
                <>
                  <span className="goal__remaining-label">Still to invest</span>
                  <span className="goal__remaining">{formatINR(item.shortfall)}</span>
                </>
              )}
            </div>

            <div className="goal__bar">
              <div className="goal__bar-fill" style={{ width: `${item.pct || 0}%`, background: fillBg(item) }} />
            </div>

            <div className="goal__foot">
              <span>
                <span className="goal__foot-label">Current</span> {item.tracked ? formatINR(item.current) : '—'}
              </span>
              <span>
                <span className="goal__foot-label">Goal</span> {formatINR(item.target2026)}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="table-wrap card">
        <table className="table">
          <thead>
            <tr>
              <th>Goal</th>
              <th className="ta-r">Dec 2025</th>
              <th className="ta-r">Current</th>
              <th className="ta-r">Dec 2026 goal</th>
              <th className="ta-r">Shortfall</th>
              <th className="ta-r">Progress</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.name}>
                <td>
                  <span className="cell-name">
                    {item.name}
                    {!item.tracked && <span className="badge badge--muted-badge">untracked</span>}
                  </span>
                </td>
                <td className="ta-r mono">{formatINR(item.baseline2025)}</td>
                <td className="ta-r">{item.tracked ? formatINR(item.current) : '—'}</td>
                <td className="ta-r">{formatINR(item.target2026)}</td>
                <td className="ta-r">
                  {!item.tracked ? (
                    '—'
                  ) : item.met ? (
                    <span className="badge badge--ok">Goal met</span>
                  ) : (
                    formatINR(item.shortfall)
                  )}
                </td>
                <td className="ta-r mono">{item.tracked ? pctStr(item.pct) : '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="table__total">
              <td>Total (tracked)</td>
              <td className="ta-r" />
              <td className="ta-r">{formatINR(totals.current)}</td>
              <td className="ta-r">{formatINR(totals.target2026)}</td>
              <td className="ta-r">{formatINR(totals.shortfall)}</td>
              <td className="ta-r">{pctStr(totals.pct)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
