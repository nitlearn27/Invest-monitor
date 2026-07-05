// Derive the INDmoney holdings from the transaction sheets, so the manually
// maintained "My Stocks" / "My MFs" holdings sheets no longer need upkeep.
//
// The transaction pastes are complete history (verified: aggregating them
// reproduces the last holdings sheets exactly — stocks to the paisa, MFs to
// <0.5% once the recurring SIP legs are folded in). Purchases that predate the
// INDmoney transactions page (the ELSS lump sums) live as ordinary rows in the
// MF Transactions sheet, so no separate opening-balance store is needed.
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

// Stocks/ETFs from the "Stocks Transactions" sheet. BUYs accumulate qty and
// cost; SELLs reduce qty and release cost at the running average (so avgPrice
// reflects the remaining position, matching how INDmoney reports it).
export function deriveEquityHoldings(transactions = []) {
  const groups = new Map()
  for (const t of asc(transactions)) {
    if (t.source !== 'My Stocks' || !t.qty) continue
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
  return [...groups.values()].filter((g) => g.qty > EPS).map((g) => toHolding(g, 'My Stocks'))
}

// MFs from the "MF Transactions" sheet (+ synthetic SIP legs). Amount is the
// sheet's ₹ figure; units come from the sheet or NAV enrichment. SELLs release
// cost proportionally by units (falling back to the redemption amount when a
// sell row carries no units).
export function deriveMfHoldings(mfTransactions = []) {
  const groups = new Map()
  for (const t of asc(mfTransactions)) {
    if (t.source !== 'My MFs') continue
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
  return [...groups.values()].filter((g) => g.qty > EPS || g.invested > EPS).map((g) => toHolding(g, 'My MFs'))
}

// Replace the sheet-based INDmoney holdings with transaction-derived ones.
// Each side kicks in only when its transactions exist, so a drag-and-drop of
// just the old holdings sheets still works.
export function withDerivedHoldings(holdings = [], transactions = [], mfTransactions = []) {
  let out = holdings
  const equity = deriveEquityHoldings(transactions)
  if (equity.length) out = out.filter((h) => h.source !== 'My Stocks').concat(equity)
  const mfs = deriveMfHoldings(mfTransactions)
  if (mfs.length) out = out.filter((h) => h.source !== 'My MFs').concat(mfs)
  return out
}
