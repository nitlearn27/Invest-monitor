// Source/platform colour coding key. Holding rows are tinted by the broker
// platform they came from (see lib/sourceStyle.js); this legend maps the colours
// back to names. Renders nothing when no source maps to a known platform.
//
// When `onSelect` is provided the items become toggle buttons that filter rows by
// platform (`active` = selected platform key, or null for "all").
import { platformOf } from '../config.js'

// Distinct platforms present in `sources` (a list of source strings).
function distinct(sources) {
  const seen = []
  for (const s of sources || []) {
    const p = platformOf(s)
    if (p && !seen.some((x) => x.key === p.key)) seen.push(p)
  }
  return seen
}

export default function SourceLegend({ sources, active = null, onSelect }) {
  const platforms = distinct(sources)
  if (platforms.length === 0) return null

  // Static colour key (no filtering wired up).
  if (!onSelect) {
    return (
      <div className="src-legend">
        {platforms.map((p) => (
          <span className="src-legend__item" key={p.key}>
            <span className="src-legend__dot" style={{ background: p.color }} />
            {p.label}
          </span>
        ))}
      </div>
    )
  }

  // Interactive filter: tap a platform to show only it; tap again to clear.
  return (
    <div className="src-legend src-legend--filter" role="group" aria-label="Filter by source">
      {platforms.map((p) => {
        const on = active === p.key
        return (
          <button
            type="button"
            key={p.key}
            className={`src-legend__item src-legend__btn ${on ? 'is-active' : ''} ${
              active && !on ? 'is-dim' : ''
            }`}
            style={{ '--src': p.color }}
            aria-pressed={on}
            onClick={() => onSelect(on ? null : p.key)}
          >
            <span className="src-legend__dot" style={{ background: p.color }} />
            {p.label}
          </button>
        )
      })}
    </div>
  )
}
