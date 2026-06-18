// Consolidated overview across stocks, ETFs and mutual funds.
import PortfolioCard from './PortfolioCard.jsx'
import AllocationDonut from './AllocationDonut.jsx'
import ConsolidatedMobile from './ConsolidatedMobile.jsx'
import {
  cardSummaries,
  allocationByClass,
  mfClassAllocation,
  equityHoldingsAllocation,
  topHoldings,
} from '../lib/portfolio.js'
import { ASSET_TYPES, ASSET_COLORS } from '../config.js'
import { formatINR, formatINRCompact, formatPct } from '../lib/format.js'
import { useIsMobile } from '../lib/useIsMobile.js'

// Compact invested + current header shown on the MF / Stocks donut sections.
function DonutKpi({ stats }) {
  const { invested, current, pnl, pnlPct, anyCurrent } = stats
  const pos = pnl != null && pnl >= 0
  return (
    <div className="donut-kpi">
      <span className="donut-kpi__item">
        <span className="donut-kpi__label">Invested</span>
        <span className="donut-kpi__val">{formatINR(invested)}</span>
      </span>
      <span className="donut-kpi__item">
        <span className="donut-kpi__label">Current</span>
        <span className="donut-kpi__val">
          {anyCurrent ? formatINR(current) : '—'}
          {pnl != null && (
            <span className={`donut-kpi__pnl ${pos ? 'pos' : 'neg'}`}>
              {pos ? '▲' : '▼'} {formatPct(pnlPct)}
            </span>
          )}
        </span>
      </span>
    </div>
  )
}

export default function ConsolidatedTab({ holdings }) {
  const isMobile = useIsMobile()
  const cards = cardSummaries(holdings)
  const allocation = allocationByClass(holdings)
  const mfClass = mfClassAllocation(holdings)
  const equityAlloc = equityHoldingsAllocation(holdings)
  const top = topHoldings(holdings, 8)
  const maxTop = Math.max(...top.map((h) => h.invested || 0), 1)

  if (isMobile) {
    return (
      <ConsolidatedMobile
        cards={cards}
        allocation={allocation}
        mfClass={mfClass}
        equityAlloc={equityAlloc}
        top={top}
      />
    )
  }

  return (
    <div className="tab">
      <PortfolioCard title="Total Portfolio" color="#9db4ff" stats={cards.total} featured />

      <div className="card-grid">
        <PortfolioCard title="Mutual Funds" color={ASSET_COLORS.mf} stats={cards.mf} />
        <PortfolioCard title="Stocks & ETFs" color={ASSET_COLORS.stock} stats={cards.stocksEtfs} />
      </div>

      <div className="two-col two-col--top">
        {mfClass.length > 0 && (
          <AllocationDonut
            segments={mfClass}
            title="Mutual Funds"
            action={<DonutKpi stats={cards.mf} />}
            centerValue={formatINRCompact(cards.mf.invested)}
            centerLabel="MF"
            legendMax={186}
          />
        )}
        {equityAlloc.length > 0 && (
          <AllocationDonut
            segments={equityAlloc}
            title="Stocks & ETFs"
            action={<DonutKpi stats={cards.stocksEtfs} />}
            centerValue={formatINRCompact(cards.stocksEtfs.invested)}
            centerLabel="invested"
            legendMax={186}
          />
        )}
      </div>

      <div className="two-col two-col--top">
        <AllocationDonut segments={allocation} title="Allocation by asset class" />

        <div className="card">
          <h3 className="card__title">By asset class</h3>
          <div className="bars">
            {allocation.map((a) => (
              <div className="bar-row" key={a.key}>
                <div className="bar-row__head">
                  <span>
                    <span className="legend__dot" style={{ background: a.color }} /> {a.label}
                    <span className="muted"> · {a.count}</span>
                  </span>
                  <span className="mono">{formatINR(a.value)}</span>
                </div>
                <div className="bar">
                  <div className="bar__fill" style={{ width: `${a.pct}%`, background: a.color }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="card__title">Top holdings</h3>
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
    </div>
  )
}
