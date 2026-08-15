// Derive holdings from the transaction sheets, so the manually maintained
// "My Stocks" / "My MFs" / "MF Groww" holdings sheets no longer need upkeep.
//
// The transaction pastes are complete history (verified: aggregating them
// reproduces the last holdings sheets exactly — INDmoney stocks to the paisa,
// MFs to <0.5% once the recurring SIP legs are folded in; the Groww MF sheet
// reproduces its two active funds to 0.1% on units). Purchases that predate a
// broker's transactions page live as ordinary rows in the same sheet: the
// INDmoney ELSS lump sums, and on Groww one `Opening` row per stopped-but-still-
// held fund. So no separate opening-balance store is needed.
//
// Runs at view time (Dashboard), on transactions already passed through
// withRecurringSips + enrichMfTransactions, so synthetic SIP legs exist and
// carry units resolved from NAV history. Until the NAV map arrives, a SIP leg
// without units contributes only its amount — qty is briefly understated and
// corrects itself when NAVs load.
//
// Current value / P&L stay null here; they are recomputed live downstream by
// enrichHoldings (Yahoo price) and enrichMfHoldings (mfapi NAV), same as the
// sheet-based holdings were. If the old holdings sheets are still present in
// Drive, the derived rows replace them (the sheets are stale by definition).

const EPS = 1e-6

const asc = (txns) => [...txns].sort((a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0))
const nameKeyOf = (t) => String(t.name || '').trim().toLowerCase()

function toHolding(g, source) {
  return {
    name: g.name,
    isin: null,
    symbol: g.symbol ?? null,
    type: g.type,
    qty: g.qty,
    avgPrice: g.qty > EPS ? g.invested / g.qty : null,
    invested: g.invested,
    current: null,
    pnl: null,
    pnlPct: null,
    marketPrice: null,
    folio: null,
    source,
    asOf: null,
  }
}

// Broker stock/ETF transaction sheets complete enough to derive holdings from.
export const DERIVED_EQUITY_SOURCES = ['My Stocks', 'Stocks Groww']

// Stocks/ETFs from one broker's transactions sheet. BUYs accumulate qty and
// cost; SELLs reduce qty and release cost at the running average (so avgPrice
// reflects the remaining position, matching how the broker reports it).
// Positions are keyed by SYMBOL first: the holdings paste and the transaction
// page routinely spell the same scrip differently ("ICICI Prud Gold ETF" vs
// "ICICI Prudential Gold ETF"), and only the ticker ties them together.
export function deriveEquityHoldings(transactions = [], source = 'My Stocks') {
  const groups = new Map()
  for (const t of asc(transactions)) {
    if (t.source !== source || !t.qty) continue
    const k = t.symbol || nameKeyOf(t)
    if (!groups.has(k)) {
      groups.set(k, { name: t.name, symbol: t.symbol || null, type: t.type || 'stock', qty: 0, invested: 0 })
    }
    const g = groups.get(k)
    if (t.side === 'SELL') {
      const sold = Math.min(t.qty, g.qty)
      if (g.qty > EPS) g.invested -= sold * (g.invested / g.qty)
      g.qty -= sold
    } else {
      g.qty += t.qty
      g.invested += t.qty * (t.price || 0)
    }
  }
  return [...groups.values()].filter((g) => g.qty > EPS).map((g) => toHolding(g, source))
}

// Broker MF-transaction sheets complete enough to derive that broker's holdings
// from. Axis and Coin have no transaction sheet, so their holdings pastes stay.
export const DERIVED_MF_SOURCES = ['My MFs', 'MF Groww']

// MFs from one broker's MF transactions sheet (+ synthetic SIP legs). Amount is
// the sheet's ₹ figure; units come from the sheet or NAV enrichment. SELLs
// release cost proportionally by units (falling back to the redemption amount
// when a sell row carries no units). `Opening` rows are ordinary buys here —
// they exist precisely so the position has its units.
export function deriveMfHoldings(mfTransactions = [], source = 'My MFs') {
  const groups = new Map()
  for (const t of asc(mfTransactions)) {
    if (t.source !== source) continue
    const k = nameKeyOf(t)
    if (!groups.has(k)) groups.set(k, { name: t.name, type: 'mf', qty: 0, invested: 0 })
    const g = groups.get(k)
    if (t.side === 'SELL') {
      if (t.units != null && g.qty > EPS) {
        const sold = Math.min(t.units, g.qty)
        g.invested -= sold * (g.invested / g.qty)
        g.qty -= sold
      } else if (t.amount != null) {
        g.invested -= t.amount
      }
    } else {
      g.qty += t.units || 0
      g.invested += t.amount || 0
    }
  }
  return [...groups.values()].filter((g) => g.qty > EPS || g.invested > EPS).map((g) => toHolding(g, source))
}

// Replace the sheet-based holdings with transaction-derived ones. Each side
// kicks in only when its transactions exist, so a drag-and-drop of just the old
// holdings sheets still works.
//
// Both sides keep a per-POSITION fallback: a scrip or fund still on the
// (retired) holdings paste that the transaction sheet has no rows for is left
// alone rather than dropped. A position must never disappear because its
// opening-balance row hasn't been added yet — the stale value is wrong, but
// silently losing lakhs is worse. Once the paste is gone the fallback has
// nothing to hold and goes dormant.
const equityKey = (h) => h.symbol || nameKeyOf(h)

export function withDerivedHoldings(holdings = [], transactions = [], mfTransactions = []) {
  let out = holdings
  const replace = (src, derived, keyOf) => {
    if (!derived.length) return
    const keys = new Set(derived.map(keyOf))
    out = out.filter((h) => h.source !== src || !keys.has(keyOf(h))).concat(derived)
  }
  for (const src of DERIVED_EQUITY_SOURCES) {
    replace(src, deriveEquityHoldings(transactions, src), equityKey)
  }
  for (const src of DERIVED_MF_SOURCES) {
    replace(src, deriveMfHoldings(mfTransactions, src), nameKeyOf)
  }
  return out
}
