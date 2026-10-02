import test from 'node:test'
import assert from 'node:assert/strict'
import { averageMoverChange, filterMovers, rankedMovers, thirtyDayMovers } from '../src/lib/movers.js'

const day = (date) => Date.parse(`${date}T00:00:00Z`)
const now = new Date('2026-09-30T12:00:00Z')
const equity = (name, symbol) => ({ name, symbol, type: 'stock' })
const series = (prices, dates = ['2026-08-31', '2026-09-15', '2026-09-30']) => ({
  t: dates.map(day), c: prices,
})

test('ranks observed 30-day moves, measures the period high, and deduplicates a stock held at two brokers', () => {
  const holdings = [equity('Alpha', 'AAA'), equity('Alpha', 'aaa'), equity('Beta', 'BBB'), equity('Gamma', 'CCC'), equity('Flat', 'FLAT')]
  const prices = new Map([
    ['AAA', series([100, 120, 80])],
    ['BBB', series([100, 90, 110])],
    ['CCC', series([100, 90, 95])],
    ['FLAT', series([100, 100, 100])],
  ])
  const { drawdowns, gainers } = thirtyDayMovers(holdings, null, prices, now)
  assert.deepEqual(drawdowns.map((row) => row.name), ['Alpha', 'Gamma'])
  assert.ok(Math.abs(drawdowns[0].changePct + 20) < 1e-10)
  assert.ok(Math.abs(drawdowns[1].changePct + 5) < 1e-10)
  assert.deepEqual(gainers.map((row) => row.name), ['Beta'])
  assert.equal(drawdowns[0].belowHighPct, (80 / 120 - 1) * 100)
  assert.equal(drawdowns[0].fromDate, day('2026-08-31'))
  assert.equal(drawdowns[0].lowPrice, 80)
  assert.equal(drawdowns[0].highPrice, 120)
  assert.equal(drawdowns[0].trend.length, 3)
  assert.equal(rankedMovers(holdings, null, prices, now).unchangedCount, 1)
  assert.ok(Math.abs(averageMoverChange(drawdowns) + 12.5) < 1e-10)
  assert.ok(Math.abs(averageMoverChange(gainers) - 10) < 1e-10)
  assert.equal(averageMoverChange([]), null)
})

test('excludes stale, short, and gapped histories rather than treating them as 30-day moves', () => {
  const holdings = [equity('Stale', 'OLD'), equity('Short', 'NEW'), equity('Gap', 'GAP'), equity('Valid', 'OK')]
  const prices = new Map([
    ['OLD', series([100, 80], ['2026-07-01', '2026-08-01'])],
    ['NEW', series([100, 80], ['2026-09-10', '2026-09-30'])],
    ['GAP', series([100, 80], ['2026-08-01', '2026-09-30'])],
    ['OK', series([100, 80], ['2026-08-30', '2026-09-30'])],
  ])
  const { drawdowns, gainers } = thirtyDayMovers(holdings, null, prices, now)
  assert.deepEqual(drawdowns.map((row) => row.name), ['Valid'])
  assert.deepEqual(gainers, [])
})

test('adds short- and long-term context only when those comparison dates have history', () => {
  const holdings = [equity('Recovery', 'REC'), equity('New', 'NEW')]
  const prices = new Map([
    ['REC', series([80, 100, 90, 95], ['2025-09-30', '2026-08-31', '2026-09-23', '2026-09-30'])],
    ['NEW', series([100, 90], ['2026-08-31', '2026-09-30'])],
  ])
  const { drawdowns } = thirtyDayMovers(holdings, null, prices, now)
  const recovery = drawdowns.find((row) => row.name === 'Recovery')
  const newlyListed = drawdowns.find((row) => row.name === 'New')
  assert.ok(Math.abs(recovery.sevenDayPct - (95 / 90 - 1) * 100) < 1e-10)
  assert.ok(Math.abs(recovery.oneYearPct - (95 / 80 - 1) * 100) < 1e-10)
  assert.equal(newlyListed.sevenDayPct, null)
  assert.equal(newlyListed.oneYearPct, null)
})

test('includes every mover and filters each asset type without a ranking cap', () => {
  const holdings = [{ name: 'Axis Midcap Fund Direct Growth', type: 'mf' }]
  const navs = new Map([[120505, { history: [
    { t: day('2026-09-30'), nav: 90 },
    { t: day('2026-09-15'), nav: 110 },
    { t: day('2026-08-31'), nav: 100 },
  ] }]])
  const prices = new Map()
  for (let i = 0; i < 22; i++) {
    const symbol = `G${i}`
    holdings.push(equity(symbol, symbol))
    prices.set(symbol, series([100, 100, 101 + i]))
  }
  holdings.push({ name: 'Index ETF', symbol: 'INDEXETF', type: 'etf' })
  prices.set('INDEXETF', series([100, 100, 100.5]))
  const { drawdowns, gainers } = thirtyDayMovers(holdings, navs, prices, now)
  assert.deepEqual(drawdowns.map((row) => row.name), ['Axis Midcap Fund Direct Growth'])
  assert.equal(drawdowns[0].belowHighPct, (90 / 110 - 1) * 100)
  assert.equal(gainers.length, 23)
  assert.equal(gainers[0].name, 'G21')
  assert.ok(gainers.some((row) => row.name === 'Index ETF'))

  const ranked = rankedMovers(holdings, navs, prices, now)
  assert.deepEqual(filterMovers(ranked.gainers, 'etf').map((row) => row.name), ['Index ETF'])
  assert.equal(filterMovers(ranked.gainers, 'stock').length, 22)
  assert.ok(Math.abs(averageMoverChange(filterMovers(ranked.gainers, 'etf')) - 0.5) < 1e-10)
  assert.ok(Math.abs(averageMoverChange(filterMovers(ranked.gainers, 'stock')) - 11.5) < 1e-10)
  assert.deepEqual(filterMovers(ranked.drawdowns, 'mf').map((row) => row.name), ['Axis Midcap Fund Direct Growth'])
})

test('keeps more than twenty losers in percentage order', () => {
  const holdings = []
  const prices = new Map()
  for (let i = 0; i < 23; i++) {
    holdings.push(equity(`Loser ${i}`, `L${i}`))
    prices.set(`L${i}`, series([100, 100, 99 - i]))
  }
  const { drawdowns } = thirtyDayMovers(holdings, null, prices, now)
  assert.equal(drawdowns.length, 23)
  assert.equal(drawdowns[0].name, 'Loser 22')
  assert.equal(drawdowns.at(-1).name, 'Loser 0')
})
