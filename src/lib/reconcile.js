// Reconcile equity transactions against current stock/ETF holdings so the user
// can confirm trades reflected in INDmoney.
//
// Transactions cover one financial year, while holdings may include positions
// bought earlier — so a holding that EXCEEDS this period's net trades is
// expected (older accumulation), not a problem. The only real red flag is when
// the holding is SHORT of what was traded this period (a trade may not have
// reflected). Statuses:
//   match       -> net transacted qty equals current holding qty
//   reflected   -> holding >= net trades; period trades are reflected, surplus
//                  is earlier accumulation
//   shortfall   -> holding < net trades (a buy may not be reflected — check)
//   pre-period  -> held, but no transaction this period (bought earlier)
//   closed      -> transactions net to zero and no holding (fully exited)

const EPS = 0.001

// Holdings (e.g. "Motilal NASDAQ100") and orders (e.g. "Motilal Oswal NASDAQ 100
// ETF") name the same scrip differently and carry no ISIN. Build a fuzzy key
// from the first two significant name tokens so they reconcile.
const STOP = new Set(['ltd', 'limited', 'etf', 'fund', 'the', 'india', 'oswal', 'ind', 'co', 'of'])
const ABBREV = { pru: 'prudential', prud: 'prudential' }
function nameKey(name) {
  const toks = String(name || '')
    .toLowerCase()
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .map((t) => ABBREV[t] || t)
    .filter((t) => t && !STOP.has(t) && !/^\d+$/.test(t))
  return toks.slice(0, 2).join(' ')
}
const keyOf = (isin, name) => (isin ? isin.toUpperCase() : nameKey(name))

export function reconcile(holdings, transactions) {
  // Only stock/ETF holdings are comparable to equity transactions.
  const equityHoldings = holdings.filter((h) => h.type === 'stock' || h.type === 'etf')

  const byKey = new Map()
  const ensure = (k, seed) => {
    if (!byKey.has(k)) {
      byKey.set(k, {
        key: k,
        isin: null,
        name: null,
        type: null,
        holdingQty: null,
        buyQty: 0,
        sellQty: 0,
        txnCount: 0,
      })
    }
    const row = byKey.get(k)
    Object.assign(row, seed)
    return row
  }

  for (const h of equityHoldings) {
    const k = keyOf(h.isin, h.name)
    ensure(k, { isin: h.isin, name: h.name, type: h.type, holdingQty: h.qty ?? 0, source: h.source })
  }

  for (const t of transactions) {
    const k = keyOf(t.isin, t.name)
    const row = ensure(k, {})
    if (!row.name) row.name = t.name
    if (!row.isin && t.isin) row.isin = t.isin
    if (!row.source && t.source) row.source = t.source
    if (t.side === 'BUY') row.buyQty += t.qty || 0
    else if (t.side === 'SELL') row.sellQty += t.qty || 0
    row.txnCount += 1
  }

  const rows = [...byKey.values()].map((r) => {
    const netTxn = r.buyQty - r.sellQty
    const hasTxn = r.txnCount > 0
    const hasHolding = r.holdingQty != null
    const diff = hasHolding ? (r.holdingQty ?? 0) - netTxn : null
    let status
    if (!hasTxn && hasHolding) status = 'pre-period'
    else if (hasTxn && !hasHolding) status = Math.abs(netTxn) < EPS ? 'closed' : 'shortfall'
    else if (Math.abs(diff) < EPS) status = 'match'
    else if (diff > 0) status = 'reflected' // holding exceeds period trades (earlier buys)
    else status = 'shortfall' // holding short of what was traded — investigate

    return { ...r, netTxn, diff, status }
  })

  // Surface problems first, then most active.
  const rank = { shortfall: 0, match: 1, reflected: 2, 'pre-period': 3, closed: 4 }
  rows.sort((a, b) => rank[a.status] - rank[b.status] || b.txnCount - a.txnCount)

  const summary = rows.reduce(
    (acc, r) => ((acc[r.status] = (acc[r.status] || 0) + 1), acc),
    {},
  )

  return { rows, summary }
}
