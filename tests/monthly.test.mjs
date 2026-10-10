import test from 'node:test'
import assert from 'node:assert/strict'
import { monthlyInvestments, mfCapBreakdown, equityBreakdown, investmentMonthKey } from '../src/lib/monthly.js'
import { monthlyBudgetProgress } from '../src/lib/investOverview.js'

test('only the actual last day reports in the next month, including February and year rollover', () => {
  const cases = [
    [2026, 9, 29, '2026-09'],
    [2026, 9, 30, '2026-10'],
    [2026, 10, 30, '2026-10'],
    [2026, 10, 31, '2026-11'],
    [2026, 2, 27, '2026-02'],
    [2026, 2, 28, '2026-03'],
    [2028, 2, 28, '2028-02'],
    [2028, 2, 29, '2028-03'],
    [2026, 12, 31, '2027-01'],
  ]
  for (const [year, month, day, expected] of cases) {
    const date = new Date(year, month - 1, day, 18, 30)
    const originalTime = date.getTime()
    const txn = Object.freeze({ date, side: 'BUY', qty: 1, price: 100 })
    assert.equal(investmentMonthKey(txn), expected)
    assert.equal(monthlyInvestments([txn])[0].month, expected)
    assert.equal(txn.date, date)
    assert.equal(date.getTime(), originalTime)
  }
})

test('totals, allocation breakdowns, and detail grouping agree across all investment types', () => {
  const september = new Date(2026, 8, 29)
  const monthEnd = new Date(2026, 8, 30)
  const october = new Date(2026, 9, 1)
  const equity = [
    { date: september, side: 'BUY', type: 'stock', name: 'Stock', qty: 1, price: 50 },
    { date: monthEnd, side: 'BUY', type: 'stock', name: 'Stock', qty: 2, price: 100 },
    { date: monthEnd, side: 'BUY', type: 'etf', name: 'ETF', qty: 3, price: 100 },
    { date: monthEnd, side: 'BUY', type: 'us_stock', name: 'US Stock', qty: 4, price: 100 },
    { date: october, side: 'BUY', type: 'stock', name: 'Stock', qty: 1, price: 100 },
    { date: monthEnd, side: 'SELL', type: 'stock', name: 'Stock', qty: 1, price: 100 },
    { date: monthEnd, side: 'BUY', opening: true, name: 'Opening', qty: 1, price: 1000 },
  ]
  const funds = [
    { date: september, side: 'BUY', name: 'Mid Cap Fund', amount: 100 },
    { date: monthEnd, side: 'BUY', name: 'Mid Cap Fund', amount: 500 },
    { date: october, side: 'BUY', name: 'Small Cap Fund', amount: 200 },
    { date: monthEnd, side: 'SELL', name: 'Mid Cap Fund', amount: 50 },
  ]
  const monthly = monthlyInvestments(equity, funds)
  assert.deepEqual(monthly.map((m) => [m.month, m.total, m.count]), [
    ['2026-09', 150, 2], ['2026-10', 1700, 6],
  ])
  assert.deepEqual([monthly[1].stock, monthly[1].etf, monthly[1].us_stock, monthly[1].mf], [300, 300, 400, 700])
  assert.equal(monthly[1].label, 'Oct 2026')

  const cap = mfCapBreakdown(funds)
  const scrips = equityBreakdown(equity)
  assert.deepEqual(cap.months.map((m) => [m.month, m.total]), [['2026-09', 100], ['2026-10', 700]])
  assert.deepEqual(scrips.months.map((m) => [m.month, m.total]), [['2026-09', 50], ['2026-10', 1000]])
  assert.equal(cap.months[1].label, 'Oct 2026')
  assert.equal(scrips.months[1].label, 'Oct 2026')
  assert.equal(cap.all.total + scrips.all.total, 1850)
  assert.equal(equity.filter((t) => investmentMonthKey(t) === '2026-10').length, 4)
  assert.equal(funds.filter((t) => investmentMonthKey(t) === '2026-10').length, 2)
  assert.equal(investmentMonthKey(equity[5]), '2026-09')
  assert.equal(investmentMonthKey(equity[6]), '2026-09')
  assert.equal(investmentMonthKey({ date: null, side: 'BUY' }), null)
  assert.equal(monthlyBudgetProgress(equity, funds, '2026-10', 2000).invested, 1700)
})
