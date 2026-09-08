// Mobile Consolidated view: one section at a time, switched via a horizontal
// scrollable bar along the bottom. Each section leads with a hero — a big current-value figure + a
// signed P&L delta — and the whole view re-tints to that asset class's own
// identity colour (`--sec`), so navigation embodies the data model.
import { useEffect, useRef, useState } from 'react'
import PortfolioCard from './PortfolioCard.jsx'
import GoalTracker from './GoalTracker.jsx'
import AllocationDonut from './AllocationDonut.jsx'
import SourceLegend from './SourceLegend.jsx'
import { sourceRowClassName, sourceRowStyle } from '../lib/sourceStyle.js'
import { ASSET_TYPES, ASSET_COLORS, platformOf } from '../config.js'
import { formatINR, formatINRCompact, formatPct } from '../lib/format.js'

// Section hero: invested (what you put in) is the headline figure; current value
// and the gain/loss delta sit below as the running result.
function SectionHero({ label, stats }) {
  const { invested, current, pnl, pnlPct, anyCurrent, count } = stats
  const pos = pnl != null && pnl >= 0
  return (
    <div className="shero">
      <p className="shero__eyebrow">
        <span className="shero__dot" />
        {label}
        {count != null && <span className="shero__count">{count} holdings</span>}
      </p>
      <p className="shero__value">{formatINRCompact(invested)}</p>
      <p className="shero__value-label">Invested</p>
      <div className="shero__foot">
        <span className="shero__foot-item">
          <span className="shero__foot-label">Current</span>
          <span className="shero__foot-amt">{anyCurrent ? formatINRCompact(current) : '—'}</span>
        </span>
        {pnl != null && (
          <span className={`shero__delta ${pos ? 'pos' : 'neg'}`}>
            <span aria-hidden="true">{pos ? '▲' : '▼'}</span> {formatINRCompact(Math.abs(pnl))}
            <span className="shero__delta-pct">{formatPct(pnlPct)}</span>
          </span>
        )}
      </div>
    </div>
  )
}

function TopHoldingsBars({ top, maxTop }) {
  return (
    <div className="card">
      <div className="card__title-row">
        <h3 className="card__title">Top holdings</h3>
        <SourceLegend sources={top.map((h) => h.source)} />
      </div>
      <div className="bars">
        {top.map((h) => (
          <div
            className={`bar-row ${sourceRowClassName(h) || ''}`}
            style={sourceRowStyle(h)}
            key={h.isin || h.name}
          >
            <div className="bar-row__head">
              <span className="cell-name">
                {h.name}
                {(() => {
                  const platform = platformOf(h.source)
                  const initial = platform ? platform.label[0].toUpperCase() : null
                  return initial && (
                    <span className="cell-source-initial" style={{ color: platform.color, marginLeft: '6px', marginRight: '6px', fontWeight: 'bold' }}>
                      ({initial})
                    </span>
                  )
                })()}
                <span className="tag" style={{ '--tag': ASSET_COLORS[h.type] }}>
                  {ASSET_TYPES[h.type].label}
                </span>
              </span>
              <span className="mono">{formatINR(h.invested)}</span>
            </div>
            <div className="bar">
              <div
                className="bar__fill"
                style={{ width: `${((h.invested || 0) / maxTop) * 100}%`, background: ASSET_COLORS[h.type] }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Swipe to reveal sections; only a deliberate tap/keyboard action changes view.
function SectionRail({ sections, active, onChange }) {
  const railRef = useRef(null)
  const itemRefs = useRef({})
  useEffect(() => {
    const rail = railRef.current
    const item = itemRefs.current[active]
    if (!rail || !item) return
    rail.scrollTo({
      left: item.offsetLeft - (rail.clientWidth - item.offsetWidth) / 2,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    })
  }, [active])

  const onKeyDown = (event) => {
    const index = sections.findIndex((section) => section.key === active)
    const target = { ArrowRight: (index + 1) % sections.length, ArrowLeft: (index - 1 + sections.length) % sections.length, Home: 0, End: sections.length - 1 }[event.key]
    if (target == null) return
    event.preventDefault()
    const key = sections[target].key
    onChange(key)
    itemRefs.current[key]?.focus({ preventScroll: true })
  }

  return (
    <nav className="cmob__dock" aria-label="Portfolio views">
      <div className="cmob__rail" ref={railRef}>
      <ul className="cmob__chips" role="tablist" aria-label="Portfolio views" aria-orientation="horizontal" onKeyDown={onKeyDown}>
        {sections.map((s) => (
          <li key={s.key}>
            <button
              ref={(el) => (itemRefs.current[s.key] = el)}
              className={`cmob__chip ${active === s.key ? 'active' : ''}`}
              style={{ '--chip-c': s.color }}
              role="tab"
              id={`home-tab-${s.key}`}
              aria-controls={`home-panel-${s.key}`}
              aria-selected={active === s.key}
              tabIndex={active === s.key ? 0 : -1}
              onClick={() => onChange(s.key)}
            >
              <span className="cmob__chip-dot" />
              <span className="cmob__chip-label">{s.short}</span>
            </button>
          </li>
        ))}
      </ul>
      </div>
    </nav>
  )
}

export default function ConsolidatedMobile({
  strategy,
  cards,
  allocation,
  mfClass,
  equityAlloc,
  top,
  holdings = [],
  transactions = [],
  mfTransactions = [],
  navMap = null,
  priceHistory = null,
  onOpenMonth = null,
}) {
  const [active, setActive] = useState(strategy ? 'invest' : 'goal')
  const maxTop = Math.max(...top.map((h) => h.invested || 0), 1)

  const sections = [
    ...(strategy ? [{ key: 'invest', short: 'Invest', color: '#2cc0d6', render: () => strategy }] : []),
    {
      key: 'goal',
      short: 'Goal',
      color: '#ffbf63',
      render: () => (
        <GoalTracker
          holdings={holdings}
          transactions={transactions}
          mfTransactions={mfTransactions}
          navMap={navMap}
          priceHistory={priceHistory}
          onOpenMonth={onOpenMonth}
        />
      ),
    },
    {
      key: 'total',
      short: 'Total',
      color: '#9db4ff',
      render: () => (
        <>
          <SectionHero label="Total Portfolio" stats={cards.total} />
          <div className="card-grid">
            <PortfolioCard title="Mutual Funds" color={ASSET_COLORS.mf} stats={cards.mf} />
            <PortfolioCard title="Stocks & ETFs" color={ASSET_COLORS.stock} stats={cards.stocksEtfs} />
          </div>
          <AllocationDonut segments={allocation} title="Allocation by class" />
        </>
      ),
    },
    {
      key: 'mf',
      short: 'Funds',
      color: ASSET_COLORS.mf,
      render: () => (
        <>
          <SectionHero label="Mutual Funds" stats={cards.mf} />
          {mfClass.length > 0 && (
            <AllocationDonut
              segments={mfClass}
              centerValue={formatINRCompact(cards.mf.invested)}
              centerLabel="invested"
            />
          )}
        </>
      ),
    },
    {
      key: 'equity',
      short: 'Stocks',
      color: ASSET_COLORS.stock,
      render: () => (
        <>
          <SectionHero label="Stocks & ETFs" stats={cards.stocksEtfs} />
          {equityAlloc.length > 0 && (
            <AllocationDonut
              segments={equityAlloc}
              centerValue={formatINRCompact(cards.stocksEtfs.invested)}
              centerLabel="invested"
            />
          )}
        </>
      ),
    },
    {
      key: 'top',
      short: 'Top',
      color: '#ffbf63',
      render: () => <TopHoldingsBars top={top} maxTop={maxTop} />,
    },
  ]

  const current = sections.find((s) => s.key === active) || sections[0]

  return (
    <div className="cmob" style={{ '--sec': current.color }}>
      {strategy && <div className="cmob__main" id="home-panel-invest" role="tabpanel" aria-labelledby="home-tab-invest" hidden={active !== 'invest'}>
        {strategy}
      </div>}
      {active !== 'invest' && <div className="cmob__main" key={active} id={`home-panel-${active}`} role="tabpanel" aria-labelledby={`home-tab-${active}`}>
        {current.render()}
      </div>}
      <SectionRail sections={sections} active={active} onChange={setActive} />
    </div>
  )
}
