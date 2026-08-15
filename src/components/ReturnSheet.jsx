// "Markets gave you X" — the breakdown behind that one number, opened from the
// goal card's pulse tile. Bottom sheet on phones, centred dialog on desktop.
//
// The month is read as a waterfall: what you were holding on the 1st, what you
// added, what the market did to it, what you hold now. Then the same movement
// split by asset class and by position, so "the market gave me ₹1.9L" turns into
// "…and here is which funds did it". Data: goalProgress().detail (lib/goal.js).
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ASSET_TYPES, ASSET_COLORS } from '../config.js'
import { formatINR, formatINRCompact } from '../lib/format.js'

const sign = (v) => (v >= 0 ? '▲' : '▼')
const tone = (v) => (v >= 0 ? 'pos' : 'neg')
const signedINR = (v) => `${v >= 0 ? '+' : '−'} ${formatINR(Math.round(Math.abs(v)))}`

const MOVERS_SHOWN = 8

export default function ReturnSheet({ detail, onClose }) {
  const [sortBy, setSortBy] = useState('amount') // 'amount' | 'pct'
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  if (!detail) return null
  const { openValue, openInvested, added, market, closeValue, closeInvested, returnPct } = detail

  // Waterfall bar widths: the opening corpus is the bulk, the two deltas are the
  // story — floor each delta so a small month still reads as a visible sliver.
  const span = Math.max(openValue + Math.abs(added) + Math.abs(market), 1)
  const w = (v) => `${Math.max(1.5, (Math.abs(v) / span) * 100)}%`

  // "Which fund earned the most" has two honest answers — biggest rupee move,
  // and best return on what was sitting there. The toggle picks which.
  const ranked = [...detail.movers].sort((a, b) => {
    if (sortBy === 'amount') return Math.abs(b.market) - Math.abs(a.market)
    const r = (m) => (m.open > 0 ? m.market / m.open : -Infinity)
    return r(b) - r(a)
  })
  const shown = showAll ? ranked : ranked.slice(0, MOVERS_SHOWN)
  const maxMove = Math.max(...shown.map((m) => Math.abs(m.market)), 1)

  // Portalled to <body>: the goal card is a backdrop-filtered .card on desktop,
  // which would otherwise become the containing block for position:fixed.
  return createPortal(
    <div className="rsheet__scrim" onClick={onClose} role="presentation">
      <div
        className="rsheet"
        role="dialog"
        aria-modal="true"
        aria-label={`Return for ${detail.label}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rsheet__grab" aria-hidden="true" />
        <header className="rsheet__head">
          <div>
            <p className="rsheet__eyebrow">Markets gave you · {detail.label}</p>
            <p className={`rsheet__big ${tone(market)}`}>
              {sign(market)} {formatINR(Math.round(Math.abs(market)))}
            </p>
            <p className="rsheet__sub">
              {returnPct != null && (
                <strong className={tone(returnPct)}>
                  {returnPct >= 0 ? '+' : ''}
                  {returnPct.toFixed(2)}%
                </strong>
              )}{' '}
              on the {formatINRCompact(openValue)} you were already holding on the 1st
            </p>
          </div>
          <button className="rsheet__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="rsheet__body">
          <section className="rsheet__block">
            <h4 className="rsheet__title">How the month built up</h4>
            <div className="rsheet__flow" role="img" aria-label="Opening corpus, money added, market movement">
              <span className="rsheet__flow-seg rsheet__flow-seg--base" style={{ width: w(openValue) }} />
              <span className="rsheet__flow-seg rsheet__flow-seg--added" style={{ width: w(added) }} />
              <span
                className={`rsheet__flow-seg rsheet__flow-seg--${market >= 0 ? 'gain' : 'loss'}`}
                style={{ width: w(market) }}
              />
            </div>
            <dl className="rsheet__rows">
              <div className="rsheet__row">
                <dt>
                  <span className="rsheet__swatch rsheet__swatch--base" />
                  Corpus on the 1st
                </dt>
                <dd>{formatINR(Math.round(openValue))}</dd>
              </div>
              <div className="rsheet__row">
                <dt>
                  <span className="rsheet__swatch rsheet__swatch--added" />
                  You invested
                </dt>
                <dd>{signedINR(added)}</dd>
              </div>
              <div className="rsheet__row">
                <dt>
                  <span className={`rsheet__swatch rsheet__swatch--${market >= 0 ? 'gain' : 'loss'}`} />
                  Markets gave
                </dt>
                <dd className={tone(market)}>{signedINR(market)}</dd>
              </div>
              <div className="rsheet__row rsheet__row--total">
                <dt>Corpus today</dt>
                <dd>{formatINR(Math.round(closeValue))}</dd>
              </div>
            </dl>
            <p className="rsheet__note">
              Total invested to date {formatINR(Math.round(closeInvested))} — up from{' '}
              {formatINR(Math.round(openInvested))} on the 1st. Everything above that is growth, not money you
              put in.
            </p>
          </section>

          {detail.classes.length > 0 && (
            <section className="rsheet__block">
              <h4 className="rsheet__title">Which side of the portfolio earned it</h4>
              <div className="rsheet__classes">
                {detail.classes.map((c) => {
                  const pct = c.open > 0 ? (c.market / c.open) * 100 : null
                  const share = Math.abs(market) > 0 ? Math.abs(c.market / market) * 100 : 0
                  return (
                    <div className="rsheet__cls" key={c.key} style={{ '--c': ASSET_COLORS[c.key] }}>
                      <div className="rsheet__cls-head">
                        <span className="rsheet__cls-name">
                          <span className="rsheet__dot" />
                          {ASSET_TYPES[c.key]?.label || c.key}
                        </span>
                        <span className={`rsheet__cls-val ${tone(c.market)}`}>
                          {signedINR(c.market)}
                          {pct != null && <em>{pct >= 0 ? '+' : ''}{pct.toFixed(1)}%</em>}
                        </span>
                      </div>
                      <div className="rsheet__cls-bar">
                        <span style={{ width: `${Math.min(100, share)}%` }} />
                      </div>
                      <p className="rsheet__cls-foot">
                        {formatINRCompact(c.close)} held · {signedINR(c.added)} added this month
                      </p>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {ranked.length > 0 && (
            <section className="rsheet__block">
              <div className="rsheet__title-row">
                <h4 className="rsheet__title">Who moved the needle</h4>
                <div className="segmented segmented--sm" role="group" aria-label="Rank movers by">
                  <button className={sortBy === 'amount' ? 'active' : ''} onClick={() => setSortBy('amount')}>
                    ₹
                  </button>
                  <button className={sortBy === 'pct' ? 'active' : ''} onClick={() => setSortBy('pct')}>
                    %
                  </button>
                </div>
              </div>
              <ul className="rsheet__movers">
                {shown.map((m) => {
                  const pct = m.open > 0 ? (m.market / m.open) * 100 : null
                  return (
                    <li className="rsheet__mover" key={`${m.source}-${m.name}`}>
                      <span className="rsheet__mover-name" title={`${m.name} · ${m.source}`}>
                        {m.name}
                        {m.estimated && <span className="rsheet__est">est</span>}
                      </span>
                      <span className={`rsheet__mover-val ${tone(m.market)}`}>
                        {sign(m.market)} {formatINRCompact(Math.abs(m.market))}
                      </span>
                      <span className="rsheet__mover-bar">
                        <span
                          className={m.market >= 0 ? 'pos' : 'neg'}
                          style={{ width: `${(Math.abs(m.market) / maxMove) * 100}%` }}
                        />
                      </span>
                      <span className={`rsheet__mover-pct ${pct != null ? tone(pct) : ''}`}>
                        {pct != null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%` : '—'}
                      </span>
                    </li>
                  )
                })}
              </ul>
              {ranked.length > MOVERS_SHOWN && (
                <button className="rsheet__more" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? 'Show top movers only' : `See all ${ranked.length} positions`}
                </button>
              )}
              {detail.estimatedCount > 0 && (
                <p className="rsheet__note">
                  <span className="rsheet__est">est</span> — brokers with no transaction sheet (Axis, Coin).
                  Their month is priced from NAV with units assumed unchanged, so it's real movement but{' '}
                  <strong>not</strong> counted in the {signedINR(market)} above — that would be{' '}
                  {signedINR(market + detail.estimatedMarket)} with them included.
                </p>
              )}
            </section>
          )}

          {(detail.untracked > 1 || detail.unpriced.length > 0) && (
            <p className="rsheet__note rsheet__note--foot">
              {detail.untracked > 1 && (
                <>
                  {formatINRCompact(detail.untracked)} of the corpus isn't on the timeline, so the corpus
                  chart carries it flat.{' '}
                </>
              )}
              {detail.unpriced.length > 0 && (
                <>
                  No price history for {detail.unpriced.map((u) => u.name).join(', ')} — add it to
                  resources/mf-schemes.json (or name-symbols.json) to see its month.
                </>
              )}
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
