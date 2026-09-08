// Generic per-asset tab (Stocks / ETFs / Mutual Funds), driven by `type`.
//
// All three tabs read the same way on purpose: name (with its broker), then
// today's move, then total return, then the position itself (qty → cost →
// price) and finally what it is worth now. Stocks/ETFs carry two extra columns
// funds have no use for (avg price, market price); everything else is shared.
import { useEffect, useState } from 'react'
import HoldingsTable from './HoldingsTable.jsx'
import SourceLegend from './SourceLegend.jsx'
import { sourceRowClassName, sourceRowStyle } from '../lib/sourceStyle.js'
import { EmptyState } from './StateViews.jsx'
import { platformKeyOf, platformOf } from '../config.js'
import {
  formatAgo,
  formatDate,
  formatDateTime,
  formatDayMonth,
  formatINR,
  formatNumber,
  formatPct,
} from '../lib/format.js'

const sum = (arr, f) => arr.reduce((a, x) => a + (f(x) || 0), 0)

function pnlClass(v) {
  if (v == null) return ''
  return v >= 0 ? 'pos' : 'neg'
}

// "What day are these numbers for?" — the one thing a Refresh button can't say.
// Sits on the legend row, left of the broker chips, so it costs no vertical
// space and reads right above the figures it dates. Tapping re-pulls.
//
// A DATED source (MF NAV) shows only the day its price was struck — AMFI
// publishes one NAV per fund per day, late in the evening, so a fund fetched at
// noon is carrying the PREVIOUS day's NAV. When we asked for it is noise; the
// day it is for is the whole answer. An UNDATED source (live equity quotes,
// which move all session) has no such day, so it can only report the pull.
function FreshnessStamp({ noun, asOf, syncedAt, staleAfterMs, busy, onRefresh }) {
  // Slow tick so "4 min ago" keeps counting instead of freezing at mount.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(id)
  }, [])

  if (!asOf && !syncedAt) return null

  // Both ages are measured against `staleAfterMs`, but against different
  // clocks: a dated source ages by the day it is FOR, an undated one by when it
  // was pulled.
  const stamped = asOf ? asOf.getTime() : syncedAt?.getTime()
  const stale = stamped == null || now - stamped > staleAfterMs
  const title = [
    asOf
      ? `${noun} published for ${formatDate(asOf)}`
      : syncedAt
        ? `${noun} pulled ${formatDateTime(syncedAt)}`
        : `${noun} not fetched yet`,
    onRefresh ? 'tap to refresh' : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <button
      type="button"
      className="freshness"
      onClick={onRefresh || undefined}
      disabled={busy || !onRefresh}
      title={title}
      aria-label={title}
    >
      <span className={`freshness__dot${stale ? ' freshness__dot--stale' : ''}`} />
      <span className="freshness__key">{asOf ? `${noun} ${formatDayMonth(asOf)}` : noun}</span>
      {busy ? (
        <span className="freshness__age">· updating…</span>
      ) : (
        !asOf && (
          <span className="freshness__age">
            · {syncedAt ? formatAgo(syncedAt, now) : 'not checked'}
          </span>
        )
      )}
    </button>
  )
}

export default function AssetTab({ type, label, holdings, foldTo, rankOf, freshness }) {
  // Optional filter to a single broker platform (tap a legend chip). Resets per
  // tab since each tab mounts its own AssetTab.
  const [activeSource, setActiveSource] = useState(null)
  // When `foldTo` is set, only the top-ranked N rows (per `rankOf`, e.g. most
  // recently bought) show up front; "See all" reveals the rest in a scrollable
  // table.
  const [expanded, setExpanded] = useState(false)

  // "ETFs" is an initialism — lower-casing the tab label reads as "etfs".
  const plural = type === 'etf' ? 'ETFs' : label.toLowerCase()
  const singular = type === 'etf' ? 'ETF' : plural.replace(/s$/, '')

  const allRows = holdings.filter((h) => h.type === type)
  if (allRows.length === 0) {
    return <EmptyState title={`No ${plural} found`}>Refresh to pull the matching sheet.</EmptyState>
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

  // One column vocabulary for every asset class; the tab picks which of them
  // apply. Order is fixed here so Stocks, ETFs and Mutual Funds always scan the
  // same way.
  const COLS = {
    name: { key: 'name', label: isMF ? 'Fund' : 'Name', render: renderName },
    oneDay: {
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
    pnlPct: {
      key: 'pnlPct',
      label: 'Total P&L %',
      align: 'right',
      render: (r) => <span className={pnlClass(r.pnlPct)}>{formatPct(r.pnlPct)}</span>,
    },
    pnl: {
      key: 'pnl',
      label: 'P&L',
      align: 'right',
      render: (r) => <span className={pnlClass(r.pnl)}>{formatINR(r.pnl)}</span>,
    },
    qty: {
      key: 'qty',
      label: isMF ? 'Units' : 'Qty',
      align: 'right',
      render: (r) => formatNumber(r.qty),
    },
    avgPrice: {
      key: 'avgPrice',
      label: 'Avg price',
      align: 'right',
      render: (r) => formatINR(r.avgPrice, { paise: true }),
    },
    marketPrice: {
      key: 'marketPrice',
      label: 'Market price',
      align: 'right',
      render: (r) => (r.marketPrice != null ? formatINR(r.marketPrice, { paise: true }) : '—'),
    },
    invested: { key: 'invested', label: 'Invested', align: 'right', render: (r) => formatINR(r.invested) },
    current: { key: 'current', label: 'Current', align: 'right', render: (r) => formatINR(r.current) },
  }

  const order = isMF
    ? ['name', 'oneDay', 'pnlPct', 'pnl', 'qty', 'invested', 'current']
    : ['name', 'oneDay', 'pnlPct', 'pnl', 'qty', 'avgPrice', 'marketPrice', 'invested', 'current']
  const columns = order.map((k) => COLS[k])

  // Totals mirror `order` cell for cell — per-share columns have no meaningful
  // total, so they stay blank rather than summing into a nonsense number.
  const TOTALS = {
    name: (
      <td key="name">
        {rows.length} {rows.length === 1 ? singular : plural}
      </td>
    ),
    oneDay: (
      <td key="oneDay" className={`ta-r ${pnlClass(totalOneDayChange)}`}>
        {totalOneDayChange !== 0 ? (
          <>
            {formatINR(totalOneDayChange)} <small>({formatPct(totalOneDayChangePct)})</small>
          </>
        ) : (
          '—'
        )}
      </td>
    ),
    pnlPct: (
      <td key="pnlPct" className={`ta-r ${pnlClass(pnlPct)}`}>
        {formatPct(pnlPct)}
      </td>
    ),
    pnl: (
      <td key="pnl" className={`ta-r ${pnlClass(pnl)}`}>
        {formatINR(pnl)}
      </td>
    ),
    qty: <td key="qty" className="ta-r" />,
    avgPrice: <td key="avgPrice" className="ta-r" />,
    marketPrice: <td key="marketPrice" className="ta-r" />,
    invested: (
      <td key="invested" className="ta-r">
        {formatINR(invested)}
      </td>
    ),
    current: (
      <td key="current" className="ta-r">
        {formatINR(current)}
      </td>
    ),
  }

  const footer = <tr className="table__total">{order.map((k) => TOTALS[k])}</tr>

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
        {freshness && <FreshnessStamp {...freshness} />}
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
            : `See all ${rows.length} ${plural}`}
        </button>
      )}
    </div>
  )
}
