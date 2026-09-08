// Pure, date-driven engine. No network, storage, clock or React dependencies.
// Money is stored in integer paise; allocation means recommended, never purchased.
export const DEFAULT_CORRECTION_STRATEGY = {
  schemeCode: 120403,
  fundName: 'Invesco India Mid Cap Fund – Direct Growth',
  monthlyBudget: 100000,
  initialAllocation: 55,
  levels: [
    { drawdown: 3, allocation: 20 },
    { drawdown: 5, allocation: 15 },
    { drawdown: 7, allocation: 10 },
  ],
  cutoffDay: 15,
}

export const STRATEGY_POLL_MS = 30 * 60 * 1000

export function indiaDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

export function validateStrategy(input) {
  const config = structuredClone(input)
  if (!Number.isSafeInteger(config.schemeCode) || config.schemeCode <= 0) {
    throw new Error('Select a fund with a valid AMFI scheme code.')
  }
  if (!Number.isFinite(config.monthlyBudget) || config.monthlyBudget <= 0
    || !Number.isSafeInteger(Math.round(config.monthlyBudget * 100))
    || Math.abs(config.monthlyBudget * 100 - Math.round(config.monthlyBudget * 100)) > 1e-6) {
    throw new Error('Monthly budget must be positive, with at most two decimal places.')
  }
  if (!Number.isInteger(config.cutoffDay) || config.cutoffDay < 1 || config.cutoffDay > 31) {
    throw new Error('Cutoff day must be between 1 and 31 (clamped to month end).')
  }
  if (!Number.isFinite(config.initialAllocation) || config.initialAllocation < 0 || config.initialAllocation > 100
    || !Array.isArray(config.levels)) throw new Error('Enter a valid initial allocation and correction levels.')
  const seen = new Set()
  for (const level of config.levels) {
    if (!Number.isFinite(level.drawdown) || level.drawdown <= 0 || level.drawdown > 100
      || seen.has(level.drawdown) || !Number.isFinite(level.allocation) || level.allocation <= 0 || level.allocation > 100) {
      throw new Error('Levels need unique drawdowns above 0%, and positive allocations up to 100%.')
    }
    seen.add(level.drawdown)
  }
  if (Math.abs(config.initialAllocation + config.levels.reduce((sum, level) => sum + level.allocation, 0) - 100) > 1e-8) {
    throw new Error('Initial and correction allocations must total 100%.')
  }
  config.levels.sort((a, b) => a.drawdown - b.drawdown)
  return config
}

export function createStrategyMonth(config, month) {
  config = validateStrategy(config)
  const [year, monthNumber] = month.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  return {
    id: `${config.schemeCode}:${month}`,
    schemeCode: config.schemeCode,
    month, year, monthNumber, config,
    budgetPaise: Math.round(config.monthlyBudget * 100),
    allocatedPaise: 0,
    remainingPaise: Math.round(config.monthlyBudget * 100),
    monthlyHighNAV: null,
    currentNAV: null,
    currentDrawdown: null,
    navDate: null,
    executedTriggers: [],
    cutoffDate: `${month}-${String(Math.min(config.cutoffDay, lastDay)).padStart(2, '0')}`,
    cutoffNAVDate: null,
    cutoffStatus: 'pending',
    status: 'waiting_for_nav',
  }
}

export function allocationPaise(state, percent) {
  return Math.floor(state.budgetPaise * percent / 100 + 1e-8)
}

// Replay actual published NAV dates chronologically. Catch-up uses the same
// engine as daily monitoring or future backtests; never invent a weekend NAV.
export function evaluateStrategyMonth(previous, history, asOf) {
  const state = structuredClone(previous)
  const recommendations = []
  const byDate = new Map()
  for (const row of history || []) {
    if (!Number.isFinite(row.t) || !Number.isFinite(row.nav) || row.nav <= 0) continue
    const instant = new Date(row.t)
    if (!Number.isFinite(instant.getTime())) continue
    const date = instant.toISOString().slice(0, 10)
    if (date <= asOf) byDate.set(date, row.nav)
  }
  for (const [date, nav] of [...byDate].sort(([a], [b]) => a.localeCompare(b))) {
    if (date < `${state.month}-01` || (state.navDate && date <= state.navDate)) continue
    const inMonth = date.slice(0, 7) === state.month
    // A month-end holiday can push a configured cutoff into the next month.
    if (!inMonth && (state.cutoffNAVDate || date < state.cutoffDate)) continue
    if (inMonth) {
      state.monthlyHighNAV = Math.max(state.monthlyHighNAV || 0, nav)
      state.currentNAV = nav
      state.currentDrawdown = (state.monthlyHighNAV - nav) / state.monthlyHighNAV * 100
      state.navDate = date
    }

    const add = (kind, triggers) => {
      let available = state.remainingPaise
      const breakdown = triggers.map((trigger) => {
        const amountPaise = Math.min(available, trigger.amountPaise)
        available -= amountPaise
        return { ...trigger, amountPaise }
      })
      const amountPaise = state.remainingPaise - available
      const keys = breakdown.map((trigger) => trigger.key)
      state.executedTriggers.push(...keys)
      state.allocatedPaise += amountPaise
      state.remainingPaise = available
      if (amountPaise > 0) recommendations.push({
        id: `${state.id}:${keys.join('+')}`,
        monthId: state.id, schemeCode: state.schemeCode, month: state.month,
        kind, navDate: date, nav, drawdown: state.currentDrawdown,
        amountPaise, breakdown,
        triggerKeys: keys.map((key) => `${state.id}:${key}`),
        status: 'pending',
      })
    }

    // Initial comes first even if the first available NAV is on the cutoff.
    if (inMonth && !state.executedTriggers.includes('initial')) {
      add('initial', [{ key: 'initial', allocation: state.config.initialAllocation,
        amountPaise: allocationPaise(state, state.config.initialAllocation) }])
    }
    // Cutoff takes precedence over corrections: a single remaining-budget alert.
    if (date >= state.cutoffDate && !state.cutoffNAVDate) {
      state.cutoffNAVDate = date
      state.cutoffStatus = 'reached'
      if (state.remainingPaise > 0) add('cutoff', [{ key: 'cutoff', amountPaise: state.remainingPaise }])
    } else if (inMonth && state.remainingPaise > 0) {
      const pending = state.config.levels.filter((level) =>
        state.currentDrawdown + 1e-10 >= level.drawdown
        && !state.executedTriggers.includes(`drawdown:${level.drawdown}`))
      if (pending.length) add('correction', pending.map((level) => ({
        key: `drawdown:${level.drawdown}`, ...level,
        amountPaise: allocationPaise(state, level.allocation),
      })))
    }
    if (!inMonth) break
  }
  state.status = state.remainingPaise === 0 ? 'complete' : state.navDate ? 'active' : 'waiting_for_nav'
  if (!state.cutoffNAVDate && asOf >= state.cutoffDate) {
    state.cutoffStatus = state.remainingPaise > 0 ? 'waiting_for_nav' : 'not_needed'
  }
  return { state, recommendations }
}

export function recommendationMessage(recommendation, money) {
  const amount = money(recommendation.amountPaise / 100)
  if (recommendation.kind === 'initial') return `Invest ${amount} — initial monthly allocation.`
  if (recommendation.kind === 'cutoff') return `Monthly cutoff reached. Invest remaining ${amount}.`
  const levels = recommendation.breakdown.map((level) => `${level.drawdown}%`).join(' and ')
  return `${Number(recommendation.drawdown.toFixed(2))}% correction reached. ${levels} ${recommendation.breakdown.length > 1 ? 'levels' : 'level'} triggered. Invest ${amount}.`
}
