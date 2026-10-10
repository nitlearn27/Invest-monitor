import test from 'node:test'
import assert from 'node:assert/strict'
import { goalProgress } from '../src/lib/goal.js'
import { marketVsBuys } from '../src/lib/market.js'
import { monthlyInvestments } from '../src/lib/monthly.js'

const source = 'Test'
const buy = (date, qty, type = 'stock', symbol = 'AAA') => ({
  date, qty, price: 100, type, symbol, name: symbol, side: 'BUY', source,
})
const fund = (date, amount, name = 'Mid Cap Fund') => ({
  date, amount, units: amount / 100, name, side: 'BUY', source,
})

test('Goal contributions and cap slices match Monthly while valuation keeps actual dates and sell accounting', () => {
  const monthEnd = new Date(2026, 8, 30, 18, 30)
  const originalTime = monthEnd.getTime()
  const now = new Date(2026, 9, 10)
  const transactions = [
    buy(new Date(2026, 8, 29), 10),
    buy(monthEnd, 20),
    buy(monthEnd, 10, 'etf', 'ETF'),
    buy(monthEnd, 5, 'us_stock', 'US'),
    buy(new Date(2026, 9, 2), 3),
    { ...buy(new Date(2026, 9, 3), 2), side: 'SELL', price: 150 },
    { ...buy(monthEnd, 100, 'stock', 'Opening'), opening: true },
    buy(new Date(2026, 9, 20), 100),
  ]
  const mfTransactions = [
    fund(monthEnd, 5000),
    fund(new Date(2026, 9, 2), 700, 'Small Cap Fund'),
    fund(new Date(2026, 9, 20), 10000),
    { ...fund(monthEnd, 20000), opening: true },
  ]
  const priceHistory = new Map([['AAA', {
    t: [new Date(2026, 8, 1).getTime()], c: [100],
  }]])
  const g = goalProgress({
    transactions, mfTransactions, priceHistory, now,
    holdings: [{ source, invested: 10300, current: 10300 }],
  })
  const monthly = monthlyInvestments(
    transactions.filter((t) => t.date <= now),
    mfTransactions.filter((t) => t.date <= now),
  )
  assert.deepEqual(g.months.map((m) => [m.month, m.added]), monthly.map((m) => [m.month, m.total]))
  assert.equal(g.lastMonth.added, 1000)
  assert.equal(g.thisMonth.added, 9500)
  assert.equal(g.avg6, 1000)
  assert.equal(g.avg12, 1000)
  assert.equal(g.invested[g.samples.indexOf(originalTime)], 9500)
  assert.equal(g.currentInvested, 10300)
  assert.equal(g.currentValue, 10300)
  assert.equal(g.lastMonth.end, 9500)
  assert.equal(g.thisMonth.netAdded, 800)
  assert.equal(g.growth.added, 800)
  assert.equal(g.growth.market, 0)
  assert.equal(g.detail.added, 800)
  assert.equal(g.detail.classes.reduce((sum, c) => sum + c.market, 0), g.growth.market)

  const pace = marketVsBuys(null, mfTransactions, { months: 2, now })
  assert.deepEqual(pace.rows.map((r) => [r.month, r.total]), [['2026-09', 0], ['2026-10', 5700]])
  assert.deepEqual(pace.rows[1].invested, { mid: 5000, small: 700 })
  assert.equal(monthEnd.getTime(), originalTime)
  assert.equal(transactions[1].date, monthEnd)
})

test('Goal and cap reporting handle February, leap years, year rollover, and a non-final 30th', () => {
  const cases = [
    [2026, 1, 28, true],
    [2028, 1, 29, true],
    [2026, 11, 31, true],
    [2026, 9, 30, false],
  ]
  for (const [year, month, day, shifts] of cases) {
    const date = new Date(year, month, day, 18, 30)
    const mfTransactions = [fund(date, 1000)]
    const now = new Date(year, month + 1, 10)
    const g = goalProgress({ mfTransactions, now })
    const expected = monthlyInvestments([], mfTransactions)[0]
    assert.equal(g.months.find((m) => m.month === expected.month).added, 1000)
    assert.equal(g.lastMonth.added, shifts ? 0 : 1000)
    assert.equal(g.thisMonth.added, shifts ? 1000 : 0)
    assert.equal(g.currentInvested, 1000)
    assert.equal(g.invested[g.samples.indexOf(date.getTime())], 1000)
    const pace = marketVsBuys(null, mfTransactions, { months: 2, now })
    assert.equal(pace.rows.find((m) => m.month === expected.month).invested.mid, 1000)
  }
})

test('a last-day buy enters the portfolio immediately and is reported once in the next month', () => {
  const date = new Date(2026, 8, 30, 12)
  const mfTransactions = [fund(date, 1000)]
  const endOfMonth = new Date(2026, 8, 30, 23)
  const g = goalProgress({ mfTransactions, now: endOfMonth })
  assert.equal(g.currentInvested, 1000)
  assert.equal(g.thisMonth.added, 0)
  assert.equal(g.months.reduce((sum, m) => sum + m.added, 0), 0)
  const next = goalProgress({ mfTransactions, now: new Date(2026, 9, 1) })
  assert.equal(next.thisMonth.added, 1000)
  assert.equal(next.months.reduce((sum, m) => sum + m.added, 0), 1000)
  assert.equal(next.currentInvested, g.currentInvested)
  assert.equal(marketVsBuys(null, mfTransactions, { months: 1, now: endOfMonth }).rows[0].total, 0)
})
