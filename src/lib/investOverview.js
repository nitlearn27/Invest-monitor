import { indiaDate } from './correctionStrategy.js'
import { monthlyInvestments } from './monthly.js'

export const INVEST_WATCHLIST = [
  { schemeCode: 120403, fundName: 'Invesco Midcap' },
  { schemeCode: 145137, fundName: 'Invesco Smallcap' },
  { schemeCode: 119775, fundName: 'Kotak Midcap' },
  { schemeCode: 120828, fundName: 'Quant Small Cap' },
  { schemeCode: 152437, fundName: 'Edelweiss Technology' },
]

export function monthlyBudgetProgress(transactions, mfTransactions, month, budget) {
  const invested = monthlyInvestments(transactions, mfTransactions)
    .find((item) => item.month === month)?.total ?? 0
  return {
    invested,
    remaining: Math.max(0, budget - invested),
    investedPct: Math.min(100, invested / budget * 100),
  }
}

export function monthlyNavRecord(history, month, asOf = indiaDate()) {
  const previousMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 2, 1))
    .toISOString().slice(0, 7)
  const validRows = (history || []).filter((row) => {
    if (!Number.isFinite(row.t) || !Number.isFinite(row.nav) || row.nav <= 0) return false
    const date = new Date(row.t).toISOString().slice(0, 10)
    return (date.slice(0, 7) === month || date.slice(0, 7) === previousMonth) && date <= asOf
  }).sort((a, b) => a.t - b.t)
  const rows = validRows.filter((row) => new Date(row.t).toISOString().slice(0, 7) === month)
  if (!rows.length) return null
  const previousClose = validRows.filter((row) => new Date(row.t).toISOString().slice(0, 7) === previousMonth).at(-1)
  const monthlyHighNAV = Math.max(...rows.map((row) => row.nav))
  const latest = rows.at(-1)
  return {
    month,
    previousCloseNAV: previousClose?.nav ?? null,
    previousCloseDate: previousClose ? new Date(previousClose.t).toISOString().slice(0, 10) : null,
    monthlyHighNAV,
    currentNAV: latest.nav,
    currentDrawdown: (monthlyHighNAV - latest.nav) / monthlyHighNAV * 100,
    navDate: new Date(latest.t).toISOString().slice(0, 10),
    rows,
  }
}

export function monthlyPercentSeries(record) {
  if (!record?.rows?.length || !record.previousCloseNAV) return []
  return record.rows.map((row) => ({
    day: new Date(row.t).getUTCDate(),
    nav: row.nav,
    changePct: (row.nav / record.previousCloseNAV - 1) * 100,
  }))
}

export function monthlyChartLayout(month, changes, plot) {
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()
  const baselineX = plot.left + 10
  const firstDayX = plot.left + 56
  const yLimit = Math.max(5, Math.ceil(Math.max(0, ...changes.map(Math.abs)) / 5) * 5)
  const zeroY = (plot.top + plot.bottom) / 2
  return {
    lastDay,
    baselineX,
    zeroY,
    ticks: [-yLimit, -yLimit / 2, 0, yLimit / 2, yLimit],
    x: (day) => firstDayX + (day - 1) / (lastDay - 1) * (plot.right - firstDayX),
    y: (percent) => zeroY - percent / yLimit * (plot.bottom - plot.top) / 2,
  }
}

export function rankInvestFunds(funds, records) {
  const monthlyChanges = new Map(records.map((record) => [
    record.schemeCode, monthlyPercentSeries(record).at(-1)?.changePct,
  ]))
  return funds.map((fund, order) => ({
    fund,
    monthlyChangePct: monthlyChanges.get(fund.schemeCode) ?? null,
    order,
  })).sort((a, b) => {
    if (a.monthlyChangePct == null) return b.monthlyChangePct == null ? a.order - b.order : 1
    if (b.monthlyChangePct == null) return -1
    return a.monthlyChangePct - b.monthlyChangePct || a.order - b.order
  }).map(({ fund, monthlyChangePct }) => ({ ...fund, monthlyChangePct }))
}
