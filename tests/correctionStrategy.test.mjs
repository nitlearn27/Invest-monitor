import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_CORRECTION_STRATEGY as defaults, createStrategyMonth, evaluateStrategyMonth,
  indiaDate, validateStrategy, recommendationMessage,
} from '../src/lib/correctionStrategy.js'

const history = (rows) => rows.map(([date, nav]) => ({ t: Date.parse(`${date}T00:00:00Z`), nav }))
const run = (rows, asOf = '2026-09-30', config = defaults, month = '2026-09') =>
  evaluateStrategyMonth(createStrategyMonth(config, month), history(rows), asOf)

test('no correction: initial 55%, then the exact remainder at cutoff', () => {
  const result = run([['2026-09-01', 100], ['2026-09-14', 102], ['2026-09-15', 103]])
  assert.deepEqual(result.recommendations.map((r) => [r.kind, r.amountPaise / 100]), [['initial', 55000], ['cutoff', 45000]])
  assert.equal(result.state.allocatedPaise, 10000000)
  assert.equal(result.state.remainingPaise, 0)
  assert.equal(result.state.status, 'complete')
})

for (const [nav, amount, levels] of [[97, 20000, [3]], [94.6, 35000, [3, 5]], [92.9, 45000, [3, 5, 7]]]) {
  test(`direct correction to NAV ${nav}: all crossed levels share one recommendation`, () => {
    const result = run([['2026-09-01', 100], ['2026-09-02', nav]])
    assert.equal(result.recommendations.length, 2)
    assert.equal(result.recommendations[1].amountPaise, amount * 100)
    assert.deepEqual(result.recommendations[1].breakdown.map((r) => r.drawdown), levels)
    assert.ok(result.state.allocatedPaise <= result.state.budgetPaise)
  })
}

test('exact 5% and 7% boundaries are inclusive', () => {
  assert.equal(run([['2026-09-01', 100], ['2026-09-02', 95]]).state.allocatedPaise, 9000000)
  assert.equal(run([['2026-09-01', 100], ['2026-09-02', 93]]).state.allocatedPaise, 10000000)
})

test('repeated low NAV and replaying the same history do not duplicate triggers', () => {
  const rows = history([['2026-09-01', 100], ['2026-09-02', 97], ['2026-09-03', 96.5]])
  const first = evaluateStrategyMonth(createStrategyMonth(defaults, '2026-09'), rows, '2026-09-03')
  const again = evaluateStrategyMonth(first.state, [...rows, ...history([['2026-09-04', 96]])], '2026-09-04')
  assert.equal(first.recommendations.length, 2)
  assert.equal(again.recommendations.length, 0)
  assert.equal(again.state.allocatedPaise, 7500000)
})

test('a new monthly high, not initial NAV, is the drawdown basis', () => {
  const result = run([['2026-08-31', 200], ['2026-09-01', 100], ['2026-09-02', 110], ['2026-09-03', 106.7]])
  assert.equal(result.state.monthlyHighNAV, 110)
  assert.ok(Math.abs(result.state.currentDrawdown - 3) < 1e-8)
  assert.equal(result.recommendations[1].amountPaise, 2000000)
})

test('recovery then a new high does not re-arm an executed level', () => {
  const result = run([['2026-09-01', 100], ['2026-09-02', 97], ['2026-09-03', 110], ['2026-09-04', 106.7]])
  assert.equal(result.recommendations.length, 2)
  assert.equal(result.state.monthlyHighNAV, 110)
})

test('Sunday cutoff and Monday holiday wait until the next actual NAV', () => {
  // 15 November 2026 is Sunday; treat the 16th as a no-NAV holiday.
  const first = run([['2026-11-02', 100], ['2026-11-13', 101]], '2026-11-16', defaults, '2026-11')
  assert.equal(first.state.cutoffStatus, 'waiting_for_nav')
  assert.equal(first.state.remainingPaise, 4500000)
  const next = evaluateStrategyMonth(first.state, history([['2026-11-17', 101]]), '2026-11-17')
  assert.equal(next.recommendations[0].kind, 'cutoff')
  assert.equal(next.state.cutoffNAVDate, '2026-11-17')
  assert.equal(next.state.remainingPaise, 0)
})

test('missing weekday cutoff NAV also waits; calendar time alone never executes', () => {
  const result = run([['2026-09-01', 100], ['2026-09-14', 100]], '2026-09-15')
  assert.equal(result.recommendations.length, 1)
  assert.equal(result.state.cutoffNAVDate, null)
  const next = evaluateStrategyMonth(result.state, history([['2026-09-16', 90]]), '2026-09-16')
  assert.equal(next.recommendations.length, 1)
  assert.equal(next.recommendations[0].kind, 'cutoff')
  assert.equal(next.recommendations[0].amountPaise, 4500000)
})

test('fresh monthly state ignores the previous monthly high and resets triggers', () => {
  const rows = [['2026-09-01', 200], ['2026-09-15', 190], ['2026-10-01', 100]]
  const september = run(rows, '2026-09-30')
  const october = run(rows, '2026-10-01', defaults, '2026-10')
  assert.equal(september.state.status, 'complete')
  assert.equal(october.state.monthlyHighNAV, 100)
  assert.equal(october.state.currentDrawdown, 0)
  assert.deepEqual(october.state.executedTriggers, ['initial'])
  assert.equal(october.state.remainingPaise, 4500000)
})

test('completion suppresses new recommendations while high/current NAV remain live', () => {
  const result = run([['2026-09-01', 100], ['2026-09-02', 90], ['2026-09-03', 120], ['2026-09-15', 50]])
  assert.equal(result.recommendations.length, 2)
  assert.equal(result.state.monthlyHighNAV, 120)
  assert.equal(result.state.currentNAV, 50)
  assert.equal(result.state.remainingPaise, 0)
})

test('custom budget, levels, initial percentage and cutoff work, including paise', () => {
  const config = { ...defaults, monthlyBudget: 123.45, initialAllocation: 40, levels: [{ drawdown: 2, allocation: 60 }], cutoffDay: 10 }
  const result = run([['2026-09-01', 100], ['2026-09-02', 98], ['2026-09-10', 98]], '2026-09-10', config)
  assert.equal(result.state.budgetPaise, 12345)
  assert.equal(result.state.remainingPaise, 0)
  assert.equal(result.recommendations.reduce((sum, r) => sum + r.amountPaise, 0), 12345)
  assert.equal(result.state.cutoffDate, '2026-09-10')
})

test('cutoff clamps to month end and may settle on next month’s first NAV', () => {
  const config = { ...defaults, cutoffDay: 31 }
  const initial = run([['2026-02-02', 100], ['2026-02-27', 101]], '2026-02-28', config, '2026-02')
  assert.equal(initial.state.cutoffDate, '2026-02-28')
  const settled = evaluateStrategyMonth(initial.state, history([['2026-03-02', 102]]), '2026-03-02')
  assert.equal(settled.state.cutoffNAVDate, '2026-03-02')
  assert.equal(settled.state.monthlyHighNAV, 101)
  assert.equal(settled.state.remainingPaise, 0)
})

test('sorts real history; excludes invalid, future and previous-month NAV rows', () => {
  const result = run([['2026-09-20', 200], ['2026-09-03', 97], ['2026-09-01', 100], ['2026-08-31', 500], ['2026-09-02', -1]], '2026-09-03')
  assert.equal(result.state.monthlyHighNAV, 100)
  assert.equal(result.state.currentNAV, 97)
  assert.equal(result.recommendations.length, 2)
  const empty = run([], '2026-09-15')
  assert.equal(empty.state.status, 'waiting_for_nav')
  assert.equal(empty.recommendations.length, 0)
})

test('first valid NAV on cutoff issues initial and remainder, never over budget', () => {
  const result = run([['2026-09-16', 100]])
  assert.deepEqual(result.recommendations.map((item) => item.kind), ['initial', 'cutoff'])
  assert.equal(result.state.remainingPaise, 0)
})

test('validation rejects invalid budgets, repeated levels, totals and cutoff', () => {
  for (const change of [
    { monthlyBudget: -1 }, { monthlyBudget: Infinity }, { monthlyBudget: 0.001 },
    { initialAllocation: 60 }, { cutoffDay: 32 }, { cutoffDay: 1.5 },
    { levels: [{ drawdown: 3, allocation: 20 }, { drawdown: 3, allocation: 25 }] },
    { levels: [{ drawdown: 0, allocation: 45 }] },
  ]) assert.throws(() => validateStrategy({ ...defaults, ...change }))
})

test('India date rolls over independently of browser timezone', () => {
  assert.equal(indiaDate(new Date('2026-09-30T19:00:00Z')), '2026-10-01')
})

test('combined correction message includes actual drawdown, levels and amount', () => {
  const result = run([['2026-09-01', 100], ['2026-09-02', 94.6]])
  assert.equal(recommendationMessage(result.recommendations[1], (value) => `₹${value.toLocaleString('en-IN')}`),
    '5.4% correction reached. 3% and 5% levels triggered. Invest ₹35,000.')
})
