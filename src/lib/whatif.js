// "What-if" analysis of MF buying decisions, per market-cap category.
//
// For each category (mid/small/large/ELSS/…) take the user's actual INDmoney
// BUY transactions and simulate the counterfactuals: the same cashflows, on the
// same dates, invested entirely in each candidate fund of that category.
// Comparing the value paths answers "was picking fund A over fund B the right
// call?". A NAV-trend view (each fund rebased to 100, buys marked) shows the
// underlying price movement the decisions were made against.
//
// Candidates are drawn from TWO brokers — the top `PICKS_PER_SOURCE` funds of
// the category on INDmoney and on Coin. Only INDmoney has a transaction sheet,
// so it alone supplies the cashflows and the "Your buys" line; Coin funds are
// comparison-only (their weight comes from the holdings snapshot's invested
// amount). A fund held on both is charted once, under INDmoney.
//
// Pure: consumes the enriched mfTransactions + holdings + the navMap from
// fetchNavs. NAV history is trimmed (HISTORY_KEEP in navs.js, ~4 years), so
// transactions older than any charted fund's history are excluded from the
// simulation (counted in `excluded`) — otherwise the comparison would be unfair
// to the funds without data that far back.

import { capOf } from './monthly.js'
import { schemeFor, navOn } from './navs.js'

const DAY = 24 * 60 * 60 * 1000

// Charted funds per broker. Two each keeps the line count readable (4 funds +
// "Your buys") while still covering both platforms.
const PICKS_PER_SOURCE = 2

const TXN_SOURCE = 'My MFs' // INDmoney MF transactions — the only cashflow sheet
const HOLDING_SOURCE = 'My MF Coin' // Coin holdings snapshot — comparison only

// Trailing windows for the per-category returns leaderboard. Anything past a
// year is annualised, so every number in the strip stays on the same scale
// (a raw 3Y figure would dwarf the rest and break the visual comparison).
export const RETURN_WINDOWS = [
  { key: '1m', label: '1M', days: 30 },
  { key: '3m', label: '3M', days: 91 },
  { key: '6m', label: '6M', days: 182 },
  { key: '1y', label: '1Y', days: 365 },
  { key: '3y', label: '3Y', days: 1095, annualised: true },
]

const nameKey = (n) => (n || '').trim().toLowerCase()

// Resolve a fund to its AMFI scheme + NAV history. Returns null when the fund
// can't be priced, which is also what makes it uncharteable.
function priceable(name, weight, source, navMap) {
  const scheme = schemeFor(name)
  const nav = scheme ? navMap.get(scheme.schemeCode) : null
  if (!nav?.history?.length) return null
  return { name, weight, source, nav, code: scheme.schemeCode, plan: scheme.plan }
}

// Point-to-point NAV return over `days`, annualised past a year. Null when the
// trimmed history doesn't reach back far enough — navOn would silently clamp to
// the oldest entry and report a too-short window as if it were the full one.
function periodReturn(history, days, nowT, annualised) {
  const then = nowT - days * DAY
  const oldest = history[history.length - 1]
  if (oldest.t > then + 7 * DAY) return null
  const base = navOn(history, new Date(then))
  const latest = navOn(history, new Date(nowT))
  if (!base || !latest) return null
  const r = latest / base - 1
  return annualised ? (1 + r) ** (365 / days) - 1 : r
}

// Sample grid + every txn date + today, ascending and deduped. Denser near the
// present (daily for the last month, every 3 days for the last quarter, weekly
// before that) so the short trailing-window filters still draw a smooth line.
function sampleTimes(start, txnTimes, now) {
  const ts = new Set(txnTimes)
  for (let t = start; t < now; t += 7 * DAY) if (t < now - 90 * DAY) ts.add(t)
  for (let t = Math.max(start, now - 90 * DAY); t < now - 30 * DAY; t += 3 * DAY) ts.add(t)
  for (let t = Math.max(start, now - 30 * DAY); t < now; t += DAY) ts.add(t)
  ts.add(now)
  return [...ts].sort((a, b) => a - b)
}

export function whatIfByCategory(mfTransactions = [], navMap, holdings = [], now = new Date()) {
  if (!navMap?.size) return []
  const nowT = now.getTime()

  // Actual INDmoney buys, oldest first.
  const buys = mfTransactions
    .filter((t) => t.source === TXN_SOURCE && t.side === 'BUY' && t.date && t.amount)
    .sort((a, b) => a.date - b.date)

  // Every MF holding bucketed by the same market-cap rule as the transactions.
  // Coin supplies chart candidates; all brokers feed the returns leaderboard.
  const mfByCat = new Map()
  for (const h of holdings) {
    if (h.type !== 'mf') continue
    const key = capOf(h.name).key
    if (!mfByCat.has(key)) mfByCat.set(key, [])
    mfByCat.get(key).push(h)
  }

  // Group the buys by market-cap category.
  const byCat = new Map()
  for (const t of buys) {
    const cap = capOf(t.name)
    if (!byCat.has(cap.key)) byCat.set(cap.key, { key: cap.key, label: cap.label, txns: [] })
    byCat.get(cap.key).txns.push(t)
  }

  const out = []
  for (const cat of byCat.values()) {
    // Every INDmoney fund transacted in this category, ordered by amount
    // invested. All of them value the "Your buys" line — even the ones that
    // don't make the chart — so the actual scenario stays whole.
    const investedByFund = new Map()
    for (const t of cat.txns) {
      const k = nameKey(t.name)
      if (!investedByFund.has(k)) investedByFund.set(k, { name: t.name, amount: 0 })
      investedByFund.get(k).amount += t.amount
    }
    const indAll = [...investedByFund.values()]
      .sort((a, b) => b.amount - a.amount)
      .map((f) => priceable(f.name, f.amount, TXN_SOURCE, navMap))
      .filter(Boolean)

    // No priceable INDmoney fund means no cashflow to replay — the card would
    // pit a flat "Your buys" line against the alternatives. Only happens when a
    // fund is missing from resources/mf-schemes.json, which already warns.
    if (!indAll.length) continue

    // Charted candidates: top N per broker (slot order stays frozen within a
    // broker — colour follows the fund, never its rank across brokers).
    const funds = indAll.slice(0, PICKS_PER_SOURCE).map((f, slot) => ({ ...f, slot }))
    const charted = new Map(funds.map((f) => [f.code, f]))

    // The simulation window is set by the funds that own the cashflows. A Coin
    // candidate launched later can't be replayed across it, so skip to the next
    // one — truncating everyone's history to match a new arrival would throw
    // away years of comparison, or drop the category entirely. Such a fund
    // still appears in the returns strip, where a short history just blanks the
    // longer columns instead of costing the whole card.
    const oldestOf = (f) => f.nav.history[f.nav.history.length - 1].t
    const histStart = Math.max(...funds.map(oldestOf))
    const coinCandidates = (mfByCat.get(cat.key) || [])
      .filter((h) => h.source === HOLDING_SOURCE)
      .sort((a, b) => (b.invested ?? 0) - (a.invested ?? 0))
    let coinSlot = 0
    for (const h of coinCandidates) {
      if (coinSlot >= PICKS_PER_SOURCE) break
      const f = priceable(h.name, h.invested ?? 0, HOLDING_SOURCE, navMap)
      if (!f || charted.has(f.code) || oldestOf(f) > histStart) continue
      funds.push({ ...f, slot: coinSlot })
      charted.set(f.code, funds[funds.length - 1])
      coinSlot += 1
    }

    // Returns leaderboard: EVERY fund of this category the user touches, across
    // all brokers — not just the four charted. Deduped by AMFI scheme code
    // (returns belong to the scheme, so one row can carry several brokers);
    // Direct and Regular plans are separate codes and stay separate rows.
    const rows = new Map()
    const addRow = (f) => {
      if (!f) return
      const row = rows.get(f.code)
      if (row) {
        if (!row.sources.includes(f.source)) row.sources.push(f.source)
        return
      }
      const returns = {}
      for (const w of RETURN_WINDOWS) returns[w.key] = periodReturn(f.nav.history, w.days, nowT, w.annualised)
      const chart = charted.get(f.code)
      rows.set(f.code, {
        code: f.code,
        name: f.name,
        plan: f.plan,
        sources: [f.source],
        charted: Boolean(chart),
        slot: chart?.slot ?? null,
        chartSource: chart?.source ?? null,
        returns,
      })
    }
    indAll.forEach(addRow)
    for (const h of mfByCat.get(cat.key) || []) addRow(priceable(h.name, h.invested ?? 0, h.source, navMap))

    // Leaderboard order: best 1Y first (6M as the tiebreak for funds too new
    // to have a year), unrateable funds last.
    const rank = (r) => r.returns['1y'] ?? r.returns['6m'] ?? -Infinity
    const returnRows = [...rows.values()].sort((a, b) => rank(b) - rank(a))

    const included = cat.txns.filter((t) => t.date.getTime() >= histStart)
    const excluded = cat.txns.length - included.length
    if (!included.length) continue

    const txnTimes = included.map((t) => t.date.getTime())
    const samples = sampleTimes(txnTimes[0], txnTimes, nowT)

    // Walk the sample grid once, accumulating invested + units per scenario.
    const held = new Map(indAll.map((f) => [nameKey(f.name), { nav: f.nav, units: 0 }]))
    const altUnits = funds.map(() => 0)
    let investedSoFar = 0
    let ti = 0

    const invested = []
    const actual = []
    const alts = funds.map((f) => ({ name: f.name, source: f.source, slot: f.slot, plan: f.plan, values: [] }))
    for (const s of samples) {
      while (ti < included.length && txnTimes[ti] <= s) {
        const t = included[ti]
        investedSoFar += t.amount
        const own = held.get(nameKey(t.name))
        if (own) {
          const nav = navOn(own.nav.history, t.date)
          own.units += t.units ?? (nav ? t.amount / nav : 0)
        }
        funds.forEach((f, i) => {
          const nav = navOn(f.nav.history, t.date)
          if (nav) altUnits[i] += t.amount / nav
        })
        ti += 1
      }
      const d = new Date(s)
      invested.push(investedSoFar)
      actual.push([...held.values()].reduce((sum, a) => sum + a.units * (navOn(a.nav.history, d) || 0), 0))
      funds.forEach((f, i) => alts[i].values.push(altUnits[i] * (navOn(f.nav.history, d) || 0)))
    }

    // NAV trend: each fund rebased to 100 at the first sample; dots on buys.
    // Only INDmoney funds carry buy markers — Coin has no transaction sheet.
    const nav = funds.map((f) => {
      const base = navOn(f.nav.history, new Date(samples[0]))
      const values = samples.map((s) => {
        const n = navOn(f.nav.history, new Date(s))
        return base && n ? (n / base) * 100 : null
      })
      const buysOfFund =
        f.source === TXN_SOURCE
          ? included
              .filter((t) => nameKey(t.name) === nameKey(f.name))
              .map((t) => {
                const n = navOn(f.nav.history, t.date)
                return { t: t.date.getTime(), v: base && n ? (n / base) * 100 : null, amount: t.amount }
              })
              .filter((b) => b.v != null)
          : []
      return { name: f.name, source: f.source, slot: f.slot, plan: f.plan, values, buys: buysOfFund }
    })

    out.push({
      key: cat.key,
      label: cat.label,
      funds: funds.map((f) => ({ name: f.name, source: f.source, slot: f.slot, plan: f.plan })),
      returnRows,
      // INDmoney funds bought in this category but not charted — their buys
      // still sit inside "Your buys" and the invested total.
      unchartedActual: indAll.slice(PICKS_PER_SOURCE).map((f) => f.name),
      samples,
      invested,
      actual,
      alts,
      nav,
      excluded,
      txnCount: included.length,
      investedTotal: investedSoFar,
    })
  }

  // Biggest categories first.
  return out.sort((a, b) => b.investedTotal - a.investedTotal)
}
