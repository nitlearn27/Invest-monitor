// Generic per-asset tab (Stocks / ETFs / Mutual Funds), driven by `type`.
import { useState } from 'react'
import HoldingsTable from './HoldingsTable.jsx'
import SourceLegend from './SourceLegend.jsx'
import { sourceRowClassName, sourceRowStyle } from '../lib/sourceStyle.js'
import { EmptyState } from './StateViews.jsx'
import { platformKeyOf, platformOf } from '../config.js'
import { formatINR, formatNumber, formatPct } from '../lib/format.js'

const sum = (arr, f) => arr.reduce((a, x) => a + (f(x) || 0), 0)

function pnlClass(v) {
  if (v == null) return ''
  return v >= 0 ? 'pos' : 'neg'
}

export default function AssetTab({ type, label, holdings, foldTo, rankOf }) {
  // Optional filter to a single broker platform (tap a legend chip). Resets per
  // tab since each tab mounts its own AssetTab.
  const [activeSource, setActiveSource] = useState(null)
  // When `foldTo` is set, only the top-ranked N rows (per `rankOf`, e.g. most
  // recently bought) show up front; "See all" reveals the rest in a scrollable
  // table.
  const [expanded, setExpanded] = useState(false)

  const allRows = holdings.filter((h) => h.type === type)
  if (allRows.length === 0) {
    return <EmptyState title={`No ${label.toLowerCase()} found`}>Refresh to pull the matching sheet.</EmptyState>
  }
  const rows = activeSource ? allRows.filter((h) => platformKeyOf(h.source) === activeSource) : allRows

  const foldable = foldTo != null && rows.length > foldTo
  const tableRows =
    foldable && !expanded
      ? [...rows]
          .sort(
            (a, b) =>
              (rankOf?.(b) ?? 0) - (rankOf?.(a) ?? 0) || (b.invested ?? 0) - (a.invested ?? 0),
          )
          .slice(0, foldTo)
      : rows

  const isMF = type === 'mf'
  const invested = sum(rows, (h) => h.invested)
  const current = sum(rows, (h) => h.current)
  const pnl = current - invested
  const pnlPct = invested ? (pnl / invested) * 100 : null

  // 1D P&L calculations
  const totalOneDayChange = sum(rows, (h) => h.oneDayChange)
  const rowsWithOneDay = rows.filter((r) => r.oneDayChange != null)
  const prevValForOneDay = sum(rowsWithOneDay, (h) => h.current - h.oneDayChange)
  const totalOneDayChangePct = prevValForOneDay > 0 ? (totalOneDayChange / prevValForOneDay) * 100 : null

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

  const renderName = (r) => {
    const platform = platformOf(r.source)
    const initial = platform ? platform.label[0].toUpperCase() : null
    return (
      <span className="cell-name">
        {r.name}
        {initial && (
          <span className="cell-source-initial" style={{ color: platform.color, marginLeft: '6px', fontWeight: 'bold' }}>
            ({initial})
          </span>
        )}
      </span>
    )
  }

  const columns = isMF
    ? [
        { key: 'name', label: 'Fund', render: renderName },
        {
          key: 'oneDayChange',
          label: '1D P&L',
          align: 'right',
          sortValue: (r) => r.oneDayChangePct,
          render: (r) => {
            if (r.oneDayChangePct == null) return '—'
            return (
              <span className={pnlClass(r.oneDayChangePct)}>
                {r.oneDayChange != null ? (
                  <>
                    {formatINR(r.oneDayChange)} <small>({formatPct(r.oneDayChangePct)})</small>
                  </>
                ) : (
                  formatPct(r.oneDayChangePct)
                )}
              </span>
            )
          },
        },
        {
          key: 'pnlPct',
          label: 'Total P&L %',
          align: 'right',
          render: (r) => <span className={pnlClass(r.pnlPct)}>{formatPct(r.pnlPct)}</span>,
        },
        {
          key: 'pnl',
          label: 'P&L',
          align: 'right',
          render: (r) => <span className={pnlClass(r.pnl)}>{formatINR(r.pnl)}</span>,
        },
        { key: 'qty', label: 'Units', align: 'right', render: (r) => formatNumber(r.qty) },
        { key: 'invested', label: 'Invested', align: 'right', render: (r) => formatINR(r.invested) },
        { key: 'current', label: 'Current', align: 'right', render: (r) => formatINR(r.current) },
      ]
    : [
        { key: 'name', label: 'Name', render: renderName },
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
          <td className={`ta-r ${pnlClass(totalOneDayChange)}`}>
            {totalOneDayChange !== 0 ? (
              <>
                {formatINR(totalOneDayChange)} <small>({formatPct(totalOneDayChangePct)})</small>
              </>
            ) : '—'}
          </td>
          <td className={`ta-r ${pnlClass(pnlPct)}`}>{formatPct(pnlPct)}</td>
          <td className={`ta-r ${pnlClass(pnl)}`}>{formatINR(pnl)}</td>
          <td className="ta-r" />
          <td className="ta-r">{formatINR(invested)}</td>
          <td className="ta-r">{formatINR(current)}</td>
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
        rows={tableRows}
        initialSort={{ key: 'invested', dir: 'desc' }}
        footer={footer}
        rowClassName={sourceRowClassName}
        rowStyle={sourceRowStyle}
        className={foldable && expanded ? 'table-wrap--scroll' : undefined}
      />

      {foldable && (
        <button type="button" className="see-more" onClick={() => setExpanded((v) => !v)}>
          {expanded
            ? `Show ${foldTo} recently bought`
            : `See all ${rows.length} ${label.toLowerCase()}`}
        </button>
      )}
    </div>
  )
}
