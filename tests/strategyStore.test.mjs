import test from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'
import { openStrategyStore } from '../src/lib/strategyStore.js'
import { DEFAULT_CORRECTION_STRATEGY as defaults } from '../src/lib/correctionStrategy.js'

const funds = [{ schemeCode: defaults.schemeCode, fundName: defaults.fundName }]
const navMap = (rows, code = defaults.schemeCode) => new Map([[code, {
  history: rows.map(([date, nav]) => ({ t: Date.parse(`${date}T00:00:00Z`), nav })),
}]])

test('concurrent jobs on separate DB connections persist one recommendation per trigger', async () => {
  const factory = new IDBFactory()
  const a = await openStrategyStore(factory)
  const b = await openStrategyStore(factory)
  const navs = navMap([['2026-09-01', 100], ['2026-09-02', 94.6]])
  await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b).monitor(funds, navs, '2026-09-02')))
  const snapshot = await a.read()
  assert.equal(snapshot.months.length, 1)
  assert.equal(snapshot.recommendations.length, 2)
  assert.equal(snapshot.months[0].allocatedPaise, 9000000)
  assert.equal(new Set(snapshot.recommendations.flatMap((item) => item.triggerKeys)).size, 3)
  a.close(); b.close()
})

test('reopening DB retains recommendations, review state and month history', async () => {
  const factory = new IDBFactory()
  let store = await openStrategyStore(factory)
  await store.monitor(funds, navMap([['2026-09-01', 100], ['2026-09-15', 100]]), '2026-09-30')
  let snapshot = await store.read()
  await store.review(snapshot.recommendations[0].id)
  store.close()
  store = await openStrategyStore(factory)
  await store.monitor(funds, navMap([['2026-09-01', 100], ['2026-09-15', 100], ['2026-10-01', 80]]), '2026-10-01')
  snapshot = await store.read()
  assert.equal(snapshot.months.length, 2)
  assert.equal(snapshot.recommendations.length, 3)
  assert.equal(snapshot.recommendations.filter((item) => item.status === 'reviewed').length, 1)
  assert.equal(snapshot.months.find((item) => item.month === '2026-10').monthlyHighNAV, 80)
  store.close()
})

test('config change after recommendation starts next month and preserves current budget', async () => {
  const store = await openStrategyStore(new IDBFactory())
  await store.monitor(funds, navMap([['2026-09-01', 100]]), '2026-09-01')
  assert.deepEqual(await store.saveConfig({ ...defaults, monthlyBudget: 50000 }, '2026-09-02'), { deferred: true })
  const snapshot = await store.monitor(funds, navMap([['2026-09-15', 100], ['2026-10-01', 90]]), '2026-10-01')
  assert.equal(snapshot.months.find((item) => item.month === '2026-09').budgetPaise, 10000000)
  assert.equal(snapshot.months.find((item) => item.month === '2026-10').budgetPaise, 5000000)
  store.close()
})

test('config before first recommendation applies now; invalid config leaves DB untouched', async () => {
  const store = await openStrategyStore(new IDBFactory())
  await store.monitor(funds, new Map(), '2026-09-01')
  assert.deepEqual(await store.saveConfig({ ...defaults, monthlyBudget: 50000 }, '2026-09-01'), { deferred: false })
  await assert.rejects(store.saveConfig({ ...defaults, initialAllocation: 80 }, '2026-09-01'))
  const snapshot = await store.monitor(funds, navMap([['2026-09-01', 100]]), '2026-09-01')
  assert.equal(snapshot.recommendations[0].amountPaise, 2750000)
  assert.equal(snapshot.strategies[0].monthlyBudget, 50000)
  store.close()
})

test('individual funds have isolated monthly highs, budgets and triggers', async () => {
  const store = await openStrategyStore(new IDBFactory())
  const bothFunds = [...funds, { schemeCode: 119775, fundName: 'Other portfolio fund' }]
  const navs = new Map([...navMap([['2026-09-01', 100], ['2026-09-02', 93]]), ...navMap([['2026-09-01', 200], ['2026-09-02', 201]], 119775)])
  const snapshot = await store.monitor(bothFunds, navs, '2026-09-02')
  assert.equal(snapshot.months.find((item) => item.schemeCode === 120403).remainingPaise, 0)
  assert.equal(snapshot.months.find((item) => item.schemeCode === 119775).remainingPaise, 4500000)
  assert.equal(snapshot.months.find((item) => item.schemeCode === 119775).monthlyHighNAV, 201)
  store.close()
})

test('missed months are caught up only since tracking began', async () => {
  const store = await openStrategyStore(new IDBFactory())
  await store.monitor(funds, new Map(), '2026-09-01')
  const snapshot = await store.monitor(funds, navMap([
    ['2026-08-01', 100], ['2026-09-01', 100], ['2026-09-15', 100],
    ['2026-10-01', 100], ['2026-10-15', 100], ['2026-11-02', 100],
  ]), '2026-11-02')
  assert.deepEqual(snapshot.months.map((item) => item.month), ['2026-09', '2026-10', '2026-11'])
  assert.equal(snapshot.recommendations.length, 5)
  store.close()
})

test('unavailable storage fails explicitly rather than issuing unpersisted alerts', async () => {
  await assert.rejects(openStrategyStore(null), /storage is unavailable/)
})

test('unique trigger constraint rolls back monthly state together with a duplicate alert', async () => {
  const factory = new IDBFactory()
  const store = await openStrategyStore(factory)
  const original = await store.monitor(funds, navMap([['2026-09-01', 100]]), '2026-09-01')
  const db = await new Promise((resolve, reject) => {
    const request = factory.open('invest-monitor:strategies', 1)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  await assert.rejects(new Promise((resolve, reject) => {
    const tx = db.transaction(['months', 'recommendations'], 'readwrite')
    tx.oncomplete = resolve
    tx.onabort = () => reject(tx.error)
    tx.objectStore('months').put({ ...original.months[0], allocatedPaise: 9999999 })
    tx.objectStore('recommendations').add({ ...original.recommendations[0], id: 'duplicate-with-different-id' })
  }), { name: 'ConstraintError' })
  const after = await store.read()
  assert.deepEqual(after, original)
  db.close(); store.close()
})
