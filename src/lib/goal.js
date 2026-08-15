// Corpus-vs-goal tracking for the Consolidated page.
//
// The goal is on the TOTAL CORPUS — what the portfolio is worth today, profits
// included — so the headline series is market value, valued day by day:
//
//   value(d) = Σ (units held on d × price on d)
//
// Units held come from the transaction sheets; prices come from the same two
// history sources the rest of the app already uses — mfapi NAV history (navs.js)
// for funds and Yahoo daily closes (quotes.js `fetchPriceHistory`) for
// stocks/ETFs. Nothing is extrapolated: a sample where a held asset has history
// but not that far back is left null, and the corpus line simply starts later
// than the invested line.
//
// The invested (cost) series is kept alongside as the second line — money put
// in, using the same running-average sell accounting as derive.js — so the gap
// between the two lines is the profit.
//
// Assets whose broker has no transaction sheet (Axis/Coin holdings), or that no
// price history could be found for, can't be placed on a timeline; each source
// carries a constant offset for whatever its transactions don't explain, so both
// series end exactly on the Total Portfolio card's Current / Invested figures
// while every month-over-month change still comes from a real transaction.
import { schemeFor } from './navs.js'

const DAY = 24 * 60 * 60 * 1000
const EPS = 1e-6
const low = (s) => String(s || '').trim().toLowerCase()
const pad2 = (n) => String(n).padStart(2, '0')
const monthKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
const monthLabel = (d) => d.toLocaleString('en-IN', { month: 'short', year: 'numeric' })
const monthStart = (t) => {
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

// One record per (source, scrip/fund) — the same grain derive.js aggregates at,
// so a scrip held on two platforms stays two positions and each source can be
// level-matched against its own holdings sheet.
function buildAssets(equityTxns, mfTxns) {
  const assets = new Map()
  const add = (key, seed, ev) => {
    if (!assets.has(key)) assets.set(key, { ...seed, events: [] })
    assets.get(key).events.push(ev)
  }

  for (const t of equityTxns) {
    if (!t.date) continue
    const symbol = t.symbol || null
    add(
      `e:${t.source}:${symbol || low(t.name)}`,
      { mf: false, cls: t.type === 'etf' ? 'etf' : 'stock', name: t.name, symbol, source: t.source },
      { t: t.date.getTime(), sell: t.side === 'SELL', qty: t.qty || 0, price: t.price || 0 },
    )
  }
  for (const t of mfTxns) {
    if (!t.date) continue
    add(
      `m:${t.source}:${low(t.name)}`,
      { mf: true, cls: 'mf', name: t.name, symbol: null, source: t.source },
      { t: t.date.getTime(), sell: t.side === 'SELL', qty: t.units, amount: t.amount || 0 },
    )
  }

  for (const a of assets.values()) a.events.sort((x, y) => x.t - y.t)
  return [...assets.values()]
}

// Running units + cost basis at every sample. BUY adds cost, SELL releases it at
// the running average (mirrors derive.js, so the endpoints agree).
function walkPosition(events, samples) {
  const qty = []
  const cost = []
  let q = 0
  let c = 0
  let i = 0
  for (const s of samples) {
    while (i < events.length && events[i].t <= s) {
      const e = events[i++]
      if (e.sell) {
        if (e.qty != null && q > EPS) {
          const sold = Math.min(e.qty, q)
          c -= sold * (c / q)
          q -= sold
        } else {
          c -= e.amount || 0
        }
      } else {
        q += e.qty || 0
        c += e.amount != null ? e.amount : e.qty * e.price
      }
    }
    qty.push(q)
    cost.push(c)
  }
  return { qty, cost }
}

// Price at every sample from an ascending history, carrying the last known close
// forward; null until the history starts. Samples are ascending, so one cursor
// walks the whole series.
function walkPrice(ts, px, samples) {
  const out = []
  let i = -1
  for (const s of samples) {
    while (i + 1 < ts.length && ts[i + 1] <= s) i++
    out.push(i >= 0 ? px[i] : null)
  }
  return out
}

// Ascending { t, c } history for an asset, or null when we have no prices for it.
function historyFor(asset, navMap, priceHistory) {
  if (asset.mf) {
    const code = schemeFor(asset.name)?.schemeCode
    const hist = code != null ? navMap?.get?.(code)?.history : null
    if (!hist?.length) return null
    const t = []
    const c = []
    for (let i = hist.length - 1; i >= 0; i--) {
      t.push(hist[i].t)
      c.push(hist[i].nav)
    }
    return { t, c }
  }
  const s = asset.symbol ? priceHistory?.get?.(String(asset.symbol).trim().toUpperCase()) : null
  return s?.t?.length ? s : null
}

// Sample grid: every transaction date and month start, daily over the last 6
// months and weekly before that — dense where the user looks, cheap over years.
function gridSamples(t0, tNow, eventTimes) {
  const set = new Set(eventTimes.filter((t) => t <= tNow))
  const dailyFrom = tNow - 182 * DAY
  for (let t = t0; t <= tNow; t += t >= dailyFrom ? DAY : 7 * DAY) set.add(t)
  for (let m = monthStart(t0); m.getTime() <= tNow; m.setMonth(m.getMonth() + 1)) set.add(m.getTime())
  set.add(t0)
  set.add(tNow)
  return [...set].sort((a, b) => a - b)
}

// Positions the timeline can't see. A broker with no transaction sheet (Axis,
// Coin) has its whole value in the constant baseline offset, so it contributes
// exactly zero month-over-month movement — which is why its funds never showed
// up among the movers. Price them for THIS MONTH only, holding units constant:
// a one-month assumption we can stand behind, unlike back-projecting today's
// units across years of history (which is why the long corpus series still
// carries them flat). Levels are scaled off the holding's live `current`, so
// these rows stay tied to the Total Portfolio card.
function estimateMonthMovers(holdings, baselineSources, navMap, priceHistory, openT, tNow) {
  const estimated = []
  const unpriced = []
  const srcs = new Set(baselineSources)
  for (const h of holdings) {
    if (!srcs.has(h.source)) continue
    const close = h.current != null ? h.current : h.invested || 0
    if (!(close > 0)) continue
    const hist = historyFor({ mf: h.type === 'mf', name: h.name, symbol: h.symbol }, navMap, priceHistory)
    const px = hist ? walkPrice(hist.t, hist.c, [openT, tNow]) : null
    if (!px || !(px[0] > 0) || !(px[1] > 0)) {
      unpriced.push({ name: h.name, source: h.source, value: close })
      continue
    }
    const open = close * (px[0] / px[1])
    estimated.push({
      name: h.name,
      source: h.source,
      cls: h.type,
      estimated: true,
      open,
      added: 0,
      close,
      market: close - open,
    })
  }
  return { estimated, unpriced }
}

const mean = (xs) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : 0)

// Projection horizon: 12 years of chart. A slower plan still reports its real
// ETA in text, the line just runs to the edge.
const MAX_PROJECTED_MONTHS = 144

export function goalProgress({
  transactions = [],
  mfTransactions = [],
  holdings = [],
  navMap = null,
  priceHistory = null,
  goal = 0,
  now = new Date(),
}) {
  const assets = buildAssets(transactions, mfTransactions)
  if (!assets.length) return null

  const tNow = now.getTime()
  const eventTimes = assets.flatMap((a) => a.events.map((e) => e.t))
  const t0 = Math.min(...eventTimes)
  if (!Number.isFinite(t0) || t0 > tNow) return null
  const samples = gridSamples(t0, tNow, eventTimes)
  const n = samples.length

  const invested = new Array(n).fill(0)
  const value = new Array(n).fill(0)
  const pricedAt = new Array(n).fill(true) // false = a held asset has no price yet
  const costNow = new Map() // source -> cost basis today
  const valueNow = new Map() // source -> market value today
  let anyPriced = false
  let carriedAtCost = 0 // positions we could find no history for at all

  // Last sample of the previous month — the opening line for "what happened this
  // month", per position (see `detail` below).
  const curMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  let openIdx = -1
  for (let i = 0; i < n; i++) if (samples[i] < curMonthStart) openIdx = i
  const movers = []

  for (const a of assets) {
    const { qty, cost } = walkPosition(a.events, samples)
    const hist = historyFor(a, navMap, priceHistory)
    const px = hist ? walkPrice(hist.t, hist.c, samples) : null
    if (px) anyPriced = true
    else if (qty[n - 1] > EPS) carriedAtCost += 1

    // Valuation at one sample: market value while held and priced, cost
    // otherwise. The fold below and the level-match must both use this — a
    // closed position keeps whatever cost the running average left behind (a
    // redemption whose buys predate the sheet leaves a negative remainder), and
    // valuing it at 0 in one place and at cost in the other put the corpus
    // endpoint off the Total Portfolio card by exactly that remainder.
    const valAt = (i) => (qty[i] <= EPS || !px || px[i] == null ? cost[i] : qty[i] * px[i])

    if (openIdx >= 0) {
      const open = valAt(openIdx)
      const close = valAt(n - 1)
      const added = cost[n - 1] - cost[openIdx]
      if (open > EPS || close > EPS || Math.abs(added) > EPS) {
        movers.push({
          name: a.name,
          source: a.source,
          cls: a.cls,
          priced: !!px,
          open,
          added,
          close,
          market: close - open - added,
        })
      }
    }

    for (let i = 0; i < n; i++) {
      invested[i] += cost[i]
      if (qty[i] <= EPS) {
        value[i] += cost[i] // residual cost on a closed position, if any
        continue
      }
      if (px && px[i] != null) value[i] += qty[i] * px[i]
      else if (px) pricedAt[i] = false
      else value[i] += cost[i]
    }
    costNow.set(a.source, (costNow.get(a.source) || 0) + cost[n - 1])
    valueNow.set(a.source, (valueNow.get(a.source) || 0) + valAt(n - 1))
  }

  // Level-match both series to the portfolio totals, per source.
  let baseCost = 0
  let baseValue = 0
  const baselineSources = []
  const holdCost = new Map()
  const holdValue = new Map()
  for (const h of holdings) {
    holdCost.set(h.source, (holdCost.get(h.source) || 0) + (h.invested || 0))
    holdValue.set(h.source, (holdValue.get(h.source) || 0) + (h.current != null ? h.current : h.invested || 0))
  }
  for (const [src, cost] of holdCost) {
    baseCost += cost - (costNow.get(src) || 0)
    baseValue += (holdValue.get(src) || 0) - (valueNow.get(src) || 0)
    if (!costNow.has(src) && cost > 0) baselineSources.push(src)
  }
  for (let i = 0; i < n; i++) {
    invested[i] += baseCost
    value[i] += baseValue
  }

  // The corpus line starts once every held position is priceable — no guessing
  // across a gap, and no broken segments.
  let valueFrom = 0
  for (let i = 0; i < n; i++) if (!pricedAt[i]) valueFrom = i + 1
  if (!anyPriced || valueFrom >= n) valueFrom = null
  const valueSeries = valueFrom == null ? null : value.map((v, i) => (i < valueFrom ? null : v))

  const currentInvested = invested[n - 1]
  const currentValue = value[n - 1]
  const gain = currentValue - currentInvested

  // Month rows: what went in (contributions, from transactions only) and what
  // the corpus was worth at the end of the month.
  const months = []
  let cursor = 0
  for (const d = monthStart(t0); d.getTime() <= tNow; d.setMonth(d.getMonth() + 1)) {
    const nextT = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()
    const before = cursor - 1 // last sample of the previous month
    while (cursor < n && samples[cursor] < nextT) cursor++
    const endIdx = cursor - 1
    months.push({
      month: monthKey(d),
      label: monthLabel(d),
      added: invested[endIdx] - (before >= 0 ? invested[before] : baseCost),
      end: invested[endIdx],
      valueEnd: valueFrom != null && endIdx >= valueFrom ? value[endIdx] : null,
    })
  }

  const thisMonth = months[months.length - 1]
  const lastMonth = months[months.length - 2] || null
  const complete = months.slice(0, -1) // the current month is still filling up
  const avg6 = mean(complete.slice(-6).map((m) => m.added))
  const avg12 = mean(complete.slice(-12).map((m) => m.added))

  // How the corpus moved this month, split into money added vs market movement.
  const growth =
    lastMonth?.valueEnd != null
      ? {
          from: lastMonth.valueEnd,
          total: currentValue - lastMonth.valueEnd,
          added: thisMonth.added,
          market: currentValue - lastMonth.valueEnd - thisMonth.added,
        }
      : null

  // The same month, position by position — what backs the "markets gave you X"
  // headline. Per-position levels come off the timeline only, so the constant
  // per-source offset (brokers with no transaction sheet, positions with no
  // price history) is reported separately as `untracked`; it never moves, so
  // every rupee of market movement here is real and the classes sum to
  // growth.market exactly.
  const detail =
    growth && openIdx >= 0 && valueFrom != null && openIdx >= valueFrom
      ? (() => {
          const { estimated, unpriced } = estimateMonthMovers(
            holdings,
            baselineSources,
            navMap,
            priceHistory,
            samples[openIdx],
            tNow,
          )
          const classes = new Map()
          for (const m of movers) {
            const c = classes.get(m.cls) || { key: m.cls, open: 0, added: 0, market: 0, close: 0 }
            c.open += m.open
            c.added += m.added
            c.market += m.market
            c.close += m.close
            classes.set(m.cls, c)
          }
          return {
            month: thisMonth.month,
            label: thisMonth.label,
            openValue: growth.from,
            openInvested: invested[openIdx],
            added: growth.added,
            market: growth.market,
            closeValue: currentValue,
            closeInvested: currentInvested,
            // Return on the money that was already working at the start of the
            // month — contributions land mid-month and haven't earned it.
            returnPct: growth.from > 0 ? (growth.market / growth.from) * 100 : null,
            untracked: baseValue,
            classes: [...classes.values()].sort((a, b) => b.close - a.close),
            // Every position that moved, both sides of the fence. `estimated`
            // rows are NOT in `market`/`classes` above — those must keep tying
            // to the corpus series — so the UI tags them and says so.
            movers: [...movers, ...estimated]
              .filter((m) => Math.abs(m.market) > 1)
              .sort((a, b) => Math.abs(b.market) - Math.abs(a.market)),
            estimatedMarket: estimated.reduce((a, m) => a + m.market, 0),
            estimatedCount: estimated.length,
            unpriced,
          }
        })()
      : null

  return {
    samples,
    invested,
    value: valueSeries,
    valueFrom,
    months,
    currentValue,
    currentInvested,
    gain,
    gainPct: currentInvested ? (gain / currentInvested) * 100 : null,
    goal,
    pct: goal > 0 ? Math.min(100, (currentValue / goal) * 100) : null,
    remaining: Math.max(0, goal - currentValue),
    thisMonth,
    lastMonth,
    growth,
    detail,
    avg6,
    avg12,
    baselineSources,
    carriedAtCost,
    now: tNow,
  }
}

// Compound the corpus forward: each month it grows at the assumed annual return
// and the monthly contribution lands at month end (the conservative order). The
// return rate is an assumption the user dials in — it is never used to value
// anything in the past, only to date the goal.
export function projectToGoal({ current, goal, monthly, annualReturn, now = new Date() }) {
  if (!(current >= 0) || goal <= current) return null
  const r = annualReturn > 0 ? (1 + annualReturn) ** (1 / 12) - 1 : 0
  if (monthly <= 0 && r <= 0) return null

  const at = (k) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    d.setMonth(d.getMonth() + k)
    return d
  }

  const points = [{ t: at(0).getTime(), v: current }]
  let v = current
  let monthsNeeded = null
  for (let k = 1; k <= MAX_PROJECTED_MONTHS * 4; k++) {
    v = v * (1 + r) + monthly
    if (k <= MAX_PROJECTED_MONTHS) points.push({ t: at(k).getTime(), v: Math.min(v, goal) })
    if (v >= goal) {
      monthsNeeded = k
      break
    }
  }
  if (monthsNeeded == null) return { monthly, annualReturn, monthsNeeded: null, date: null, points, truncated: true }

  // Contributions alone, for the "growth does this much of the work" read.
  const contributed = monthly * Math.min(monthsNeeded, MAX_PROJECTED_MONTHS * 4)
  return {
    monthly,
    annualReturn,
    monthsNeeded,
    date: at(monthsNeeded),
    points: points.slice(0, Math.min(monthsNeeded, MAX_PROJECTED_MONTHS) + 1),
    contributed,
    truncated: monthsNeeded > MAX_PROJECTED_MONTHS,
  }
}
