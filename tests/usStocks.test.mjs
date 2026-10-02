import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDataset } from '../src/lib/classify.js'
import { convertUsTransactions, fetchUsdInr } from '../src/lib/currency.js'
import { deriveEquityHoldings } from '../src/lib/derive.js'
import { monthlyInvestments } from '../src/lib/monthly.js'

test('Global Stocks dollars become rupees at the fetched USD/INR rate and stay separate', () => {
  const parsed = [{
    fileName: 'Global Stocks',
    sheets: [{ name: 'Transactions', rows: [
      ['Date', 'Stock Name', 'Ticker', 'Quantity', 'Order Type', 'Price (USD)'],
      ['01-09-2026', 'Apple', 'AAPL', 2, 'Buy', '$100'],
      ['02-10-2026', 'Apple', 'AAPL', 1, 'Buy', '$120'],
    ] }],
  }]
  const data = buildDataset(parsed)
  assert.equal(data.transactions.length, 2)
  assert.deepEqual(data.transactions.map((t) => t.type), ['us_stock', 'us_stock'])
  assert.equal(data.transactions[0].symbol, 'US:AAPL')
  assert.equal(data.transactions[0].priceUsd, 120)

  const converted = convertUsTransactions(data.transactions, 85)
  const holdings = deriveEquityHoldings(converted, 'Global Stocks')
  assert.equal(holdings.length, 1)
  assert.equal(holdings[0].type, 'us_stock')
  assert.equal(holdings[0].qty, 3)
  assert.equal(holdings[0].invested, 320 * 85)
  assert.equal(holdings[0].investedUsd, 320)

  const months = monthlyInvestments(converted)
  assert.deepEqual(months.map((m) => m.us_stock), [200 * 85, 120 * 85])
  assert.deepEqual(months.map((m) => m.total), [200 * 85, 120 * 85])
})

test('the actual Global Stocks layout uses Status for buy/sell and resolves IonQ', () => {
  const data = buildDataset([{
    fileName: 'Global Stocks',
    sheets: [{ name: 'Sheet1', rows: [
      ['Date', 'Stock Name', 'Quantity', 'Order Type', 'Requested Price', 'Status'],
      ['08-09-2026', 'IonQ Inc.', 1, 'Limit', '$39.78', 'Buy'],
      ['09-09-2026', 'IonQ Inc.', 0.25, 'Limit', '$40', 'Sell'],
    ] }],
  }])
  assert.deepEqual(data.transactions.map((t) => t.side), ['SELL', 'BUY'])
  assert.equal(data.transactions[0].symbol, 'US:IONQ')
  const holding = deriveEquityHoldings(convertUsTransactions(data.transactions, 85), 'Global Stocks')[0]
  assert.equal(holding.qty, 0.75)
  assert.ok(Math.abs(holding.invested - 0.75 * 39.78 * 85) < 1e-8)
  assert.ok(Math.abs(holding.investedUsd - 0.75 * 39.78) < 1e-8)
})

test('USD/INR loader uses the latest published rate and reuses it until the next update', async () => {
  const oldFetch = globalThis.fetch
  const oldStorage = globalThis.localStorage
  const values = new Map()
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return { ok: true, json: async () => ({
      result: 'success',
      rates: { INR: 96.378852 },
      time_last_update_unix: 1790899351,
      time_next_update_unix: Math.ceil(Date.now() / 1000) + 3600,
    }) }
  }
  try {
    const first = await fetchUsdInr()
    const second = await fetchUsdInr()
    assert.equal(first.rate, 96.378852)
    assert.equal(second.rate, first.rate)
    assert.equal(calls, 1)
  } finally {
    globalThis.fetch = oldFetch
    globalThis.localStorage = oldStorage
  }
})
