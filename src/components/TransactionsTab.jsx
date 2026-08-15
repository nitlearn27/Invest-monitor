// Transaction log + reconciliation panel.
import { useMemo, useState } from 'react'
import HoldingsTable from './HoldingsTable.jsx'
import ReconcilePanel from './ReconcilePanel.jsx'
import { EmptyState } from './StateViews.jsx'
import { formatINR, formatNumber, formatDate } from '../lib/format.js'
import { sourceRowClassName, sourceRowStyle } from '../lib/sourceStyle.js'
import SourceLegend from './SourceLegend.jsx'
import { platformKeyOf } from '../config.js'

const ASSETS = [
  { key: 'ALL', label: 'All' },
  { key: 'stock', label: 'Stocks' },
  { key: 'etf', label: 'ETFs' },
  { key: 'mf', label: 'MF' },
]

export default function TransactionsTab({ holdings, transactions, mfTransactions = [] }) {
  const [activeSource, setActiveSource] = useState(null)
  const [side, setSide] = useState('ALL')
  const [asset, setAsset] = useState('ALL')
  const [query, setQuery] = useState('')

  // Gather distinct sources from all transactions for the legend filter.
  const allSources = useMemo(() => {
    const set = new Set()
    for (const t of transactions) {
      if (t.source) set.add(t.source)
    }
    for (const t of mfTransactions) {
      if (t.source) set.add(t.source)
    }
    return [...set]
  }, [transactions, mfTransactions])

  // Filter raw lists by selected source platform key before downstream logic (reconciliation + list)
  const filteredHoldings = useMemo(() => {
    if (!activeSource) return holdings
    return holdings.filter((h) => platformKeyOf(h.source) === activeSource)
  }, [holdings, activeSource])

  const filteredTransactions = useMemo(() => {
    if (!activeSource) return transactions
    return transactions.filter((t) => platformKeyOf(t.source) === activeSource)
  }, [transactions, activeSource])

  const filteredMfTransactions = useMemo(() => {
    if (!activeSource) return mfTransactions
    return mfTransactions.filter((t) => platformKeyOf(t.source) === activeSource)
  }, [mfTransactions, activeSource])

  // MF transactions carry units/nav/amount; map them onto the equity table's
  // field names (qty/price/value) so the same columns render both. Opening
  // balances are a position carried in, not money moved on that day — labelled
  // apart on both sides so they never read as a giant buy.
  const allTxns = useMemo(
    () => [
      ...filteredTransactions.map((t) => (t.opening ? { ...t, side: 'OPENING' } : t)),
      ...filteredMfTransactions.map((t) => ({
        date: t.date,
        name: t.name,
        symbol: null,
        type: 'mf',
        side: t.opening ? 'OPENING' : t.side,
        qty: t.units,
        price: t.nav,
        value: t.amount,
        source: t.source || 'My MFs',
      })),
    ],
    [filteredTransactions, filteredMfTransactions],
  )

  const filtered = useMemo(() => {
    return allTxns.filter((t) => {
      if (side !== 'ALL' && t.side !== side) return false
      if (asset !== 'ALL' && t.type !== asset) return false
      if (query && !`${t.name} ${t.symbol}`.toLowerCase().includes(query.toLowerCase())) return false
      return true
    })
  }, [allTxns, side, asset, query])

  const columns = [
    { key: 'date', label: 'Date', render: (r) => formatDate(r.date), sortValue: (r) => r.date?.getTime() || 0 },
    { key: 'name', label: 'Scrip', render: (r) => <span className="cell-name">{r.name}</span> },
    {
      key: 'value',
      label: 'Value',
      align: 'right',
      render: (r) => formatINR(r.value != null ? r.value : (r.qty || 0) * (r.price || 0)),
      sortValue: (r) => (r.value != null ? r.value : (r.qty || 0) * (r.price || 0)),
    },
    { key: 'qty', label: 'Qty', align: 'right', render: (r) => formatNumber(r.qty) },
    { key: 'price', label: 'Price', align: 'right', render: (r) => formatINR(r.price, { paise: true }) },
    {
      key: 'side',
      label: 'Type',
      render: (r) => {
        const tone = r.side === 'BUY' ? 'ok' : r.side === 'SELL' ? 'warn' : 'muted-badge'
        return <span className={`badge badge--${tone}`}>{r.side}</span>
      },
    },
  ]

  return (
    <div className="tab">
      <div className="src-legend-row">
        <SourceLegend
          sources={allSources}
          active={activeSource}
          onSelect={setActiveSource}
        />
      </div>

      <ReconcilePanel holdings={filteredHoldings} transactions={filteredTransactions} />

      <div className="toolbar">
        <div className="segmented">
          {['ALL', 'BUY', 'SELL'].map((s) => (
            <button key={s} className={side === s ? 'active' : ''} onClick={() => setSide(s)}>
              {s === 'ALL' ? 'All' : s}
            </button>
          ))}
        </div>
        <div className="segmented">
          {ASSETS.map((a) => (
            <button key={a.key} className={asset === a.key ? 'active' : ''} onClick={() => setAsset(a.key)}>
              {a.label}
            </button>
          ))}
        </div>
        <input
          className="search"
          placeholder="Search scrip or symbol…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="muted">{filtered.length} transactions</span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No transactions match">Try clearing the filters.</EmptyState>
      ) : (
        <HoldingsTable
          columns={columns}
          rows={filtered}
          initialSort={{ key: 'date', dir: 'desc' }}
          rowClassName={sourceRowClassName}
          rowStyle={sourceRowStyle}
        />
      )}
    </div>
  )
}
