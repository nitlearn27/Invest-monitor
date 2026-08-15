// Derivations for the Monthly Investments tab.

// Recurring SIPs the user has confirmed but that aren't (fully) reflected in the
// pasted INDmoney statement. Hardcoded for now; one synthetic BUY is generated
// per month on `day` from `start` (YYYY-MM), skipping any month where a real
// matching transaction already exists on that day (so it never double-counts).
// `start` must be explicit: the txn sheet now reaches back to a 2015 lump-sum
// row, so deriving the start from the earliest transaction would fabricate a
// decade of phantom SIP legs. Verified against the sheet snapshot: legs from
// 2025-05 reproduce the holding's unit gap to within 0.3%.
const RECURRING_SIPS = [{ fund: 'Edelweiss Mid Cap Fund', amount: 10000, day: 4, start: '2025-05' }]

const sameFund = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase()

// Augment MF transactions with the hardcoded recurring SIPs, from each SIP's
// start month through the current month (not future-dated). Idempotent: legs
// already present (or a real same-day transaction) are skipped, so applying it
// to an already-augmented list adds nothing.
export function withRecurringSips(mfTxns = [], now = new Date()) {
  if (!RECURRING_SIPS.length) return mfTxns
  const times = mfTxns.map((t) => t.date?.getTime()).filter(Boolean)
  const fallback = times.length ? new Date(Math.min(...times)) : new Date(now.getFullYear(), now.getMonth() - 11, 1)
  const extra = []

  for (const sip of RECURRING_SIPS) {
    const [sy, sm] = sip.start ? sip.start.split('-').map(Number) : []
    const start = sip.start ? new Date(sy, sm - 1, 1) : fallback
    let y = start.getFullYear()
    let m = start.getMonth()
    while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth())) {
      const date = new Date(y, m, sip.day)
      const already = mfTxns.some(
        (t) =>
          t.date &&
          sameFund(t.name, sip.fund) &&
          t.date.getFullYear() === y &&
          t.date.getMonth() === m &&
          t.date.getDate() === sip.day,
      )
      if (date <= now && !already) {
        extra.push({ date, name: sip.fund, side: 'BUY', units: null, nav: null, amount: sip.amount, sip: true, source: 'My MFs' })
      }
      m += 1
      if (m > 11) {
        m = 0
        y += 1
      }
    }
  }
  return [...mfTxns, ...extra]
}

// Equity transactions carry a `type` (from the holdings/orders classifier);
// fall back to the ISIN prefix for older data (INE… = stock, INF… = ETF).
function txnType(t) {
  if (t.type === 'stock' || t.type === 'etf') return t.type
  return (t.isin || '').toUpperCase().startsWith('INF') ? 'etf' : 'stock'
}

function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// Opening-balance rows carry a position the broker's transaction page doesn't
// reach back to (see classify.js). They give the holding its units, but they are
// not money added in the month they are dated, so every "what did I invest"
// aggregate skips them.
const isContribution = (t) => t.side === 'BUY' && t.date && !t.opening

// Consolidated monthly invested across MF, Stocks and ETFs (BUY only).
// MF amounts come from the MF-transactions statement (units*nav); equity from
// qty*price, classed stock/ETF by ISIN.
export function monthlyInvestments(equityTxns = [], mfTxns = []) {
  const map = new Map()
  const ensure = (d) => {
    const key = monthKey(d)
    if (!map.has(key)) {
      map.set(key, {
        month: key,
        label: d.toLocaleString('en-IN', { month: 'short', year: 'numeric' }),
        mf: 0,
        stock: 0,
        etf: 0,
        total: 0,
        count: 0,
      })
    }
    return map.get(key)
  }

  for (const t of equityTxns) {
    if (!isContribution(t)) continue
    const row = ensure(t.date)
    const val = (t.qty || 0) * (t.price || 0)
    row[txnType(t)] += val
    row.total += val
    row.count += 1
  }

  for (const t of mfTxns) {
    if (!isContribution(t)) continue
    const row = ensure(t.date)
    const val = t.amount || 0
    row.mf += val
    row.total += val
    row.count += 1
  }

  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month))
}

// Market-cap buckets for mutual funds, inferred from the fund name.
const CAPS = [
  { key: 'large', label: 'Large Cap', test: (n) => n.includes('large'), color: '#5b8cff' },
  { key: 'mid', label: 'Mid Cap', test: (n) => n.includes('mid'), color: '#22c7a9' },
  { key: 'small', label: 'Small Cap', test: (n) => n.includes('small'), color: '#ffb454' },
  { key: 'flexi', label: 'Flexi / Multi Cap', test: (n) => n.includes('flexi') || n.includes('multi'), color: '#ff6b78' },
  { key: 'elss', label: 'ELSS (Tax Saver)', test: (n) => n.includes('elss') || n.includes('tax saver'), color: '#b07cff' },
]
const OTHER = { key: 'other', label: 'Other / Thematic', color: '#8a93a8' }

export function capOf(name) {
  const n = (name || '').toLowerCase()
  return CAPS.find((c) => c.test(n)) || OTHER
}

function addCap(map, c, amt) {
  if (!map.has(c.key)) map.set(c.key, { key: c.key, label: c.label, color: c.color, value: 0, count: 0 })
  const g = map.get(c.key)
  g.value += amt
  g.count += 1
}

const toSegments = (capMap, total) =>
  [...capMap.values()]
    .map((s) => ({ ...s, pct: total ? (s.value / total) * 100 : 0 }))
    .sort((a, b) => b.value - a.value)

// MF market-cap breakdown from MF transactions (BUY), both overall ("all") and
// per month. Each entry has donut-ready `segments` (Large/Mid/Small/…) + total.
export function mfCapBreakdown(mfTxns = []) {
  const monthsMap = new Map()
  const allCaps = new Map()
  let allTotal = 0

  for (const t of mfTxns) {
    if (!isContribution(t)) continue
    const amt = t.amount || 0
    const c = capOf(t.name)
    allTotal += amt
    addCap(allCaps, c, amt)

    const key = monthKey(t.date)
    if (!monthsMap.has(key)) {
      monthsMap.set(key, {
        month: key,
        label: t.date.toLocaleString('en-IN', { month: 'short', year: 'numeric' }),
        total: 0,
        caps: new Map(),
      })
    }
    const e = monthsMap.get(key)
    e.total += amt
    addCap(e.caps, c, amt)
  }

  const months = [...monthsMap.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((e) => ({ month: e.month, label: e.label, total: e.total, segments: toSegments(e.caps, e.total) }))

  return { all: { month: 'all', label: 'All months', total: allTotal, segments: toSegments(allCaps, allTotal) }, months }
}

// Distinct colors for individual stocks/ETFs in the equity donut.
const SCRIP_COLORS = [
  '#5b8cff', '#2cc0d6', '#22c7a9', '#b07cff', '#ffbf63',
  '#ff7b86', '#7c9cff', '#4dd0a8', '#e7916b', '#6bd0e7',
]
const firstWord = (s) => (s || '').trim().split(/\s+/)[0] || s

function addScrip(map, name, val) {
  const key = name || '?'
  if (!map.has(key)) map.set(key, { name: key, value: 0, count: 0 })
  const g = map.get(key)
  g.value += val
  g.count += 1
}

// Stock/ETF breakdown by individual scrip (by invested value), overall + per
// month. Each scrip keeps a stable color; legend labels use the first word.
export function equityBreakdown(equityTxns = []) {
  const monthsMap = new Map()
  const allScrips = new Map()
  let allTotal = 0

  for (const t of equityTxns) {
    if (!isContribution(t)) continue
    const val = (t.qty || 0) * (t.price || 0)
    allTotal += val
    addScrip(allScrips, t.name, val)

    const key = monthKey(t.date)
    if (!monthsMap.has(key)) {
      monthsMap.set(key, {
        month: key,
        label: t.date.toLocaleString('en-IN', { month: 'short', year: 'numeric' }),
        total: 0,
        scrips: new Map(),
      })
    }
    const e = monthsMap.get(key)
    e.total += val
    addScrip(e.scrips, t.name, val)
  }

  // Stable color per scrip, ordered by overall invested value.
  const colorOf = new Map(
    [...allScrips.values()].sort((a, b) => b.value - a.value).map((s, i) => [s.name, SCRIP_COLORS[i % SCRIP_COLORS.length]]),
  )
  const toSegs = (scripMap, total) =>
    [...scripMap.values()]
      .sort((a, b) => b.value - a.value)
      .map((s) => ({
        key: s.name,
        label: firstWord(s.name),
        full: s.name,
        value: s.value,
        count: s.count,
        pct: total ? (s.value / total) * 100 : 0,
        color: colorOf.get(s.name),
      }))

  const months = [...monthsMap.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((e) => ({ month: e.month, label: e.label, total: e.total, segments: toSegs(e.scrips, e.total) }))

  return { all: { month: 'all', label: 'All months', total: allTotal, segments: toSegs(allScrips, allTotal) }, months }
}
