// Mobile Consolidated view: one section at a time, switched via a horizontal
// scroll-snapping bar along the bottom (tap a chip or swipe to snap it to
// center). Each section leads with a hero — a big current-value figure + a
// signed P&L delta — and the whole view re-tints to that asset class's own
// identity colour (`--sec`), so navigation embodies the data model.
import { useCallback, useEffect, useRef, useState } from 'react'
import PortfolioCard from './PortfolioCard.jsx'
import AllocationDonut from './AllocationDonut.jsx'
import { ASSET_TYPES, ASSET_COLORS } from '../config.js'
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

function SectionHeader({ label }) {
  return (
    <p className="shero__eyebrow shero__eyebrow--solo">
      <span className="shero__dot" />
      {label}
    </p>
  )
}

function TopHoldingsBars({ top, maxTop }) {
  return (
    <div className="card">
      <div className="bars">
        {top.map((h) => (
          <div className="bar-row" key={h.isin || h.name}>
            <div className="bar-row__head">
              <span className="cell-name">
                {h.name}
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

// Bottom switcher: a horizontal, scroll-snapping row of section chips. Active
// chip is driven by either a tap or by whichever chip is snapped nearest center.
function SectionRail({ sections, active, onChange }) {
  const railRef = useRef(null)
  const itemRefs = useRef({})
  const lockUntil = useRef(0) // ignore scroll-detection right after a tap-scroll
  const didInit = useRef(false)

  // Center the initially-active chip once (the rail starts scrolled to the start).
  useEffect(() => {
    if (didInit.current) return
    didInit.current = true
    itemRefs.current[active]?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [active])

  const scrollToChip = useCallback((key) => {
    const el = itemRefs.current[key]
    if (el) {
      lockUntil.current = Date.now() + 450 // let the smooth scroll settle
      el.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
    }
  }, [])

  const handleTap = (key) => {
    onChange(key)
    scrollToChip(key)
  }

  // On scroll, pick the chip whose center is nearest the rail's horizontal center.
  useEffect(() => {
    const rail = railRef.current
    if (!rail) return
    let raf = 0
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        if (Date.now() < lockUntil.current) return
        const railMid = rail.getBoundingClientRect().left + rail.clientWidth / 2
        let best = null
        let bestDist = Infinity
        for (const s of sections) {
          const el = itemRefs.current[s.key]
          if (!el) continue
          const r = el.getBoundingClientRect()
          const dist = Math.abs(r.left + r.width / 2 - railMid)
          if (dist < bestDist) {
            bestDist = dist
            best = s.key
          }
        }
        if (best && best !== active) onChange(best)
      })
    }
    rail.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      rail.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [sections, active, onChange])

  return (
    <div className="cmob__rail" ref={railRef}>
      <div className="cmob__rail-pad" aria-hidden="true" />
      <ul className="cmob__chips" role="tablist" aria-orientation="horizontal">
        {sections.map((s) => (
          <li key={s.key}>
            <button
              ref={(el) => (itemRefs.current[s.key] = el)}
              className={`cmob__chip ${active === s.key ? 'active' : ''}`}
              style={{ '--chip-c': s.color }}
              role="tab"
              aria-selected={active === s.key}
              onClick={() => handleTap(s.key)}
            >
              <span className="cmob__chip-dot" />
              <span className="cmob__chip-label">{s.short}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="cmob__rail-pad" aria-hidden="true" />
    </div>
  )
}

export default function ConsolidatedMobile({ cards, allocation, mfClass, equityAlloc, top }) {
  const [active, setActive] = useState('total')
  const maxTop = Math.max(...top.map((h) => h.invested || 0), 1)

  const sections = [
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
        </>
      ),
    },
    {
      key: 'mf',
      short: 'MF',
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
      key: 'mix',
      short: 'Mix',
      color: ASSET_COLORS.etf,
      render: () => (
        <>
          <SectionHeader label="Allocation by class" />
          <AllocationDonut segments={allocation} />
        </>
      ),
    },
    {
      key: 'top',
      short: 'Top',
      color: '#ffbf63',
      render: () => (
        <>
          <SectionHeader label="Top holdings" />
          <TopHoldingsBars top={top} maxTop={maxTop} />
        </>
      ),
    },
  ]

  const current = sections.find((s) => s.key === active) || sections[0]

  return (
    <div className="cmob" style={{ '--sec': current.color }}>
      <div className="cmob__main" key={active}>
        {current.render()}
      </div>
      <SectionRail sections={sections} active={active} onChange={setActive} />
    </div>
  )
}
