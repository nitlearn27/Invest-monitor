// Root dashboard: loads data from Google Drive, manages tabs.
import { useCallback, useEffect, useMemo, useState } from 'react'
import AppBar from './AppBar.jsx'
import ConsolidatedTab from './ConsolidatedTab.jsx'
import MonthlyTab from './MonthlyTab.jsx'
import AssetTab from './AssetTab.jsx'
import TransactionsTab from './TransactionsTab.jsx'
import MfWhatIf from './MfWhatIf.jsx'
import EquityWhatIf from './EquityWhatIf.jsx'
import AnalysisTab from './AnalysisTab.jsx'
import ProjectionTab from './ProjectionTab.jsx'
import CorrectionStrategyCard from './CorrectionStrategyCard.jsx'
import { useCorrectionStrategies } from '../lib/useCorrectionStrategies.js'
import { DEFAULT_CORRECTION_STRATEGY, STRATEGY_POLL_MS } from '../lib/correctionStrategy.js'
import { Loader, ErrorState, EmptyState } from './StateViews.jsx'
import { driveConfigured, pricesConfigured } from '../config.js'
import { fetchDriveWorkbooks } from '../lib/drive.js'
import { buildDataset } from '../lib/classify.js'
import { loadCache, saveCache } from '../lib/cache.js'
import {
  fetchQuotes,
  fetchPriceHistory,
  enrichHoldings,
  quotesSyncedAt,
  PRICE_TTL_MS,
} from '../lib/quotes.js'
import {
  fetchNavs,
  enrichMfHoldings,
  enrichMfTransactions,
  schemeCodesFor,
  navAsOf,
  mfKey,
} from '../lib/navs.js'
import { MARKET_CODES } from '../lib/market.js'
import { withDerivedHoldings } from '../lib/derive.js'
import { withRecurringSips } from '../lib/monthly.js'

// A NAV date older than this reads as stale on the MF tab's stamp. Measured on
// the NAV DATE, not the fetch, so it has to clear a weekend plus a market
// holiday before it cries wolf.
const NAV_DATE_STALE_MS = 4 * 24 * 60 * 60 * 1000

const TABS = [
  { key: 'consolidated', label: 'Consolidated' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'stock', label: 'Stocks' },
  { key: 'mf', label: 'Mutual Funds' },
  { key: 'etf', label: 'ETFs' },
  { key: 'transactions', label: 'Transactions' },
  { key: 'analysis', label: 'Portfolio Analysis' },
  { key: 'projection', label: 'Projection' },
]

export default function Dashboard() {
  // Hydrate from the persistent cache once, so reloads don't hit Google Drive.
  const [boot] = useState(loadCache)
  const [status, setStatus] = useState(() => (boot?.dataset ? 'ready' : 'idle')) // idle | loading | ready | error
  const [dataset, setDataset] = useState(() => boot?.dataset || null)
  const [error, setError] = useState(null)
  const [source, setSource] = useState(() => (boot?.dataset ? { kind: 'cache', label: '⚡ Cached' } : null))
  const [lastUpdated, setLastUpdated] = useState(() => (boot?.cachedAt ? new Date(boot.cachedAt) : null))
  const [tab, setTab] = useState('consolidated')
  // Deep link from the goal card's "this month" tiles into the Monthly tab.
  const [monthFocus, setMonthFocus] = useState(null)
  // Live market prices for stocks/ETFs (Map<symbol, { price, prev }>, prev being
  // the previous session's close, which is what makes a 1-day move computable);
  // the sheet's stale "Current value" is the fallback for anything unresolved.
  const [priceMap, setPriceMap] = useState(() => new Map())
  // Daily close history for the same symbols — the Consolidated goal chart
  // values past holdings on the day they were held with it, and the Stocks/ETF
  // buying-pattern cards replay the buys against it.
  const [priceHistory, setPriceHistory] = useState(() => new Map())
  const [pricesAt, setPricesAt] = useState(null)
  const [pricesBusy, setPricesBusy] = useState(false)
  // Live MF NAVs (Map<schemeCode, { history, latest, ts }>) from mfapi.in; the
  // sheet's stale MF "Current value" is the fallback for any fund not resolved
  // here.
  const [navMap, setNavMap] = useState(() => new Map())
  const [navsBusy, setNavsBusy] = useState(false)
  const [strategyTick, setStrategyTick] = useState(0)

  const loadFromDrive = useCallback(async () => {
    setStatus('loading')
    setError(null)
    try {
      const { parsed, analysisHtml } = await fetchDriveWorkbooks()
      const data = buildDataset(parsed)
      data.analysisHtml = analysisHtml
      if (data.holdings.length === 0 && data.transactions.length === 0) {
        throw new Error('Files were fetched but no INDmoney reports were recognized in them.')
      }
      const now = new Date()
      setDataset(data)
      setSource({ kind: 'drive', label: '☁ Google Drive' })
      setLastUpdated(now)
      setStatus('ready')
      saveCache(data) // refresh the cache so reloads stay fast
    } catch (e) {
      setError(e.message || String(e))
      setStatus('error')
    }
  }, [])

  // Startup is hydrated from cache via the lazy state above. Only the very first
  // run (empty cache) pulls from Drive automatically; after that, Drive is hit
  // only when the user clicks Refresh.
  useEffect(() => {
    if (boot?.dataset || !driveConfigured()) return
    let cancelled = false
    ;(async () => {
      if (!cancelled) await loadFromDrive()
    })()
    return () => {
      cancelled = true
    }
  }, [boot, loadFromDrive])

  // Fetch live prices for the stock/ETF symbols in the current dataset. `force`
  // bypasses the per-symbol TTL cache (used by the manual Refresh prices button).
  const loadPrices = useCallback(
    async (force) => {
      if (!pricesConfigured() || !dataset) return
      // Holdings + transactions: INDmoney equity holdings are derived from the
      // transactions sheet, so their symbols only exist on the transactions.
      const symbols = [
        ...new Set([
          ...dataset.holdings
            .filter((h) => (h.type === 'stock' || h.type === 'etf') && h.symbol)
            .map((h) => h.symbol),
          ...dataset.transactions.filter((t) => t.symbol).map((t) => t.symbol),
        ]),
      ]
      if (symbols.length === 0) return
      setPricesBusy(true)
      try {
        const map = await fetchQuotes(symbols, { force })
        if (map.size > 0) {
          setPriceMap(map)
          // From the quotes' own timestamps, not `now`: a cache-served boot
          // refreshed nothing, and stamping it "just now" would be a lie.
          setPricesAt(quotesSyncedAt(map))
        }
        const history = await fetchPriceHistory(symbols, { force })
        if (history.size > 0) setPriceHistory(history)
      } finally {
        setPricesBusy(false)
      }
    },
    [dataset],
  )

  // Fetch live MF NAVs for the funds in the current dataset (those resolved to an
  // AMFI scheme code in resources/mf-schemes.json). No proxy needed — mfapi.in is
  // CORS-enabled. `force` bypasses the daily TTL (manual Refresh).
  const loadNavs = useCallback(
    async (force) => {
      const codes = [
        ...new Set([
          DEFAULT_CORRECTION_STRATEGY.schemeCode,
          ...schemeCodesFor(dataset?.holdings, false),
          ...schemeCodesFor(dataset ? withRecurringSips(dataset.mfTransactions) : [], true),
          // Index funds standing in for the mid/small-cap market on the
          // Consolidated tab — pinned, so the series doesn't change shape when
          // the user buys or sells a fund.
          ...MARKET_CODES,
        ]),
      ]
      if (codes.length === 0) return
      setNavsBusy(true)
      try {
        const map = await fetchNavs(codes, { force })
        if (map.size > 0) setNavMap(map)
      } finally {
        setNavsBusy(false)
      }
    },
    [dataset],
  )

  // Refresh prices + NAVs whenever the dataset changes (load from Drive or cache).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (cancelled) return
      await Promise.all([loadPrices(false), loadNavs(false)])
    })()
    return () => {
      cancelled = true
    }
  }, [loadPrices, loadNavs])

  // This static app has no background server. Check while visible and on return;
  // the persisted engine catches up missed NAV dates after the app was closed.
  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== 'visible') return
      setStrategyTick((value) => value + 1)
      void loadNavs(true)
    }
    const timer = window.setInterval(check, STRATEGY_POLL_MS)
    window.addEventListener('focus', check)
    window.addEventListener('online', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', check)
      window.removeEventListener('online', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [loadNavs])

  // View pipeline: inject the recurring SIP legs, resolve their units from NAV
  // history, derive the INDmoney holdings from the transaction sheets (replacing
  // the manual My Stocks / My MFs sheets), then apply live prices + NAVs.
  // Everything downstream (cards, allocation, tabs) reads these.
  const view = useMemo(() => {
    if (!dataset) return null
    const mfTransactions = enrichMfTransactions(withRecurringSips(dataset.mfTransactions), navMap)
    const holdings = withDerivedHoldings(dataset.holdings, dataset.transactions, mfTransactions)
    return {
      ...dataset,
      holdings: enrichMfHoldings(enrichHoldings(holdings, priceMap), navMap),
      mfTransactions,
    }
  }, [dataset, priceMap, navMap])

  const strategies = useCorrectionStrategies(view?.holdings, navMap, strategyTick)

  // Refresh always re-pulls from Drive (when configured).
  const refresh = driveConfigured() ? loadFromDrive : null
  // The manual action force-refreshes live stock prices and MF NAVs together.
  const refreshPrices = useCallback(() => {
    if (pricesConfigured()) loadPrices(true)
    loadNavs(true)
  }, [loadPrices, loadNavs])

  // What dates the numbers on the asset tabs. Funds report the NAV's OWN date —
  // the day its price was struck, which is what the Current column is worth;
  // equities have no such date (a quote moves all session), so theirs reports
  // the pull instead.
  const mfFreshness = useMemo(
    () => ({
      noun: 'NAV',
      asOf: navAsOf(navMap, schemeCodesFor(view?.holdings || [], false)),
      syncedAt: null,
      staleAfterMs: NAV_DATE_STALE_MS,
      busy: navsBusy,
      onRefresh: refreshPrices,
    }),
    [navMap, view, navsBusy, refreshPrices],
  )
  const equityFreshness = useMemo(
    () => ({
      noun: 'Prices',
      asOf: null,
      syncedAt: pricesAt,
      staleAfterMs: PRICE_TTL_MS,
      busy: pricesBusy,
      onRefresh: refreshPrices,
    }),
    [pricesAt, pricesBusy, refreshPrices],
  )

  // Latest buy per fund — ranks the MF tab's folded view (5 most recently
  // bought funds up front; funds with no transactions rank last).
  const mfLastBuy = useMemo(() => {
    const m = new Map()
    for (const t of view?.mfTransactions || []) {
      if (!t.date) continue
      const k = mfKey(t.name)
      if (t.date.getTime() > (m.get(k) || 0)) m.set(k, t.date.getTime())
    }
    return m
  }, [view])


  return (
    <div className="app">
      <AppBar
        source={source}
        lastUpdated={lastUpdated}
        onRefresh={refresh}
        busy={status === 'loading'}
        onRefreshPrices={refreshPrices}
        pricesBusy={pricesBusy || navsBusy}
        pricesAt={pricesAt}
        tabs={
          status === 'ready' && view
            ? TABS.map((t) => ({
                ...t,
                count: t.key === 'transactions' ? view.transactions.length : 0,
              }))
            : null
        }
        tab={tab}
        onTabChange={setTab}
      />

      {tab === 'consolidated' && (status !== 'ready' || !view) && <div className="container">
        <CorrectionStrategyCard monitor={strategies} busy={navsBusy} onRefresh={() => loadNavs(true)} />
      </div>}

      {status === 'loading' && <Loader label="Fetching your reports…" />}

      {status === 'error' && (
        <div className="container">
          <ErrorState message={error} onRetry={driveConfigured() ? loadFromDrive : undefined} />
        </div>
      )}

      {status === 'idle' && (
        <div className="container">
          <EmptyState title="No data yet">
            {driveConfigured()
              ? 'Connecting to Google Drive…'
              : 'Set VITE_GDRIVE_FOLDER_ID and VITE_GDRIVE_API_KEY in .env, then restart.'}
          </EmptyState>
        </div>
      )}

      {status === 'ready' && view && (
        <>
          <main className="container">
            {tab === 'consolidated' && (
              <ConsolidatedTab
                strategy={<CorrectionStrategyCard monitor={strategies} busy={navsBusy} onRefresh={() => loadNavs(true)} />}
                holdings={view.holdings}
                transactions={view.transactions}
                mfTransactions={view.mfTransactions}
                navMap={navMap}
                priceHistory={priceHistory}
                onOpenMonth={(month) => {
                  setMonthFocus(month)
                  setTab('monthly')
                }}
              />
            )}
            {tab === 'monthly' && (
              <MonthlyTab
                transactions={view.transactions}
                mfTransactions={view.mfTransactions}
                focusMonth={monthFocus}
              />
            )}
            {tab === 'stock' && (
              <>
                <AssetTab type="stock" label="Stocks" holdings={view.holdings} freshness={equityFreshness} />
                <EquityWhatIf
                  type="stock"
                  label="Stocks"
                  transactions={view.transactions}
                  holdings={view.holdings}
                  priceHistory={priceHistory}
                />
              </>
            )}
            {tab === 'mf' && (
              <>
                <AssetTab
                  type="mf"
                  label="Mutual Funds"
                  holdings={view.holdings}
                  foldTo={5}
                  rankOf={(h) => mfLastBuy.get(mfKey(h.name)) ?? 0}
                  freshness={mfFreshness}
                />
                <MfWhatIf
                  mfTransactions={view.mfTransactions}
                  holdings={view.holdings}
                  navMap={navMap}
                />
              </>
            )}
            {tab === 'etf' && (
              <>
                <AssetTab type="etf" label="ETFs" holdings={view.holdings} freshness={equityFreshness} />
                <EquityWhatIf
                  type="etf"
                  label="ETFs"
                  transactions={view.transactions}
                  holdings={view.holdings}
                  priceHistory={priceHistory}
                />
              </>
            )}
            {tab === 'transactions' && (
              <TransactionsTab
                holdings={view.holdings}
                transactions={view.transactions}
                mfTransactions={view.mfTransactions}
              />
            )}
            {tab === 'analysis' && <AnalysisTab html={view.analysisHtml} />}
            {tab === 'projection' && (
              <ProjectionTab rows={view.projection || []} holdings={view.holdings} />
            )}
          </main>
        </>
      )}
    </div>
  )
}
