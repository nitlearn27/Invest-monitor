import test from 'node:test'
import assert from 'node:assert/strict'
import { INVEST_WATCHLIST, monthlyBudgetProgress, monthlyNavRecord, monthlyPercentSeries, monthlyChartLayout, rankInvestFunds } from '../src/lib/investOverview.js'
import { monthlyInvestments } from '../src/lib/monthly.js'
import { schemeFor } from '../src/lib/navs.js'

test('Invest dropdown contains only the five requested funds with mapped NAV codes', () => {
  assert.deepEqual(INVEST_WATCHLIST.map((fund) => fund.fundName), [
    'Invesco Midcap', 'Invesco Smallcap', 'Kotak Midcap', 'Quant Small Cap', 'Edelweiss Technology',
  ])
  const mappedNames = [
    'Invesco India Mid Cap Fund', 'Invesco India Smallcap Fund', 'Kotak Midcap Fund',
    'Quant Small Cap Fund', 'Edelweiss Technology Fund',
  ]
  assert.deepEqual(INVEST_WATCHLIST.map((fund, index) => schemeFor(mappedNames[index])?.schemeCode),
    INVEST_WATCHLIST.map((fund) => fund.schemeCode))
})

test('dropdown ranks monthly losses first, then gains, with missing NAVs last', () => {
  const record = (schemeCode, latest) => ({
    ...monthlyNavRecord([
      { t: Date.parse('2026-09-30T00:00:00Z'), nav: 100 },
      { t: Date.parse('2026-10-01T00:00:00Z'), nav: 99 },
      { t: Date.parse('2026-10-02T00:00:00Z'), nav: latest },
    ], '2026-10', '2026-10-03'),
    schemeCode,
  })
  const records = [
    record(120403, 98), record(145137, 103), record(119775, 95), record(120828, 100),
  ]
  const ranked = rankInvestFunds(INVEST_WATCHLIST, records)
  assert.deepEqual(ranked.map((fund) => fund.schemeCode), [119775, 120403, 120828, 145137, 152437])
  assert.deepEqual(ranked.map((fund) => fund.monthlyChangePct == null ? null : Number(fund.monthlyChangePct.toFixed(2))),
    [-5, -2, 0, 3, null])
  assert.equal(rankInvestFunds(INVEST_WATCHLIST, [record(120403, 102), record(145137, 105)])[0].schemeCode, 120403)
})

test('shared budget matches the Monthly tab total across asset types', () => {
  const date = new Date(2026, 9, 2)
  const equity = [{ date, side: 'BUY', type: 'stock', qty: 10, price: 3000 }]
  const funds = [{ date, side: 'BUY', name: 'Fund A', amount: 19000 }]
  const monthly = monthlyInvestments(equity, funds).find((item) => item.month === '2026-10')
  const progress = monthlyBudgetProgress(equity, funds, '2026-10', 200000)
  assert.equal(monthly.total, 49000)
  assert.deepEqual(progress, { invested: monthly.total, remaining: 151000, investedPct: 24.5 })
})

test('drawdown uses the latest NAV against the current calendar-month high', () => {
  const rows = [
    { t: Date.parse('2026-09-30T00:00:00Z'), nav: 130 },
    { t: Date.parse('2026-10-01T00:00:00Z'), nav: 100 },
    { t: Date.parse('2026-10-02T00:00:00Z'), nav: 97 },
  ]
  const record = monthlyNavRecord(rows, '2026-10', '2026-10-03')
  assert.equal(record.monthlyHighNAV, 100)
  assert.equal(record.currentNAV, 97)
  assert.equal(record.currentDrawdown, 3)
})

test('chart compares each current-month NAV with the prior month’s last NAV', () => {
  const rows = [
    { t: Date.parse('2026-09-29T00:00:00Z'), nav: 99 },
    { t: Date.parse('2026-09-30T00:00:00Z'), nav: 100 },
    { t: Date.parse('2026-10-02T00:00:00Z'), nav: 98 },
    { t: Date.parse('2026-10-03T00:00:00Z'), nav: 103 },
    { t: Date.parse('2026-10-05T00:00:00Z'), nav: 95 },
  ]
  const record = monthlyNavRecord(rows, '2026-10', '2026-10-05')
  assert.equal(record.previousCloseNAV, 100)
  assert.equal(record.previousCloseDate, '2026-09-30')
  assert.deepEqual(monthlyPercentSeries(record).map(({ day, changePct }) => [day, Number(changePct.toFixed(2))]),
    [[2, -2], [3, 3], [5, -5]])
})

test('the first trading day shows its change, including across a year boundary', () => {
  const october = monthlyNavRecord([
    { t: Date.parse('2026-10-01T00:00:00Z'), nav: 97 },
    { t: Date.parse('2026-09-30T00:00:00Z'), nav: 100 },
  ], '2026-10', '2026-10-03')
  assert.equal(Number(monthlyPercentSeries(october)[0].changePct.toFixed(2)), -3)
  const january = monthlyNavRecord([
    { t: Date.parse('2026-01-01T00:00:00Z'), nav: 205 },
    { t: Date.parse('2025-12-31T00:00:00Z'), nav: 200 },
  ], '2026-01', '2026-01-02')
  assert.equal(january.previousCloseDate, '2025-12-31')
  assert.equal(Number(monthlyPercentSeries(january)[0].changePct.toFixed(2)), 2.5)
})

test('chart keeps zero centered and plots day one beyond the previous close', () => {
  const plot = { left: 44, right: 328, top: 14, bottom: 174 }
  const firstDay = monthlyChartLayout('2026-10', [-2], plot)
  const laterDay = monthlyChartLayout('2026-10', [-2, 1], plot)
  assert.equal(firstDay.zeroY, 94)
  assert.equal(firstDay.y(0), 94)
  assert.ok(firstDay.x(1) - firstDay.baselineX >= 40)
  assert.ok(firstDay.y(-2) > firstDay.zeroY)
  assert.equal(firstDay.x(1), laterDay.x(1))
  assert.equal(firstDay.y(-2), laterDay.y(-2))
  assert.equal(firstDay.x(31), plot.right)
  assert.equal(firstDay.lastDay, 31)
})

test('missing previous-month NAV leaves comparison and ranking unavailable', () => {
  const record = monthlyNavRecord([
    { t: Date.parse('2026-10-01T00:00:00Z'), nav: 97 },
    { t: Date.parse('2026-08-31T00:00:00Z'), nav: 100 },
  ], '2026-10', '2026-10-03')
  assert.equal(record.previousCloseNAV, null)
  assert.deepEqual(monthlyPercentSeries(record), [])
  assert.equal(rankInvestFunds(INVEST_WATCHLIST, [{ ...record, schemeCode: 120403 }])[0].monthlyChangePct, null)
})
