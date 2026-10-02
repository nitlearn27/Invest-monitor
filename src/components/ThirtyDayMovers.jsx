import { useMemo, useState } from 'react'
import { averageMoverChange, filterMovers, rankedMovers } from '../lib/movers.js'
import { ASSET_COLORS, ASSET_TYPES } from '../config.js'
import { formatDate, formatINR, formatPct } from '../lib/format.js'

const ASSET_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'mf', label: 'MF', accessible: 'Mutual Funds' },
  { key: 'stock', label: 'Stocks' },
  { key: 'etf', label: 'ETFs' },
  { key: 'us_stock', label: 'US Stocks' },
]

function MoverSparkline({ trend }) {
  const first = trend[0]
  const last = trend.at(-1)
  const low = Math.min(...trend.map(({ price }) => price))
  const high = Math.max(...trend.map(({ price }) => price))
  const width = last.t - first.t || 1
  // Keep small moves visually small instead of stretching every series to full height.
  const height = Math.max(high - low, first.price * 0.1)
  const midpoint = (high + low) / 2
  const points = trend.map(({ t, price }) => ({
    x: ((t - first.t) / width) * 100,
    y: 22 - ((price - midpoint) / height) * 30,
  }))
  const line = points.map(({ x, y }, index) => `${index ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ')
  const end = points.at(-1)
  return (
    <svg className="movers__spark" viewBox="0 0 100 44" preserveAspectRatio="none" role="img" aria-label="30-day price or NAV path">
      <path d={`${line} L100 42 L0 42 Z`} fill="currentColor" opacity="0.13" />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={end.x} cy={end.y} r="2.4" fill="currentColor" />
    </svg>
  )
}

function MoversOverview({ drawdowns, gainers, unchangedCount }) {
  const moving = drawdowns.length + gainers.length
  const tracked = moving + unchangedCount
  return (
    <div className="movers__overview">
      <div className="movers__overview-head">
        <span>30-day split</span>
        <span>{tracked} priced {tracked === 1 ? 'holding' : 'holdings'}</span>
      </div>
      <div className="movers__overview-numbers">
        <span className="movers__overview-loss"><strong>{drawdowns.length}</strong> Losers</span>
        <span className="movers__overview-gain"><strong>{gainers.length}</strong> Gainers</span>
      </div>
      <div className="movers__overview-bar" role="img" aria-label={`${drawdowns.length} losers and ${gainers.length} gainers`}>
        {moving > 0 && <>
          <span className="movers__overview-loss-bar" style={{ width: `${drawdowns.length / moving * 100}%` }} />
          <span className="movers__overview-gain-bar" style={{ width: `${gainers.length / moving * 100}%` }} />
        </>}
      </div>
      {unchangedCount > 0 && <span className="movers__overview-flat">{unchangedCount} unchanged</span>}
    </div>
  )
}

function AssetFilter({ direction, value, onChange, mobile = false }) {
  return (
    <div className={`movers__filters ${mobile ? 'movers__filters--mobile' : ''}`} role="group" aria-label={`${direction === 'drawdowns' ? 'Losers' : 'Gainers'} asset type`}>
      {ASSET_FILTERS.map((option) => (
        <button
          key={option.key}
          type="button"
          className={value === option.key ? 'active' : ''}
          aria-label={option.accessible}
          aria-pressed={value === option.key}
          onClick={() => onChange(option.key)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function MoversAverage({ direction, rows, mobile = false }) {
  return (
    <div className={`movers__average ${mobile ? 'movers__average--mobile' : ''}`}>
      <div>
        <span>Average 30-day {direction === 'drawdowns' ? 'loss' : 'gain'}</span>
        <small>Equal weight · {rows.length} {rows.length === 1 ? 'holding' : 'holdings'}</small>
      </div>
      <strong>{formatPct(averageMoverChange(rows))}</strong>
    </div>
  )
}

function MoversTable({ title, direction, rows, filter, onFilter }) {
  return (
    <div className="card movers__panel" style={{ '--mover-tone': direction === 'drawdowns' ? 'var(--mover-loss)' : 'var(--mover-gain)' }}>
      <div className="movers__panel-head">
        <h4 className="movers__title">{title} <span className="movers__count">{rows.length}</span></h4>
        <AssetFilter direction={direction} value={filter} onChange={onFilter} />
      </div>
      <MoversAverage direction={direction} rows={rows} />
      {rows.length === 0 ? <p className="movers__empty">No matching holdings with enough recent price history.</p> : (
        <div className="movers__scroll">
          <table className="table movers__table">
            <thead>
              <tr>
                <th scope="col">Holding</th>
                <th scope="col">30d path</th>
                <th scope="col" className="ta-r">Then</th>
                <th scope="col" className="ta-r">Latest</th>
                <th scope="col" className="ta-r">30d move</th>
                <th scope="col" className="ta-r">Below high</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td>
                    <span className="movers__name">{row.name}</span>
                    <span className="movers__detail">
                      <span className="tag" style={{ '--tag': ASSET_COLORS[row.type] }}>{ASSET_TYPES[row.type].label}</span>
                      {row.symbol && <span>{row.symbol} · </span>}
                      {formatDate(row.fromDate)} → {formatDate(row.toDate)}
                    </span>
                  </td>
                  <td><MoverSparkline trend={row.trend} /></td>
                  <td className="ta-r mono">{formatINR(row.fromPrice, { paise: true })}</td>
                  <td className="ta-r mono">{formatINR(row.toPrice, { paise: true })}</td>
                  <td className={`ta-r movers__move ${row.changePct < 0 ? 'neg' : 'pos'}`}>{formatPct(row.changePct)}</td>
                  <td className="ta-r mono">{formatPct(row.belowHighPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function MoverMetric({ label, value }) {
  const direction = value == null ? '' : value > 0 ? 'pos' : value < 0 ? 'neg' : ''
  return (
    <div className="movers__metric">
      <span>{label}</span>
      <strong className={direction}>{formatPct(value)}</strong>
    </div>
  )
}

function MoversMobile({ drawdowns, gainers, filters, onFilter }) {
  const [active, setActive] = useState('drawdowns')
  const rows = active === 'drawdowns' ? drawdowns : gainers
  const declining = active === 'drawdowns'

  return (
    <div className="movers__mobile" style={{ '--mover-tone': declining ? 'var(--mover-loss)' : 'var(--mover-gain)' }}>
      <div className="movers__switch" role="group" aria-label="30-day ranking">
        <button type="button" className={declining ? 'active' : ''} aria-pressed={declining} onClick={() => setActive('drawdowns')}>
          Losers <span>{drawdowns.length}</span>
        </button>
        <button type="button" className={!declining ? 'active' : ''} aria-pressed={!declining} onClick={() => setActive('gainers')}>
          Gainers <span>{gainers.length}</span>
        </button>
      </div>
      <AssetFilter direction={active} value={filters[active]} onChange={(type) => onFilter(active, type)} mobile />
      <MoversAverage direction={active} rows={rows} mobile />
      {rows.length === 0 ? (
        <p className="movers__mobile-empty">No matching {declining ? 'declines' : 'gains'} with enough recent price history.</p>
      ) : (
        <ol className="movers__cards">
          {rows.map((row, index) => (
            <li className="movers__item" key={row.key}>
              <div className="movers__item-head">
                <span className="movers__rank">{String(index + 1).padStart(2, '0')}</span>
                <div className="movers__identity">
                  <strong>{row.name}</strong>
                  <span>{ASSET_TYPES[row.type].label}{row.symbol ? ` · ${row.symbol}` : ''}</span>
                </div>
                <strong className="movers__change">{formatPct(row.changePct)}</strong>
              </div>
              <div className="movers__trend">
                <div className="movers__trend-labels"><span>30-day path</span><span>Low {formatINR(row.lowPrice, { paise: true })} · High {formatINR(row.highPrice, { paise: true })}</span></div>
                <MoverSparkline trend={row.trend} />
              </div>
              <div className="movers__prices">
                <div><span>Then · {formatDate(row.fromDate)}</span><strong>{formatINR(row.fromPrice, { paise: true })}</strong></div>
                <span className="movers__arrow" aria-hidden="true">→</span>
                <div><span>Latest · {formatDate(row.toDate)}</span><strong>{formatINR(row.toPrice, { paise: true })}</strong></div>
              </div>
              <div className="movers__metrics">
                <MoverMetric label="7d move" value={row.sevenDayPct} />
                <MoverMetric label="1Y move" value={row.oneYearPct} />
                <MoverMetric label="From 30d high" value={row.belowHighPct} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

export default function ThirtyDayMovers({ holdings, navMap, priceHistory, mobile = false }) {
  const [filters, setFilters] = useState({ drawdowns: 'all', gainers: 'all' })
  const ranked = useMemo(() => rankedMovers(holdings, navMap, priceHistory), [holdings, navMap, priceHistory])
  const drawdowns = filterMovers(ranked.drawdowns, filters.drawdowns)
  const gainers = filterMovers(ranked.gainers, filters.gainers)
  const onFilter = (direction, type) => setFilters((current) => ({ ...current, [direction]: type }))
  return (
    <section className="movers" aria-labelledby="movers-title">
      <div className="movers__heading">
        <h3 id="movers-title">30-day movers</h3>
      </div>
      <MoversOverview drawdowns={ranked.drawdowns} gainers={ranked.gainers} unchangedCount={ranked.unchangedCount} />
      {mobile ? <MoversMobile drawdowns={drawdowns} gainers={gainers} filters={filters} onFilter={onFilter} /> : (
        <div className="movers__grid">
          <MoversTable title="Losers" direction="drawdowns" rows={drawdowns} filter={filters.drawdowns} onFilter={(type) => onFilter('drawdowns', type)} />
          <MoversTable title="Gainers" direction="gainers" rows={gainers} filter={filters.gainers} onFilter={(type) => onFilter('gainers', type)} />
        </div>
      )}
    </section>
  )
}
