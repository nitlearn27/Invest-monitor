// Monthly investment view: per-month total + MF vs Stocks&ETF breakup (latest
// first) on the left — only the 3 most recent months show up front, the rest
// fold behind a "See more" toggle that makes the list scrollable. On the right a
// per-month MF cap donut with the selected month's transaction details stacked
// beneath it. Clicking a month updates the right column — no page scroll needed.
import { useState, useMemo } from 'react'
import AllocationDonut from './AllocationDonut.jsx'
import { EmptyState } from './StateViews.jsx'
import { monthlyInvestments, mfCapBreakdown, equityBreakdown, withRecurringSips } from '../lib/monthly.js'
import { ASSET_COLORS } from '../config.js'
import { formatINR, formatINRCompact, formatNumber } from '../lib/format.js'
import SourceLegend from './SourceLegend.jsx'
import { platformKeyOf } from '../config.js'

const sum = (arr, f) => arr.reduce((a, x) => a + (f(x) || 0), 0)
const byDateDesc = (a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0)

const SERIES = [
  { key: 'mf', label: 'Mutual Funds', color: ASSET_COLORS.mf },
  { key: 'equity', label: 'Stocks & ETFs', color: ASSET_COLORS.stock },
]

const monthKeyOf = (d) =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : null

export default function MonthlyTab({ transactions = [], mfTransactions = [] }) {
  const [activeSource, setActiveSource] = useState(null)

  // Fold in the hardcoded recurring SIP(s) not present in the statement.
  const allMfTxns = useMemo(() => withRecurringSips(mfTransactions), [mfTransactions])

  // Gather distinct sources from all transactions for the legend filter.
  const allSources = useMemo(() => {
    const set = new Set()
    for (const t of transactions) {
      if (t.source) set.add(t.source)
    }
    for (const t of allMfTxns) {
      if (t.source) set.add(t.source)
    }
    return [...set]
  }, [transactions, allMfTxns])

  // Filter transaction lists by selected source platform key
  const mfTxns = useMemo(() => {
    if (!activeSource) return allMfTxns
    return allMfTxns.filter((t) => platformKeyOf(t.source) === activeSource)
  }, [allMfTxns, activeSource])

  const filteredTransactions = useMemo(() => {
    if (!activeSource) return transactions
    return transactions.filter((t) => platformKeyOf(t.source) === activeSource)
  }, [transactions, activeSource])

  const months = useMemo(() => {
    return monthlyInvestments(filteredTransactions, mfTxns).map((m) => ({
      ...m,
      equity: m.stock + m.etf,
    }))
  }, [filteredTransactions, mfTxns])

  const displayMonths = useMemo(() => [...months].reverse(), [months]) // latest first
  const cap = useMemo(() => mfCapBreakdown(mfTxns), [mfTxns])

  // Show the 3 most recent months up front; the rest fold behind "See more"
  // (and the list becomes scrollable). Keeps the mobile view short.
  const [showAllMonths, setShowAllMonths] = useState(false)
  const visibleMonths = showAllMonths ? displayMonths : displayMonths.slice(0, 3)
  const hiddenCount = displayMonths.length - visibleMonths.length

  const equity = useMemo(() => equityBreakdown(filteredTransactions), [filteredTransactions])

  // Month picker for the donuts + detail; default to the latest month.
  const capOptions = useMemo(() => [...cap.months].reverse().concat(cap.all), [cap])
  const [selectedMonth, setSelectedMonth] = useState(null)

  const activeMonth = useMemo(() => {
    const defaultMonth = displayMonths[0]?.month || 'all'
    if (selectedMonth === null) return defaultMonth
    if (selectedMonth === 'all') return 'all'
    const exists = capOptions.some((o) => o.month === selectedMonth)
    return exists ? selectedMonth : defaultMonth
  }, [selectedMonth, capOptions, displayMonths])

  const selectedCap = capOptions.find((o) => o.month === activeMonth)
  const selectedEq = [...equity.months, equity.all].find((o) => o.month === activeMonth)
  const selLabel =
    activeMonth === 'all' ? 'All months' : months.find((m) => m.month === activeMonth)?.label || activeMonth

  const monthSelect = (
    <select className="search select" value={activeMonth} onChange={(e) => setSelectedMonth(e.target.value)}>
      {capOptions.map((o) => (
        <option key={o.month} value={o.month}>
          {o.label}
        </option>
      ))}
    </select>
  )

  // Top strip tracks the current calendar year (Jan–Dec).
  const year = new Date().getFullYear()
  const ytdMonths = months.filter((m) => m.month.startsWith(`${year}-`))
  const ytdTotal = sum(ytdMonths, (m) => m.total)
  const ytdMf = sum(ytdMonths, (m) => m.mf)
  const ytdEquity = sum(ytdMonths, (m) => m.equity)

  // Transactions in the selected month for the detail list.
  const detailMf = useMemo(() => {
    return mfTxns.filter((t) => activeMonth === 'all' || monthKeyOf(t.date) === activeMonth).sort(byDateDesc)
  }, [mfTxns, activeMonth])
  const detailEq = useMemo(() => {
    return filteredTransactions.filter((t) => activeMonth === 'all' || monthKeyOf(t.date) === activeMonth).sort(byDateDesc)
  }, [filteredTransactions, activeMonth])
  const fmtDate = (d) =>
    d
      ? d.toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          ...(activeMonth === 'all' ? { year: '2-digit' } : {}),
        })
      : '—'

  return (
    <div className="tab">
      <div className="strip">
        <div className="strip__item">
          <span className="strip__label">Invested in {year}</span>
          <span className="strip__value">{formatINR(ytdTotal)}</span>
        </div>
        <div className="strip__item">
          <span className="strip__label">Mutual Funds · {year}</span>
          <span className="strip__value">{formatINR(ytdMf)}</span>
        </div>
        <div className="strip__item">
          <span className="strip__label">Stocks &amp; ETFs · {year}</span>
          <span className="strip__value">{formatINR(ytdEquity)}</span>
        </div>
        <div className="strip__item">
          <span className="strip__label">Months in {year}</span>
          <span className="strip__value">{ytdMonths.length}</span>
        </div>
      </div>

      <div className="src-legend-row">
        <SourceLegend
          sources={allSources}
          active={activeSource}
          onSelect={setActiveSource}
        />
      </div>

      <div className="two-col two-col--monthly">
        {/* LEFT: month list */}
        <div className="card">
          <div className="reconcile__head">
            <h3 className="card__title" style={{ marginBottom: 0 }}>
              Monthly investments
            </h3>
            <div className="pills">
              {SERIES.map((s) => (
                <span className="pill" key={s.key}>
                  <span className="legend__dot" style={{ background: s.color }} /> {s.label}
                </span>
              ))}
            </div>
          </div>
          {displayMonths.length === 0 ? (
            <EmptyState title="No dated transactions to chart" />
          ) : (
            <div className="month-list">
              {visibleMonths.map((m) => (
                <button
                  key={m.month}
                  className={`month-row ${selectedMonth === m.month ? 'active' : ''}`}
                  onClick={() => setSelectedMonth(m.month)}
                  type="button"
                >
                  <div className="month-row__top">
                    <span className="month-row__name">{m.label}</span>
                    <span className="month-row__total">{formatINR(m.total)}</span>
                  </div>
                  <div
                    className="splitbar"
                    role="img"
                    aria-label={`MF ${formatINR(m.mf)}, Stocks & ETFs ${formatINR(m.equity)}`}
                  >
                    {SERIES.map((s) => {
                      const v = m[s.key]
                      if (v <= 0) return null
                      const pct = Math.round((v / m.total) * 100)
                      return (
                        <div
                          key={s.key}
                          className="splitbar__seg"
                          style={{ flexGrow: v, background: s.color }}
                          title={`${s.label}: ${formatINR(v)} · ${pct}%`}
                        >
                          <span className="splitbar__amt">{formatINRCompact(v)}</span>
                          <span className="splitbar__pct">{pct}%</span>
                        </div>
                      )
                    })}
                  </div>
                </button>
              ))}
            </div>
          )}

          {displayMonths.length > 3 && (
            <button type="button" className="month-more" onClick={() => setShowAllMonths((v) => !v)}>
              {showAllMonths ? 'Show less' : `See ${hiddenCount} more month${hiddenCount > 1 ? 's' : ''}`}
            </button>
          )}
        </div>

        {/* RIGHT: allocation donuts */}
        <div className="card">
          <div className="donut-head">
            <h3 className="card__title" style={{ marginBottom: 0 }}>
              Allocation · {selLabel}
            </h3>
            {monthSelect}
          </div>
          <div className="donut-pair">
            <div className="donut-pair__item">
              <h4 className="donut-sub">MF by market cap</h4>
              {selectedCap && selectedCap.segments.length > 0 ? (
                <AllocationDonut
                  bare
                  size={148}
                  segments={selectedCap.segments}
                  centerValue={formatINRCompact(selectedCap.total)}
                  centerLabel="MF"
                />
              ) : (
                <p className="muted donut-empty">No MF purchases this month</p>
              )}
            </div>
            <div className="donut-pair__item">
              <h4 className="donut-sub">Stocks &amp; ETFs</h4>
              {selectedEq && selectedEq.segments.length > 0 ? (
                <AllocationDonut
                  bare
                  size={148}
                  segments={selectedEq.segments}
                  centerValue={formatINRCompact(selectedEq.total)}
                  centerLabel="invested"
                />
              ) : (
                <p className="muted donut-empty">No stock/ETF purchases this month</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Full-width transactions for the selected month */}
      <div className="card">
        <h3 className="card__title">Transactions · {selLabel}</h3>
        <div className="txn-area">
          {detailMf.length === 0 && detailEq.length === 0 ? (
            <EmptyState title="No transactions in this month" />
          ) : (
            <div className="txn-cols">
              {detailMf.length > 0 && (
                <section className="txn-group" style={{ '--g': ASSET_COLORS.mf }}>
                  <div className="txn-group__head">
                    <span className="txn-group__title">Mutual Funds</span>
                    <span className="txn-group__count">{detailMf.length}</span>
                  </div>
                  <div className="dtable-wrap">
                    <table className="dtable">
                      <thead>
                        <tr>
                          <th>Fund</th>
                          <th>Date</th>
                          <th className="ta-r">NAV</th>
                          <th className="ta-r">Units</th>
                          <th className="ta-r">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailMf.map((t, i) => (
                          <tr key={`mf-${i}`} className={t.side === 'SELL' ? 'neg' : ''}>
                            <td className="nm">
                              {t.name}
                              {t.sip && <span className="sip-note"> · SIP</span>}
                              {t.side === 'SELL' && <span className="sip-note" style={{ color: 'var(--neg)' }}> · SELL</span>}
                            </td>
                            <td className="dt">{fmtDate(t.date)}</td>
                            <td className="ta-r">{formatNumber(t.nav)}</td>
                            <td className="ta-r">
                              {t.side === 'SELL' ? '-' : ''}{formatNumber(t.units)}
                            </td>
                            <td className="ta-r">
                              {t.side === 'SELL' ? '-' : ''}{formatINR(t.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {detailEq.length > 0 && (
                <section className="txn-group" style={{ '--g': ASSET_COLORS.stock }}>
                  <div className="txn-group__head">
                    <span className="txn-group__title">Stocks &amp; ETFs</span>
                    <span className="txn-group__count">{detailEq.length}</span>
                  </div>
                  <div className="dtable-wrap">
                    <table className="dtable">
                      <thead>
                        <tr>
                          <th>Scrip</th>
                          <th>Date</th>
                          <th className="ta-r">Price</th>
                          <th className="ta-r">Qty</th>
                          <th className="ta-r">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailEq.map((t, i) => {
                          const isSell = t.side === 'SELL'
                          const val = (t.qty || 0) * (t.price || 0)
                          return (
                            <tr key={`eq-${i}`} className={isSell ? 'neg' : ''}>
                              <td className="nm">
                                {t.name}
                                {isSell && <span className="sip-note" style={{ color: 'var(--neg)' }}> · SELL</span>}
                              </td>
                              <td className="dt">{fmtDate(t.date)}</td>
                              <td className="ta-r">{formatNumber(t.price)}</td>
                              <td className="ta-r">
                                {isSell ? '-' : ''}{formatNumber(t.qty)}
                              </td>
                              <td className="ta-r">
                                {isSell ? '-' : ''}{formatINR(t.value != null ? t.value : val)}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
