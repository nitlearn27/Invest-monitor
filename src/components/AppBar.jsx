// Slim top bar: brand on the left, the tab nav (inline on desktop, a ☰ hamburger
// menu on mobile), and a ⋮ menu on the right holding the data-source badge +
// Refresh — so the top strip isn't wasted on a big header.
import { useState } from 'react'
import { formatDateTime } from '../lib/format.js'

export default function AppBar({
  source,
  lastUpdated,
  onRefresh,
  busy,
  onRefreshPrices,
  pricesBusy,
  pricesAt,
  tabs,
  tab,
  onTabChange,
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const hasTabs = tabs && tabs.length > 0

  return (
    <header className="appbar">
      <div className="appbar__brand">
        <span className="appbar__logo">◆</span>
        <h1>Invest Monitor</h1>
        {/* Mobile-only cursive wordmark, shown centered in place of the icon */}
        <span className="appbar__wordmark" aria-label="Arti's Assets">
          <span className="appbar__wordmark-cap">A</span>rti&rsquo;s{' '}
          <span className="appbar__wordmark-cap">A</span>ssets
        </span>
      </div>

      {hasTabs && (
        <>
          {/* Desktop: inline scrollable tabs (hidden ≤640px via CSS) */}
          <nav className="tabs" aria-label="Sections">
            {tabs.map((t) => (
              <button
                key={t.key}
                className={tab === t.key ? 'tabs__btn active' : 'tabs__btn'}
                onClick={() => onTabChange(t.key)}
              >
                {t.label}
                {t.count > 0 && <span className="tabs__count">{t.count}</span>}
              </button>
            ))}
          </nav>

          {/* Mobile: ☰ hamburger that opens the section list (shown ≤640px via CSS) */}
          <div className="appbar__nav-menu">
            <button
              className="kebab hamburger"
              aria-label="Sections"
              aria-expanded={navOpen}
              onClick={() => setNavOpen((o) => !o)}
            >
              ☰
            </button>
            {navOpen && (
              <>
                <div className="menu-backdrop" onClick={() => setNavOpen(false)} />
                <div className="menu menu--left" role="menu">
                  {tabs.map((t) => (
                    <button
                      key={t.key}
                      className={`menu__item ${tab === t.key ? 'menu__item--active' : ''}`}
                      role="menuitemradio"
                      aria-checked={tab === t.key}
                      onClick={() => {
                        setNavOpen(false)
                        onTabChange(t.key)
                      }}
                    >
                      {t.label}
                      {t.count > 0 && <span className="tabs__count">{t.count}</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}

      <div className="appbar__menu">
        <button
          className="kebab"
          aria-label="Menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          ⋮
        </button>
        {menuOpen && (
          <>
            <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
            <div className="menu" role="menu">
              {onRefresh && (
                <button
                  className="menu__item"
                  disabled={busy}
                  onClick={() => {
                    setMenuOpen(false)
                    onRefresh()
                  }}
                >
                  {busy ? 'Refreshing…' : '↻ Refresh data'}
                </button>
              )}
              {onRefreshPrices && (
                <button
                  className="menu__item"
                  disabled={pricesBusy}
                  onClick={() => {
                    setMenuOpen(false)
                    onRefreshPrices()
                  }}
                >
                  {pricesBusy ? 'Refreshing prices…' : '↻ Refresh prices'}
                </button>
              )}
              <div className="menu__info">
                {source && <span className={`source-badge source-badge--${source.kind}`}>{source.label}</span>}
                {lastUpdated && <span className="muted">Updated {formatDateTime(lastUpdated)}</span>}
                {pricesAt && <span className="muted">Prices {formatDateTime(pricesAt)}</span>}
              </div>
            </div>
          </>
        )}
      </div>
    </header>
  )
}
