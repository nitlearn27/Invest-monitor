// "The market vs my buying" — the data behind MarketVsBuys on the Consolidated
// tab. Answers the question the cap donuts can't: how did the mid- and
// small-cap MARKET actually move, and what was I putting in each month while it
// moved?
//
// The market proxy is a plain index fund's NAV history, not a hand-fed index
// series: mfapi.in is already wired up (CORS-enabled, cached, never throws), the
// funds track the exact segments in question, and a Direct-plan index fund is
// the closest tradeable stand-in for the index itself. Both have daily history
// back to 2020-21, which outruns the user's transaction sheets.
import { navOn } from './navs.js'
import { capOf } from './monthly.js'

// Scheme codes are pinned deliberately: this series must not change shape
// because the user bought or sold a fund. Colors are the cap colors the donuts
// already use, so a segment keeps one identity across the tab.
export const MARKET_SEGMENTS = [
  { key: 'mid', label: 'Mid Cap', market: 'Nifty Midcap 150', schemeCode: 148726, color: '#22c7a9' },
  { key: 'small', label: 'Small Cap', market: 'Nifty Smallcap 250', schemeCode: 148519, color: '#ffb454' },
]

export const MARKET_CODES = MARKET_SEGMENTS.map((s) => s.schemeCode)

const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
const monthLabel = (d) => d.toLocaleString('en-IN', { month: 'short', year: 'numeric' })

// Last calendar day of a month — the level the month CLOSED at, which is what
// "how did mid cap do in June" means. The current month closes at today.
function monthEnd(y, m, now) {
  const end = new Date(y, m + 1, 0)
  return end > now ? now : end
}

// Opening-balance rows carry units without money moving (see classify.js), and
// SELLs aren't buying — neither belongs in "what I put in this month".
const isBuy = (t) => t.side === 'BUY' && t.date && !t.opening

// Build the aligned month grid: market close level per segment + rupees the
// user put into that segment, for every month in the window.
//
// `months` counts back from the current month. A month with no purchases is a
// real zero (the bars are contributions, and not buying IS the fact worth
// seeing); a month the index has no history for is null and the line breaks
// there rather than inventing a level.
export function marketVsBuys(navMap, mfTxns = [], { months = 24, now = new Date() } = {}) {
  const segs = MARKET_SEGMENTS.map((s) => ({ ...s, history: navMap?.get(s.schemeCode)?.history || null }))

  const buys = new Map()
  for (const t of mfTxns) {
    if (!isBuy(t)) continue
    const cap = capOf(t.name).key
    if (!segs.some((s) => s.key === cap)) continue
    const k = monthKey(t.date)
    if (!buys.has(k)) buys.set(k, {})
    const row = buys.get(k)
    row[cap] = (row[cap] || 0) + (t.amount || 0)
  }

  const rows = []
  const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1)
  for (let i = 0; i < months; i += 1) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1)
    const key = monthKey(d)
    const close = monthEnd(d.getFullYear(), d.getMonth(), now)
    const row = { month: key, label: monthLabel(d), level: {}, invested: {}, total: 0 }
    for (const s of segs) {
      // navOn clamps to the oldest entry, so a month that predates the index
      // fund would otherwise report its launch NAV as that month's level.
      const older = s.history?.length ? close < new Date(s.history[s.history.length - 1].t) : true
      row.level[s.key] = older ? null : navOn(s.history, close)
      const amt = buys.get(key)?.[s.key] || 0
      row.invested[s.key] = amt
      row.total += amt
    }
    rows.push(row)
  }

  // Rebase each segment to 100 at the first month it has a level for, so the
  // two segments share one axis and the chart compares SHAPE, not NAV size.
  const base = {}
  for (const s of segs) {
    const first = rows.find((r) => r.level[s.key] != null)
    base[s.key] = first ? first.level[s.key] : null
  }
  for (const r of rows) {
    r.rebased = {}
    r.change = {}
    for (const s of segs) {
      const lv = r.level[s.key]
      r.rebased[s.key] = lv != null && base[s.key] ? (lv / base[s.key]) * 100 : null
    }
  }
  // Month-on-month % move, from the previous month that actually had a level.
  for (let i = 0; i < rows.length; i += 1) {
    for (const s of segs) {
      const cur = rows[i].level[s.key]
      const prev = i > 0 ? rows[i - 1].level[s.key] : null
      rows[i].change[s.key] = cur != null && prev ? ((cur - prev) / prev) * 100 : null
    }
  }

  const summary = segs.map((s) => {
    const withLevel = rows.filter((r) => r.level[s.key] != null)
    const first = withLevel[0]?.level[s.key] ?? null
    const last = withLevel[withLevel.length - 1]?.level[s.key] ?? null
    return {
      key: s.key,
      label: s.label,
      market: s.market,
      color: s.color,
      ready: !!s.history,
      move: first && last ? ((last - first) / first) * 100 : null,
      invested: rows.reduce((a, r) => a + r.invested[s.key], 0),
    }
  })

  // Drop `history` from the returned segments — it's megabytes of NAV rows
  // and the chart only needs the label/colour metadata.
  return { rows, segments: segs.map((s) => ({ key: s.key, label: s.label, market: s.market, color: s.color })), summary }
}
