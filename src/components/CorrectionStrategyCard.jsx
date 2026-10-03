import { useState } from 'react'
import { DEFAULT_CORRECTION_STRATEGY, indiaDate } from '../lib/correctionStrategy.js'
import { INVEST_WATCHLIST, monthlyNavRecord, monthlyPercentSeries, monthlyChartLayout, monthlyBudgetProgress, rankInvestFunds } from '../lib/investOverview.js'
import { formatINR, formatDayMonth, formatPct } from '../lib/format.js'
import './CorrectionStrategyCard.css'

const money = (value) => formatINR(value, { paise: value != null && !Number.isInteger(value) })

function NavTrend({ record }) {
  if (!record) return <div className="correction__chart-empty">Waiting for this month’s NAV</div>

  const series = monthlyPercentSeries(record)
  if (!series.length) return <div className="correction__chart-empty">Previous month’s closing NAV unavailable</div>
  const monthLabel = new Date(record.month + '-01T00:00:00Z').toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' })
  const plot = { left: 44, right: 328, top: 14, bottom: 174 }
  const { lastDay, baselineX, zeroY, ticks, x, y } = monthlyChartLayout(record.month, series.map((point) => point.changePct), plot)
  const points = [
    { changePct: 0, x: baselineX, y: zeroY },
    ...series.map((point) => ({ ...point, x: x(point.day), y: y(point.changePct) })),
  ]
  const segments = []
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1]
    const to = points[index]
    if ((from.changePct >= 0 && to.changePct >= 0) || (from.changePct <= 0 && to.changePct <= 0)) {
      segments.push({ from, to, positive: from.changePct >= 0 && to.changePct >= 0 })
    } else {
      const share = -from.changePct / (to.changePct - from.changePct)
      const crossing = { x: from.x + share * (to.x - from.x), y: zeroY }
      segments.push({ from, to: crossing, positive: from.changePct > 0 })
      segments.push({ from: crossing, to, positive: to.changePct > 0 })
    }
  }
  const dayTicks = [1, 8, 15, 22, lastDay]
  const last = points.at(-1)
  const tone = last.changePct >= 0 ? 'positive' : 'negative'
  const axisLabel = (value) => (value > 0 ? '+' : '') + Number(value.toFixed(2)) + '%'
  const tickLabel = (value) => (value > 0 ? '+' : '') + Number(value.toFixed(1)) + '%'

  return <figure className="correction__trend">
    <svg viewBox="0 0 340 220" role="img" aria-label={'NAV percentage change from the last NAV of the previous month on ' + formatDayMonth(record.previousCloseDate) + '. Latest ' + axisLabel(last.changePct) + '. Zero percent stays at the chart center; dates run through ' + monthLabel + '.'}>
      {ticks.map((tick) => <g key={tick}>
        <line x1={plot.left} x2={plot.right} y1={y(tick)} y2={y(tick)} className={tick === 0 ? 'correction__zero-line' : 'correction__grid-line'} />
        <text x="36" y={y(tick) + 3.5} textAnchor="end" className={tick === 0 ? 'correction__axis-zero' : 'correction__axis-label'}>{tickLabel(tick)}</text>
      </g>)}
      <line x1={plot.left} x2={plot.left} y1={plot.top} y2={plot.bottom} className="correction__axis-line" />
      <text x={baselineX} y="202" textAnchor="middle" className="correction__axis-label">Prev</text>
      {dayTicks.map((day) => <g key={day}>
        <line x1={x(day)} x2={x(day)} y1={plot.bottom} y2={plot.bottom + 4} className="correction__axis-line" />
        <text x={x(day)} y="202" textAnchor={day === lastDay ? 'end' : 'middle'} className="correction__axis-label">{day === 1 || day === lastDay ? day + ' ' + monthLabel : day}</text>
      </g>)}
      {segments.map((segment, index) => <g key={index} className={segment.positive ? 'correction__segment--positive' : 'correction__segment--negative'}>
        <path d={'M ' + segment.from.x + ' ' + zeroY + ' L ' + segment.from.x + ' ' + segment.from.y + ' L ' + segment.to.x + ' ' + segment.to.y + ' L ' + segment.to.x + ' ' + zeroY + ' Z'} className="correction__segment-fill" />
        <line x1={segment.from.x} y1={segment.from.y} x2={segment.to.x} y2={segment.to.y} className="correction__segment-line" vectorEffect="non-scaling-stroke" />
      </g>)}
      <circle cx={baselineX} cy={zeroY} r="3.5" className="correction__start-dot" />
      <circle cx={last.x} cy={last.y} r="8" className={'correction__end-halo correction__end-halo--' + tone} />
      <circle cx={last.x} cy={last.y} r="4.5" className={'correction__end-dot correction__end-dot--' + tone} />
    </svg>
    <figcaption><span>vs {formatDayMonth(record.previousCloseDate)} NAV</span><strong className={'correction__trend-value--' + tone}>{axisLabel(last.changePct)}</strong></figcaption>
  </figure>
}

export default function CorrectionStrategyCard({ navMap, transactions, mfTransactions, busy, onRefresh }) {
  const [manualSelection, setSelected] = useState(null)
  const today = indiaDate()
  const month = today.slice(0, 7)
  const records = INVEST_WATCHLIST.map((fund) => {
    const record = monthlyNavRecord(navMap?.get(fund.schemeCode)?.history, month, today)
    return record ? { ...record, schemeCode: fund.schemeCode } : null
  }).filter(Boolean)
  const funds = rankInvestFunds(INVEST_WATCHLIST, records)
  const defaultFund = funds[0]?.schemeCode
  const selected = manualSelection?.month === month && funds.some((fund) => fund.schemeCode === manualSelection.schemeCode)
    ? manualSelection.schemeCode : defaultFund
  const record = records.find((item) => item.schemeCode === selected)
  const changePct = monthlyPercentSeries(record).at(-1)?.changePct
  const changeNAV = record?.previousCloseNAV == null ? null : record.currentNAV - record.previousCloseNAV
  const stale = record?.navDate && (Date.parse(today) - Date.parse(record.navDate)) > 4 * 86400000

  // Use exactly the same portfolio-wide monthly total as the Monthly tab.
  const hasTransactions = Array.isArray(transactions) && Array.isArray(mfTransactions)
  const budget = DEFAULT_CORRECTION_STRATEGY.monthlyBudget
  const progress = hasTransactions ? monthlyBudgetProgress(transactions, mfTransactions, month, budget) : null
  const invested = progress?.invested ?? null
  const remaining = progress?.remaining ?? null
  const investedPct = progress?.investedPct ?? 0

  return (
    <section className="card correction" aria-labelledby="correction-title">
      <header className="correction__head">
        <div><span className="correction__eyebrow">{new Date(month + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })} · INVEST</span><h2 id="correction-title">Mutual funds</h2></div>
        <button className="correction__icon" type="button" aria-label="Refresh NAVs" title="Refresh NAVs" disabled={busy} onClick={onRefresh}>↻</button>
      </header>
      <div className="correction__fund"><label htmlFor="correction-fund">Mutual fund</label>
        <select id="correction-fund" title={funds.find((fund) => fund.schemeCode === selected)?.fundName} value={selected ?? ''} disabled={!selected} onChange={(event) => setSelected({ schemeCode: Number(event.target.value), month })}>
          {!selected && <option value="">NAV unavailable for portfolio funds</option>}
          {funds.map((fund) => <option key={fund.schemeCode} value={fund.schemeCode}>{fund.fundName} · {fund.monthlyChangePct == null ? 'Change unavailable' : formatPct(fund.monthlyChangePct)}</option>)}
        </select>
      </div>
      <div className={'correction__market' + (changePct < 0 ? '' : ' correction__market--steady')}>
        <div className="correction__market-top"><div><span className="correction__kicker">FROM LAST MONTH’S CLOSE</span><strong className="correction__hero-value">{formatPct(changePct)}</strong></div><span className="correction__dip-icon" aria-hidden="true">{changePct == null || changePct === 0 ? '→' : changePct < 0 ? '↘' : '↗'}</span></div>
        {changeNAV != null && <span className="correction__gap">{changeNAV === 0 ? 'At last month’s close' : money(Math.abs(changeNAV)) + (changeNAV < 0 ? ' below' : ' above') + ' last month’s close'}</span>}
        <div className="correction__nav-pair"><span>Last month’s close <b>{money(record?.previousCloseNAV)}</b></span><span>Latest NAV <b>{money(record?.currentNAV)}</b></span></div>
        <NavTrend record={record} />
        <p className="correction__freshness">{busy ? 'Updating NAV…' : record ? 'NAV as of ' + formatDayMonth(record.navDate) + (stale ? ' · refresh may be needed' : '') : 'Awaiting this month’s NAV'}</p>
      </div>
      <div className="correction__budget">
        <div className="correction__budget-head"><div><span className="correction__kicker">ALL INVESTMENTS · THIS MONTH</span><h3>Monthly budget</h3></div><strong>{money(budget)}</strong></div>
        <div className="correction__budget-body">
          <div className="correction__ring" role="img" aria-label={money(invested) + ' invested this month, ' + money(remaining) + ' left to invest'} style={{ '--allocated': investedPct + '%' }}><div><strong>{invested == null ? '—' : Math.round(investedPct) + '%'}</strong><span>invested</span></div></div>
          <div className="correction__budget-numbers"><div><span className="correction__legend-dot correction__legend-dot--allocated" /> <span>Invested this month</span><strong>{money(invested)}</strong></div><div><span className="correction__legend-dot correction__legend-dot--available" /> <span>Left to invest</span><strong>{money(remaining)}</strong></div></div>
        </div>
        <div className="correction__levels-head"><h4>Invest if down</h4><span>From last month’s close</span></div>
        <div className="correction__levels">{DEFAULT_CORRECTION_STRATEGY.levels.map((level, index) =>
          <div className={'correction__level correction__level--' + index} key={level.drawdown}>
            <div className="correction__level-mark"><span>{level.drawdown}%</span><i /></div>
            <div className="correction__level-copy"><strong>{money(budget * level.allocation / 100)}</strong><small>{level.allocation}% of budget</small></div>
          </div>
        )}</div>
        <p className="correction__disclaimer">Monthly total matches the Monthly tab.</p>
      </div>
    </section>
  )
}
