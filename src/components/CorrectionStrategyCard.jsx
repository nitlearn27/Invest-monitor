import { useRef, useState } from 'react'
import {
  DEFAULT_CORRECTION_STRATEGY, allocationPaise, indiaDate, recommendationMessage,
} from '../lib/correctionStrategy.js'
import { formatINR, formatDate, formatNumber, formatDayMonth } from '../lib/format.js'
import './CorrectionStrategyCard.css'

const money = (value) => formatINR(value, { paise: value != null && !Number.isInteger(value) })

function fundLabel(name) {
  const plan = name.match(/\b(Direct|Regular)\b/i)
  if (!plan) return name
  return `${name.slice(0, plan.index).replace(/[\s–-]+$/, '').replace(/\s+Fund$/i, '')} · ${plan[1]}`
}

function NavTrend({ history, record }) {
  const rows = (history || []).filter((row) => Number.isFinite(row.nav) && row.nav > 0
    && new Date(row.t).toISOString().slice(0, 7) === record.month
    && new Date(row.t).toISOString().slice(0, 10) <= indiaDate()).sort((a, b) => a.t - b.t)
  if (!rows.length) return <div className="correction__chart-empty">Awaiting this month’s NAV</div>
  const high = Math.max(...rows.map((row) => row.nav))
  const low = Math.min(...rows.map((row) => row.nav))
  const span = high - low || high * .01
  const point = (row) => [12 + (row.t - rows[0].t) / (rows.at(-1).t - rows[0].t || 1) * 296, 16 + (high - row.nav) / span * 58]
  const points = rows.map(point)
  const [endX, endY] = points.at(-1)
  const line = points.map((p) => p.join(',')).join(' ')
  return <figure className="correction__trend">
    <svg viewBox="0 0 320 94" role="img" aria-label={`Monthly NAV trend: ${money(rows[0].nav)} to ${money(rows.at(-1).nav)}. High ${money(high)}.`}>
      <path d={`M ${points[0][0]},88 L ${line.replaceAll(' ', ' L ')} L ${endX},88 Z`} fill="var(--accent-2)" opacity=".09" />
      <line x1="12" x2="308" y1="16" y2="16" stroke="var(--text-mute)" strokeDasharray="3 5" opacity=".4" />
      <polyline points={line} fill="none" stroke="var(--accent-2)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={endX} cy={endY} r="5" fill="var(--accent-2)" stroke="var(--bg)" strokeWidth="2" />
    </svg>
    <figcaption><span>{formatDayMonth(rows[0].t)}</span><span>Monthly NAV · {rows.length} observations</span><span>{formatDayMonth(rows.at(-1).t)}</span></figcaption>
  </figure>
}

function ActionIcon({ name }) {
  return <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'refresh' ? <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 6a8 8 0 0 1 13 2M18 18A8 8 0 0 1 5 16" /></> : name === 'settings' ? <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" fill="var(--bg)" /><circle cx="15" cy="17" r="3" fill="var(--bg)" /></> : <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></>}
  </svg>
}

function StrategySettings({ config, saveConfig, onClose }) {
  const [draft, setDraft] = useState(() => structuredClone(config))
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const field = (name, value) => setDraft((current) => ({ ...current, [name]: Number(value) }))
  const levelField = (index, name, value) => setDraft((current) => ({
    ...current, levels: current.levels.map((level, i) => i === index ? { ...level, [name]: Number(value) } : level),
  }))
  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { deferred } = await saveConfig(draft)
      setMessage(deferred ? 'Saved for next month. This month’s recommendations are preserved.' : 'Settings saved for this month.')
    } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }
  return (
    <form className="correction__settings" onSubmit={submit}>
      <p>Budget is per fund. Allocations must total 100%. Once recommendations exist, changes start next month.</p>
      <div className="correction__fields">
        <label>Monthly budget (₹)<input required type="number" min="0.01" step="0.01" value={draft.monthlyBudget} onChange={(event) => field('monthlyBudget', event.target.value)} /></label>
        <label>Initial allocation (%)<input required type="number" min="0" max="100" step="0.01" value={draft.initialAllocation} onChange={(event) => field('initialAllocation', event.target.value)} /></label>
        <label>Cutoff day<input required type="number" min="1" max="31" value={draft.cutoffDay} onChange={(event) => field('cutoffDay', event.target.value)} /></label>
      </div>
      {draft.levels.map((level, index) => (
        <div className="correction__fields" key={index}>
          <label>Level {index + 1} drawdown (%)<input required type="number" min="0.01" max="100" step="0.01" value={level.drawdown} onChange={(event) => levelField(index, 'drawdown', event.target.value)} /></label>
          <label>Level {index + 1} allocation (%)<input required type="number" min="0.01" max="100" step="0.01" value={level.allocation} onChange={(event) => levelField(index, 'allocation', event.target.value)} /></label>
          <button type="button" onClick={() => setDraft((current) => ({ ...current, levels: current.levels.filter((_, i) => i !== index) }))}>Remove level {index + 1}</button>
        </div>
      ))}
      <div className="correction__actions">
        <button type="button" onClick={() => setDraft((current) => ({ ...current, levels: [...current.levels, { drawdown: 10, allocation: 5 }] }))}>Add level</button>
        <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button>
        <button type="button" onClick={onClose}>Close</button>
      </div>
      {error && <p role="alert" className="neg">{error}</p>}
      {message && <p role="status" className="pos">{message}</p>}
    </form>
  )
}

export default function CorrectionStrategyCard({ monitor, busy, onRefresh }) {
  const { funds, snapshot, error, saveConfig, review, refresh, navMap } = monitor
  const [selection, setSelected] = useState(DEFAULT_CORRECTION_STRATEGY.schemeCode)
  const selected = funds.some((fund) => fund.schemeCode === selection) ? selection : DEFAULT_CORRECTION_STRATEGY.schemeCode
  const [settings, setSettings] = useState(false)
  const [info, setInfo] = useState(false)
  const alertsRef = useRef(null)
  const [actionError, setActionError] = useState(null)
  const [reviewBusy, setReviewBusy] = useState(null)
  const month = indiaDate().slice(0, 7)
  const record = snapshot?.months.find((item) => item.schemeCode === selected && item.month === month)
  const savedConfig = snapshot?.strategies.find((item) => item.schemeCode === selected)
  const records = (snapshot?.months || []).filter((item) => item.schemeCode === selected).sort((a, b) => b.month.localeCompare(a.month))
  const recommendations = (snapshot?.recommendations || []).filter((item) => item.schemeCode === selected)
    .sort((a, b) => a.navDate.localeCompare(b.navDate) || Number(b.kind === 'initial') - Number(a.kind === 'initial'))
  const currentRecommendations = recommendations.filter((item) => item.month === month)
  const earlierPending = recommendations.filter((item) => item.month !== month && item.status === 'pending').length
  const pending = currentRecommendations.filter((item) => item.status === 'pending')
  const pendingPaise = pending.reduce((sum, item) => sum + item.amountPaise, 0)
  const next = record?.config.levels.find((level) => !record.executedTriggers.includes(`drawdown:${level.drawdown}`))
  const stale = record?.navDate && (Date.parse(indiaDate()) - Date.parse(record.navDate)) > 4 * 86400000
  const completed = record?.status === 'complete'
  const labelFor = (key) => record?.executedTriggers.includes(key) ? '✓' : completed ? '–' : '○'
  const stages = record ? [
    { key: 'initial', label: 'Initial', allocation: record.config.initialAllocation },
    ...record.config.levels.map((level) => ({ key: `drawdown:${level.drawdown}`, label: `${level.drawdown}%`, allocation: level.allocation })),
  ] : []

  async function markReviewed(id) {
    setReviewBusy(id)
    setActionError(null)
    try { await review(id) }
    catch (failure) { setActionError(failure.message) }
    finally { setReviewBusy(null) }
  }

  return (
    <section className="card correction" aria-labelledby="correction-title">
      <div className="correction__head">
        <div><span className="correction__eyebrow">{new Date(`${month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</span><h2 id="correction-title">Invest on dips</h2></div>
        <div className="correction__actions">
          <button className="correction__icon" type="button" aria-label="Refresh NAVs" title="Refresh NAVs" disabled={busy} onClick={() => { refresh(); onRefresh() }}><ActionIcon name="refresh" /></button>
          <button className="correction__icon" type="button" aria-label="Configure strategy" title="Configure strategy" disabled={!savedConfig || Boolean(error)} aria-expanded={settings} aria-controls="correction-settings" onClick={() => setSettings(!settings)}><ActionIcon name="settings" /></button>
          <button className="correction__icon" type="button" aria-label="How this works" title="How this works" aria-expanded={info} aria-controls="correction-info" onClick={() => setInfo(!info)}><ActionIcon name="info" /></button>
        </div>
      </div>
      <div className="correction__fund"><label htmlFor="correction-fund">Mutual fund</label>
        <select id="correction-fund" title={funds.find((fund) => fund.schemeCode === selected)?.fundName} value={selected} onChange={(event) => { setSelected(Number(event.target.value)); setSettings(false); setActionError(null) }}>
          {funds.map((fund) => <option key={fund.schemeCode || fund.fundName} value={fund.schemeCode || fund.fundName} disabled={!fund.schemeCode}>{fundLabel(fund.fundName)}{!fund.schemeCode ? ' — NAV unavailable' : ''}</option>)}
        </select>
      </div>
      {info && <div className="correction__info" id="correction-info">
        <strong>Recommendations, not purchases</strong>
        <p>Drawdown is measured from this month’s highest NAV. Each level triggers once; the cutoff uses the next available NAV if needed.</p>
        <p>Each fund has its own budget. Reviewing an alert does not record an investment. Checks run while the app is open; history stays in this browser.</p>
      </div>}
      {settings && savedConfig && <div id="correction-settings"><StrategySettings key={selected} config={savedConfig} saveConfig={saveConfig} onClose={() => setSettings(false)} /></div>}
      {error ? <p role="alert" className="neg">Recommendations unavailable: {error} <button onClick={refresh}>Retry</button></p>
        : !record ? <p role="status">Loading monthly strategy…</p> : <>
          <div className="correction__decision" role="status">
            <div><span>{pendingPaise > 0 ? 'Recommended · to review' : 'Strategy status'}</span><strong>{pendingPaise > 0 ? money(pendingPaise / 100) : !record.navDate ? 'Awaiting NAV' : completed ? 'Month complete' : 'Hold for now'}</strong></div>
            {pending.length > 0 ? <button type="button" className="correction__review" aria-label={`Review ${pending.length} recommendations`} onClick={() => {
              if (!alertsRef.current) return
              alertsRef.current.open = true
              alertsRef.current.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
            }}>Review {pending.length} <span aria-hidden="true">↗</span></button> : <span className="correction__badge">{completed ? '✓ Fully allocated' : 'No new trigger'}</span>}
          </div>
          <div className="correction__market">
            <div className="correction__drawdown"><div><span>From monthly high</span><strong>{record.currentDrawdown == null ? '—' : `${record.currentDrawdown.toFixed(2)}%`}<small>drawdown</small></strong></div><div className="correction__nav-pair"><span>NAV <b>{money(record.currentNAV)}</b></span><span>High <b>{money(record.monthlyHighNAV)}</b></span></div></div>
            <NavTrend history={navMap?.get(selected)?.history} record={record} />
            {(busy || stale) && <span className={`correction__freshness ${stale ? 'neg' : ''}`}>{busy ? 'Updating NAV…' : `NAV ${formatDayMonth(record.navDate)} · stale`}</span>}
          </div>
          <div className="correction__budget">
            <div className="correction__section-label"><span>Monthly budget</span><strong>{money(record.budgetPaise / 100)}</strong></div>
            <div className="correction__allocation" role="progressbar" aria-label="Budget recommended" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number((record.allocatedPaise / record.budgetPaise * 100).toFixed(2))} aria-valuetext={`${money(record.allocatedPaise / 100)} recommended; ${money(record.remainingPaise / 100)} remaining`}><span style={{ width: `${record.allocatedPaise / record.budgetPaise * 100}%` }} /></div>
            <div className="correction__budget-legend"><span><i />{money(record.allocatedPaise / 100)} <small>allocated</small></span><span>{money(record.remainingPaise / 100)} <small>left</small></span></div>
          </div>
          <div className="correction__progress" aria-label="Trigger progress">
            {stages.map((stage) => <div key={stage.key} className={record.executedTriggers.includes(stage.key) ? 'is-done' : ''}>
              <span className="correction__step" aria-label={record.executedTriggers.includes(stage.key) ? 'Recommended' : completed ? 'Covered by cutoff' : 'Pending'}>{labelFor(stage.key)}</span>
              <strong>{stage.label}</strong><span>{money(allocationPaise(record, stage.allocation) / 100)}</span><small>{stage.allocation}% allocation</small>
            </div>)}
          </div>
          <div className="correction__meta"><div><span>Next trigger</span><strong>{completed ? 'Complete ✓' : !record.navDate ? 'First NAV' : next ? `${next.drawdown}% dip` : 'Cutoff'}</strong></div><div><span>{record.cutoffNAVDate ? 'Cutoff processed' : 'Cutoff'}</span><strong>{formatDayMonth(record.cutoffNAVDate || record.cutoffDate)}</strong>{record.cutoffStatus === 'waiting_for_nav' && <small>Awaiting NAV</small>}</div></div>
          {pending.length > 0 && <details ref={alertsRef} className="correction__history correction__pending" key={`alerts-${selected}`}><summary>Review recommendations <span>{pending.length}</span></summary><ul className="correction__alerts">{pending.map((item) => <li key={item.id}>
            <div><strong>{money(item.amountPaise / 100)}</strong><span>{item.kind === 'initial' ? 'Initial allocation' : item.kind === 'cutoff' ? 'Cutoff remainder' : `${item.breakdown.map((level) => `${level.drawdown}%`).join(' + ')} corrections`}</span><small>{formatDayMonth(item.navDate)} · NAV {formatNumber(item.nav)}</small></div>
            <button type="button" disabled={reviewBusy === item.id} onClick={() => markReviewed(item.id)}>Reviewed</button>
          </li>)}</ul></details>}
          {actionError && <p role="alert" className="neg">{actionError}</p>}
          <details className="correction__history"><summary>History <span>{earlierPending > 0 ? `${earlierPending} unreviewed` : `${records.length} ${records.length === 1 ? 'month' : 'months'}`}</span></summary>
            {records.map((item) => <div key={item.id} className="correction__month">
              <strong>{item.month} · {money(item.allocatedPaise / 100)} / {money(item.budgetPaise / 100)} recommended</strong>
              <p>Remaining {money(item.remainingPaise / 100)} · High NAV {money(item.monthlyHighNAV)} · Drawdown {item.currentDrawdown == null ? '—' : `${item.currentDrawdown.toFixed(2)}%`} · {item.status.replaceAll('_', ' ')}</p>
              <ul>{recommendations.filter((alert) => alert.monthId === item.id).map((alert) => <li key={alert.id}>{formatDate(alert.navDate)} — {recommendationMessage(alert, money)} <span className="muted">({alert.status})</span>{alert.month !== month && alert.status === 'pending' && <button type="button" disabled={reviewBusy === alert.id} onClick={() => markReviewed(alert.id)}>Mark reviewed</button>}</li>)}</ul>
            </div>)}
          </details>
        </>}
    </section>
  )
}
