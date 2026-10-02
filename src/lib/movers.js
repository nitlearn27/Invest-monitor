import { schemeFor } from './navs.js'

const DAY = 24 * 60 * 60 * 1000
const WINDOW = 30 * DAY
const MAX_GAP = 7 * DAY // weekends and market holidays around the comparison date
const MAX_AGE = 7 * DAY // do not rank an old cached series as a current mover

function changeOver(points, latest, days, maxGap) {
  const target = latest.t - days * DAY
  const base = points.findLast(({ t }) => t <= target)
  if (!base || target - base.t > maxGap) return null
  return ((latest.price / base.price) - 1) * 100
}

function pointsFor(holding, navMap, priceHistory) {
  if (holding.type === 'mf') {
    const code = schemeFor(holding.name, holding.source)?.schemeCode
    const history = code == null ? null : navMap?.get?.(code)?.history
    if (!history?.length) return null
    return { key: `mf:${code}`, points: history.map(({ t, nav }) => ({ t, price: nav })) }
  }

  if (holding.type !== 'stock' && holding.type !== 'etf' && holding.type !== 'us_stock') return null
  const symbol = String(holding.symbol || '').trim().toUpperCase()
  const history = priceHistory?.get?.(symbol)
  if (!symbol || !history?.t?.length || history.t.length !== history.c?.length) return null
  return { key: `equity:${symbol}`, points: history.t.map((t, index) => ({ t, price: history.c[index] })) }
}

// One row per held instrument, even when it appears in several broker accounts.
// The comparison is between observed prices, never portfolio P&L or sheet values.
export function rankedMovers(holdings = [], navMap, priceHistory, now = new Date()) {
  const seen = new Set()
  const rows = []
  const nowT = now.getTime()

  for (const holding of holdings) {
    const series = pointsFor(holding, navMap, priceHistory)
    if (!series || seen.has(series.key)) continue
    seen.add(series.key)

    const points = series.points
      .filter(({ t, price }) => Number.isFinite(t) && t <= nowT && Number.isFinite(price) && price > 0)
      .sort((a, b) => a.t - b.t)
    const latest = points.at(-1)
    if (!latest || nowT - latest.t > MAX_AGE) continue

    const target = latest.t - WINDOW
    const base = points.findLast(({ t }) => t <= target)
    if (!base || target - base.t > MAX_GAP) continue

    const recent = points.filter(({ t }) => t >= target)
    const trend = recent.length >= 2 ? recent : [base, ...recent]
    const high = Math.max(...trend.map(({ price }) => price))
    const low = Math.min(...trend.map(({ price }) => price))
    rows.push({
      key: series.key,
      name: holding.name,
      type: holding.type,
      symbol: holding.type === 'mf' ? null : String(holding.symbol).trim().toUpperCase(),
      fromDate: base.t,
      toDate: latest.t,
      fromPrice: base.price,
      toPrice: latest.price,
      changePct: ((latest.price / base.price) - 1) * 100,
      sevenDayPct: changeOver(points, latest, 7, 4 * DAY),
      oneYearPct: changeOver(points, latest, 365, 10 * DAY),
      belowHighPct: ((latest.price / high) - 1) * 100,
      lowPrice: low,
      highPrice: high,
      trend,
    })
  }

  return {
    drawdowns: rows.filter((row) => row.changePct < 0).sort((a, b) => a.changePct - b.changePct),
    gainers: rows.filter((row) => row.changePct > 0).sort((a, b) => b.changePct - a.changePct),
    unchangedCount: rows.filter((row) => row.changePct === 0).length,
  }
}

export function filterMovers(rows, type = 'all') {
  return rows.filter((row) => type === 'all' || row.type === type)
}

// Each distinct holding contributes one 30-day percentage move.
export function averageMoverChange(rows) {
  if (!rows.length) return null
  return rows.reduce((sum, row) => sum + row.changePct, 0) / rows.length
}

export function thirtyDayMovers(holdings = [], navMap, priceHistory, now = new Date()) {
  const ranked = rankedMovers(holdings, navMap, priceHistory, now)
  return { drawdowns: ranked.drawdowns, gainers: ranked.gainers }
}
