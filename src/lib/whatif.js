// "What-if" analysis of MF buying decisions, per market-cap category.
//
// For each category (mid/small/large/ELSS/…) take the user's actual INDmoney
// BUY transactions and simulate the counterfactuals: the same cashflows, on the
// same dates, invested entirely in each single fund of that category. Comparing
// the value paths answers "was picking fund A over fund B the right call?".
// A NAV-trend view (each fund rebased to 100, buys marked) shows the underlying
// price movement the decisions were made against.
//
// Pure: consumes the enriched mfTransactions + the navMap from fetchNavs.
// NAV history is trimmed (HISTORY_KEEP in navs.js, ~4 years), so transactions
// older than any fund's history are excluded from the simulation (counted in
// `excluded`) — otherwise the comparison would be unfair to the funds without
// data that far back.

import { capOf } from './monthly.js'
import { schemeFor, navOn } from './navs.js'

const DAY = 24 * 60 * 60 * 1000

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

export function whatIfByCategory(mfTransactions = [], navMap, now = new Date()) {
  if (!navMap?.size) return []
  const nowT = now.getTime()

  // Actual INDmoney buys, oldest first.
  const buys = mfTransactions
    .filter((t) => t.source === 'My MFs' && t.side === 'BUY' && t.date && t.amount)
    .sort((a, b) => a.date - b.date)

  // Group by market-cap category.
  const byCat = new Map()
  for (const t of buys) {
    const cap = capOf(t.name)
    if (!byCat.has(cap.key)) byCat.set(cap.key, { key: cap.key, label: cap.label, txns: [] })
    byCat.get(cap.key).txns.push(t)
  }

  const out = []
  for (const cat of byCat.values()) {
    // Funds of the category = distinct funds the user transacted in, ordered by
    // total amount invested (slot order stays frozen — color follows the fund).
    const fundsByName = new Map()
    for (const t of cat.txns) {
      const k = t.name.trim().toLowerCase()
      if (!fundsByName.has(k)) fundsByName.set(k, { name: t.name, amount: 0 })
      fundsByName.get(k).amount += t.amount
    }
    const funds = [...fundsByName.values()]
      .sort((a, b) => b.amount - a.amount)
      .map((f) => ({ ...f, nav: navMap.get(schemeFor(f.name)?.schemeCode ?? -1) }))
      .filter((f) => f.nav?.history?.length)
      .slice(0, 3)
    if (!funds.length) continue

    // Simulation can only start where every fund has NAV history.
    const histStart = Math.max(...funds.map((f) => f.nav.history[f.nav.history.length - 1].t))
    const included = cat.txns.filter((t) => t.date.getTime() >= histStart)
    const excluded = cat.txns.length - included.length
    if (!included.length) continue

    const txnTimes = included.map((t) => t.date.getTime())
    const samples = sampleTimes(txnTimes[0], txnTimes, nowT)

    // Walk the sample grid once, accumulating invested + units per scenario.
    const isFund = (t, f) => t.name.trim().toLowerCase() === f.name.trim().toLowerCase()
    const actualUnits = new Map(funds.map((f) => [f.name, 0]))
    const altUnits = funds.map(() => 0)
    let investedSoFar = 0
    let ti = 0

    const invested = []
    const actual = []
    const alts = funds.map((f) => ({ name: f.name, values: [] }))
    for (const s of samples) {
      while (ti < included.length && txnTimes[ti] <= s) {
        const t = included[ti]
        investedSoFar += t.amount
        const own = funds.find((f) => isFund(t, f))
        if (own) {
          const nav = navOn(own.nav.history, t.date)
          const units = t.units ?? (nav ? t.amount / nav : 0)
          actualUnits.set(own.name, actualUnits.get(own.name) + units)
        }
        funds.forEach((f, i) => {
          const nav = navOn(f.nav.history, t.date)
          if (nav) altUnits[i] += t.amount / nav
        })
        ti += 1
      }
      invested.push(investedSoFar)
      actual.push(funds.reduce((sum, f) => sum + actualUnits.get(f.name) * (navOn(f.nav.history, new Date(s)) || 0), 0))
      funds.forEach((f, i) => alts[i].values.push(altUnits[i] * (navOn(f.nav.history, new Date(s)) || 0)))
    }

    // NAV trend: each fund rebased to 100 at the first sample; dots on buys.
    const nav = funds.map((f) => {
      const base = navOn(f.nav.history, new Date(samples[0]))
      const values = samples.map((s) => {
        const n = navOn(f.nav.history, new Date(s))
        return base && n ? (n / base) * 100 : null
      })
      const buysOfFund = included
        .filter((t) => isFund(t, f))
        .map((t) => {
          const n = navOn(f.nav.history, t.date)
          return { t: t.date.getTime(), v: base && n ? (n / base) * 100 : null, amount: t.amount }
        })
        .filter((b) => b.v != null)
      return { name: f.name, values, buys: buysOfFund }
    })

    out.push({
      key: cat.key,
      label: cat.label,
      funds: funds.map((f) => f.name),
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
