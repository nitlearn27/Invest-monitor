// Derive portfolio totals and allocations from normalized holdings.
import { ASSET_TYPES, ASSET_COLORS } from '../config.js'
import { capOf } from './monthly.js'

const sum = (arr, f) => arr.reduce((a, x) => a + (f(x) || 0), 0)

// Distinct colors for individual stocks/ETFs in the equity allocation donut.
const EQUITY_COLORS = ['#5b8cff', '#2cc0d6', '#22c7a9', '#b07cff', '#ffbf63', '#ff7b86', '#7c9cff', '#4dd0a8', '#e7916b', '#6bd0e7']

// Stats for one set of holdings. `current` uses the reported current value where
// available and falls back to invested (at cost) for assets the export doesn't
// price, so totals stay comparable. `fullyPriced` is false when any holding
// lacked a current value (so the UI can note it).
function statsFor(items) {
  const invested = sum(items, (h) => h.invested)
  const priced = items.filter((h) => h.current != null)
  const anyCurrent = priced.length > 0
  const current = anyCurrent ? sum(items, (h) => (h.current != null ? h.current : h.invested)) : null
  const pnl = current != null ? current - invested : null
  return {
    invested,
    current,
    pnl,
    pnlPct: pnl != null && invested ? (pnl / invested) * 100 : null,
    anyCurrent,
    fullyPriced: anyCurrent && priced.length === items.length,
    count: items.length,
  }
}

// One card per asset class + a grand total, for the consolidated overview.
export function cardSummaries(holdings) {
  return {
    total: statsFor(holdings),
    mf: statsFor(byType(holdings, 'mf')),
    stocksEtfs: statsFor(holdings.filter((h) => h.type === 'stock' || h.type === 'etf')),
  }
}

// Allocation by asset class, weighted by invested value.
export function allocationByClass(holdings) {
  const total = sum(holdings, (h) => h.invested) || 1
  return Object.values(ASSET_TYPES)
    .map(({ key, label }) => {
      const items = holdings.filter((h) => h.type === key)
      const value = sum(items, (h) => h.invested)
      return {
        key,
        label,
        value,
        count: items.length,
        pct: (value / total) * 100,
        color: ASSET_COLORS[key],
      }
    })
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value) // largest class first (MF → … → Stocks)
}

export function byType(holdings, type) {
  return holdings.filter((h) => h.type === type)
}

// MF holdings grouped by market cap (Large/Mid/Small/ELSS/…), by invested value.
export function mfClassAllocation(holdings) {
  const mf = byType(holdings, 'mf')
  const total = sum(mf, (h) => h.invested) || 1
  const groups = new Map()
  for (const h of mf) {
    const c = capOf(h.name)
    if (!groups.has(c.key)) groups.set(c.key, { key: c.key, label: c.label, color: c.color, value: 0, count: 0 })
    const g = groups.get(c.key)
    g.value += h.invested || 0
    g.count += 1
  }
  return [...groups.values()].map((g) => ({ ...g, pct: (g.value / total) * 100 })).sort((a, b) => b.value - a.value)
}

// Each stock/ETF holding as its own slice, by invested value (first-word labels).
export function equityHoldingsAllocation(holdings) {
  const eq = holdings.filter((h) => h.type === 'stock' || h.type === 'etf')
  const total = sum(eq, (h) => h.invested) || 1
  return [...eq]
    .sort((a, b) => (b.invested || 0) - (a.invested || 0))
    .map((h, i) => ({
      key: h.name,
      label: (h.name || '').trim().split(/\s+/)[0],
      full: h.name,
      value: h.invested || 0,
      pct: ((h.invested || 0) / total) * 100,
      color: EQUITY_COLORS[i % EQUITY_COLORS.length],
    }))
}

export function topHoldings(holdings, n = 8) {
  return [...holdings].sort((a, b) => (b.invested || 0) - (a.invested || 0)).slice(0, n)
}
