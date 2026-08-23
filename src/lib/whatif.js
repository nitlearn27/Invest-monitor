// "What-if" analysis of buying decisions — `whatIfByCategory` for mutual funds
// (one card per market-cap category) and `equityWhatIf` for stocks/ETFs (one
// card per asset class). Both emit the SAME card shape, so WhatIfCard.jsx draws
// the Mutual Funds, Stocks and ETF tabs with one renderer.
//
// --- Mutual funds, per market-cap category ------------------------------------
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
import { priceOn } from './quotes.js'

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
  const scheme = schemeFor(name, source)
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
    // A fund with no scheme match can't be valued, so its buys are left out of
    // the replay entirely rather than counted as money in that then shows zero
    // value — that would make "Your buys" look worse than it was. Such funds are
    // named on the card (and already console.warn from navs.js).
    const indAll = []
    const unpriced = []
    for (const f of [...investedByFund.values()].sort((a, b) => b.amount - a.amount)) {
      const p = priceable(f.name, f.amount, TXN_SOURCE, navMap)
      if (p) indAll.push(p)
      else unpriced.push(f.name)
    }

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

    const priced = cat.txns.filter((t) => indAll.some((f) => nameKey(f.name) === nameKey(t.name)))
    const included = priced.filter((t) => t.date.getTime() >= histStart)
    const excluded = priced.length - included.length
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
    const trend = funds.map((f) => {
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
      unpriced,
      samples,
      invested,
      actual,
      alts,
      trend,
      excluded,
      txnCount: included.length,
      investedTotal: investedSoFar,
    })
  }

  // Biggest categories first.
  return out.sort((a, b) => b.investedTotal - a.investedTotal)
}

// --- Equities (stocks / ETFs) -------------------------------------------------
//
// The same question the MF cards ask, put to one asset class instead of one
// market-cap category: replay the money the user actually put in, on the days
// they put it in, into each of the top few scrips they own, and see which
// vehicle would have carried it best. A price-trend view (each scrip rebased to
// 100, buys marked) shows what the decisions were made against.
//
// Two things differ from the fund side, both because equities have no plans and
// no broker-specific pricing:
//   * BOTH equity brokers keep a transaction sheet, so every buy here is a real
//     cashflow. A scrip is the same scrip wherever it was bought, so candidates
//     are deduped by SYMBOL and each carries every broker it was traded on —
//     which is why colour is keyed to the scrip's rank, with no dash encoding.
//   * Sells are real. Money in is therefore NET of sale proceeds and the
//     counterfactual receives exactly the same cashflow on the same day, so a
//     position that was closed out still reports its profit (in the shrunken
//     "money in") instead of vanishing along with its units.
//
// Prices come from quotes.js's daily-close history (Yahoo, ~5 years) — the same
// series the goal chart values past holdings with.

const PICKS = 4 // charted candidates: "top 4 stocks" / "top 4 ETFs"

const symKeyOf = (x) => (x.symbol ? String(x.symbol).trim().toUpperCase() : `~${nameKey(x.name)}`)

const historyOf = (symbol, priceHistory) => {
  const s = symbol ? priceHistory?.get?.(String(symbol).trim().toUpperCase()) : null
  return s?.t?.length ? s : null
}

// Point-to-point price return over `days`, annualised past a year. Mirrors
// periodReturn, including the guard that the history actually reaches back —
// priceOn returns null before its first close, and a window that starts in that
// void would otherwise be scored off a shorter span than it claims.
function periodReturnPx(hist, days, nowT, annualised) {
  const then = nowT - days * DAY
  if (hist.t[0] > then + 7 * DAY) return null
  const base = priceOn(hist, new Date(then))
  const latest = priceOn(hist, new Date(nowT))
  if (!base || !latest) return null
  const r = latest / base - 1
  return annualised ? (1 + r) ** (365 / days) - 1 : r
}

// One card for the whole asset class (returned as an array so the section
// component maps it exactly like the MF categories).
export function equityWhatIf({
  transactions = [],
  holdings = [],
  priceHistory = null,
  type = 'stock',
  label = 'Stocks',
  now = new Date(),
} = {}) {
  if (!priceHistory?.size) return []
  const nowT = now.getTime()

  // Real money movements only. Opening-balance rows carry a position, not a
  // purchase, and their date is invented (see classify.js) — replaying one
  // would put a cashflow on the timeline that never happened.
  const txns = transactions
    .filter((t) => t.type === type && t.date && !t.opening && t.qty > 0 && t.price > 0)
    .sort((a, b) => a.date - b.date)
  if (!txns.length) return []

  // One entry per scrip, ranked by money put in, carrying every broker it was
  // traded through.
  const positions = new Map()
  for (const t of txns) {
    const k = symKeyOf(t)
    if (!positions.has(k)) {
      positions.set(k, { key: k, name: t.name, symbol: t.symbol || null, sources: [], bought: 0 })
    }
    const p = positions.get(k)
    if (!p.sources.includes(t.source)) p.sources.push(t.source)
    if (t.side !== 'SELL') p.bought += t.qty * t.price
  }

  const all = []
  const unpriced = []
  for (const p of [...positions.values()].sort((a, b) => b.bought - a.bought)) {
    const hist = historyOf(p.symbol, priceHistory)
    if (hist) all.push({ ...p, hist })
    else unpriced.push(p.name)
  }
  if (!all.length) return []

  const funds = all.slice(0, PICKS).map((p, slot) => ({ ...p, slot }))
  const charted = new Map(funds.map((f) => [f.key, f]))

  // The replay can only start where every charted scrip already has a price;
  // earlier buys are counted and named rather than silently valued at nothing.
  const histStart = Math.max(...funds.map((f) => f.hist.t[0]))
  const pricedKeys = new Set(all.map((p) => p.key))
  const priced = txns.filter((t) => pricedKeys.has(symKeyOf(t)))
  const included = priced.filter((t) => t.date.getTime() >= histStart)
  if (!included.length) return []
  const excluded = priced.length - included.length

  const txnTimes = included.map((t) => t.date.getTime())
  const samples = sampleTimes(txnTimes[0], txnTimes, nowT)

  const held = new Map(all.map((p) => [p.key, { hist: p.hist, qty: 0 }]))
  const altQty = funds.map(() => 0)
  let netIn = 0
  let grossIn = 0
  let buyCount = 0
  let sellCount = 0
  let ti = 0

  const invested = []
  const actual = []
  const alts = funds.map((f) => ({ name: f.name, symbol: f.symbol, sources: f.sources, slot: f.slot, values: [] }))

  for (const s of samples) {
    while (ti < included.length && txnTimes[ti] <= s) {
      const t = included[ti++]
      const amount = t.qty * t.price
      const own = held.get(symKeyOf(t))
      const sell = t.side === 'SELL'
      if (sell) {
        netIn -= amount
        sellCount += 1
        if (own) own.qty = Math.max(0, own.qty - t.qty)
      } else {
        netIn += amount
        grossIn += amount
        buyCount += 1
        if (own) own.qty += t.qty
      }
      // The counterfactual moves the same rupees on the same day. It can't sell
      // what it never accumulated, so a redemption larger than the simulated
      // position just empties it.
      funds.forEach((f, i) => {
        const px = priceOn(f.hist, t.date)
        if (!px) return
        altQty[i] = sell ? Math.max(0, altQty[i] - amount / px) : altQty[i] + amount / px
      })
    }
    const d = new Date(s)
    invested.push(netIn)
    actual.push([...held.values()].reduce((sum, a) => sum + a.qty * (priceOn(a.hist, d) || 0), 0))
    funds.forEach((f, i) => alts[i].values.push(altQty[i] * (priceOn(f.hist, d) || 0)))
  }

  // Price trend: each scrip rebased to 100 at the first sample; dots on buys.
  const trend = funds.map((f) => {
    const base = priceOn(f.hist, new Date(samples[0]))
    const values = samples.map((s) => {
      const px = priceOn(f.hist, new Date(s))
      return base && px ? (px / base) * 100 : null
    })
    const buys = included
      .filter((t) => t.side !== 'SELL' && symKeyOf(t) === f.key)
      .map((t) => {
        const px = priceOn(f.hist, t.date)
        return { t: t.date.getTime(), v: base && px ? (px / base) * 100 : null, amount: t.qty * t.price }
      })
      .filter((b) => b.v != null)
    return { name: f.name, symbol: f.symbol, sources: f.sources, slot: f.slot, values, buys }
  })

  // Returns leaderboard: every scrip of this class the user has traded or still
  // holds, on any broker, deduped by symbol — not just the four charted.
  const rows = new Map()
  const addRow = (key, name, sources, hist) => {
    if (!hist) return
    const row = rows.get(key)
    if (row) {
      for (const s of sources) if (!row.sources.includes(s)) row.sources.push(s)
      return
    }
    const returns = {}
    for (const w of RETURN_WINDOWS) returns[w.key] = periodReturnPx(hist, w.days, nowT, w.annualised)
    const chart = charted.get(key)
    rows.set(key, {
      code: key,
      name,
      sources: [...sources],
      charted: Boolean(chart),
      slot: chart?.slot ?? null,
      returns,
    })
  }
  for (const p of all) addRow(p.key, p.name, p.sources, p.hist)
  for (const h of holdings) {
    if (h.type !== type) continue
    addRow(symKeyOf(h), h.name, [h.source], historyOf(h.symbol, priceHistory))
  }
  const rank = (r) => r.returns['1y'] ?? r.returns['6m'] ?? -Infinity
  const returnRows = [...rows.values()].sort((a, b) => rank(b) - rank(a))

  return [
    {
      key: type,
      label,
      funds: funds.map((f) => ({ name: f.name, symbol: f.symbol, sources: f.sources, slot: f.slot })),
      returnRows,
      // Traded scrips that didn't make the chart — their buys still sit inside
      // "Your buys" and the invested total.
      unchartedActual: all.slice(PICKS).map((p) => p.name),
      unpriced,
      samples,
      invested,
      actual,
      alts,
      trend,
      excluded,
      txnCount: buyCount,
      sellCount,
      investedTotal: grossIn,
    },
  ]
}
