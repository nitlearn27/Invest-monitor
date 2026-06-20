// Generic per-asset tab (Stocks / ETFs / Mutual Funds), driven by `type`.
import { useState } from 'react'
import HoldingsTable from './HoldingsTable.jsx'
import SourceLegend from './SourceLegend.jsx'
import { sourceRowClassName, sourceRowStyle } from '../lib/sourceStyle.js'
import { EmptyState } from './StateViews.jsx'
import { platformKeyOf } from '../config.js'
import { formatINR, formatNumber, formatPct } from '../lib/format.js'

const sum = (arr, f) => arr.reduce((a, x) => a + (f(x) || 0), 0)

function pnlClass(v) {
  if (v == null) return ''
  return v >= 0 ? 'pos' : 'neg'
}

export default function AssetTab({ type, label, holdings }) {
  // Optional filter to a single broker platform (tap a legend chip). Resets per
  // tab since each tab mounts its own AssetTab.
  const [activeSource, setActiveSource] = useState(null)

  const allRows = holdings.filter((h) => h.type === type)
  if (allRows.length === 0) {
    return <EmptyState title={`No ${label.toLowerCase()} found`}>Refresh to pull the matching sheet.</EmptyState>
  }
  const rows = activeSource ? allRows.filter((h) => platformKeyOf(h.source) === activeSource) : allRows

  const isMF = type === 'mf'
  const invested = sum(rows, (h) => h.invested)
  const current = sum(rows, (h) => h.current)
  const pnl = current - invested
  const pnlPct = invested ? (pnl / invested) * 100 : null

  const pnlCols = [
    { key: 'current', label: 'Current', align: 'right', render: (r) => formatINR(r.current) },
    {
      key: 'pnl',
      label: 'P&L',
      align: 'right',
      render: (r) => <span className={pnlClass(r.pnl)}>{formatINR(r.pnl)}</span>,
    },
    {
      key: 'pnlPct',
      label: 'P&L %',
      align: 'right',
      render: (r) => <span className={pnlClass(r.pnlPct)}>{formatPct(r.pnlPct)}</span>,
    },
  ]

  const columns = isMF
    ? [
        { key: 'name', label: 'Fund', render: (r) => <span className="cell-name">{r.name}</span> },
        { key: 'invested', label: 'Invested', align: 'right', render: (r) => formatINR(r.invested) },
        ...pnlCols,
      ]
    : [
        { key: 'name', label: 'Name', render: (r) => <span className="cell-name">{r.name}</span> },
        { key: 'qty', label: 'Qty', align: 'right', render: (r) => formatNumber(r.qty) },
        { key: 'avgPrice', label: 'Avg price', align: 'right', render: (r) => formatINR(r.avgPrice, { paise: true }) },
        { key: 'invested', label: 'Invested', align: 'right', render: (r) => formatINR(r.invested) },
        {
          key: 'marketPrice',
          label: 'Market price',
          align: 'right',
          render: (r) => (r.marketPrice != null ? formatINR(r.marketPrice, { paise: true }) : '—'),
        },
        ...pnlCols,
      ]

  const totalPnlCells = (
    <>
      <td className="ta-r">{formatINR(current)}</td>
      <td className={`ta-r ${pnlClass(pnl)}`}>{formatINR(pnl)}</td>
      <td className={`ta-r ${pnlClass(pnlPct)}`}>{formatPct(pnlPct)}</td>
    </>
  )

  const footer = (
    <tr className="table__total">
      <td>
        {rows.length} {label.toLowerCase()}
      </td>
      {isMF ? (
        <>
          <td className="ta-r">{formatINR(invested)}</td>
          {totalPnlCells}
        </>
      ) : (
        <>
          <td className="ta-r" />
          <td className="ta-r" />
          <td className="ta-r">{formatINR(invested)}</td>
          <td className="ta-r" />
          {totalPnlCells}
        </>
      )}
    </tr>
  )

  return (
    <div className="tab">
      <div className="strip">
        <div className="strip__item">
          <span className="strip__label">Invested</span>
          <span className="strip__value">{formatINR(invested)}</span>
        </div>
        <div className="strip__item">
          <span className="strip__label">Current</span>
          <span className="strip__value">{formatINR(current)}</span>
        </div>
        <div className="strip__item">
          <span className="strip__label">Unrealized P&L</span>
          <span className={`strip__value ${pnlClass(pnl)}`}>
            {formatINR(pnl)} <small>({formatPct(pnlPct)})</small>
          </span>
        </div>
        <div className="strip__item">
          <span className="strip__label">Holdings</span>
          <span className="strip__value">{rows.length}</span>
        </div>
      </div>

      <div className="src-legend-row">
        <SourceLegend
          sources={allRows.map((r) => r.source)}
          active={activeSource}
          onSelect={setActiveSource}
        />
      </div>

      <HoldingsTable
        columns={columns}
        rows={rows}
        initialSort={{ key: 'invested', dir: 'desc' }}
        footer={footer}
        rowClassName={sourceRowClassName}
        rowStyle={sourceRowStyle}
      />
    </div>
  )
}
