// Derive goal-vs-current figures for the Projection tab.
//
// Each projection row names one or more holding `source`s in its "Sheets" cell
// (space-joined, and the names themselves contain spaces — so we match against
// the known source set instead of splitting on whitespace). A goal's Current is
// the sum of the *current* value (never invested) of every holding from those
// sources; Shortfall is what's left to reach the Dec-2026 target.

// The `source` labels set by the parsers in classify.js.
const KNOWN_SOURCES = ['My MF Coin', 'My MFs', 'My Stocks', 'Axis Bank MF', 'MF Groww', 'Stocks Groww']

const sum = (arr, f) => arr.reduce((a, x) => a + (f(x) || 0), 0)

export function computeProjection(rows = [], holdings = []) {
  const items = rows.map((row) => {
    const matchedSources = KNOWN_SOURCES.filter((s) => row.sheetsRaw.includes(s))
    const tracked = matchedSources.length > 0
    const target2026 = row.target2026 || 0

    let current = null
    if (tracked) {
      const items = holdings.filter((h) => matchedSources.includes(h.source) && h.current != null)
      current = sum(items, (h) => h.current)
    }

    const met = current != null && target2026 > 0 && current >= target2026
    const shortfall = current != null ? Math.max(0, target2026 - current) : null
    const pct = current != null && target2026 > 0 ? Math.min(100, (current / target2026) * 100) : null

    return {
      name: row.name,
      baseline2025: row.baseline2025,
      target2026,
      sources: matchedSources,
      tracked,
      current,
      shortfall,
      met,
      pct,
    }
  })

  const trackedItems = items.filter((i) => i.tracked)
  const totalCurrent = sum(trackedItems, (i) => i.current)
  const totalTarget = sum(trackedItems, (i) => i.target2026)
  const totalShortfall = sum(trackedItems, (i) => i.shortfall)
  const totals = {
    current: totalCurrent,
    target2026: totalTarget,
    shortfall: totalShortfall,
    pct: totalTarget > 0 ? Math.min(100, (totalCurrent / totalTarget) * 100) : null,
    count: trackedItems.length,
  }

  return { items, totals }
}
