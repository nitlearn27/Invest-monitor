// Root dashboard: loads data from Google Drive, manages tabs.
import { useCallback, useEffect, useMemo, useState } from 'react'
import AppBar from './AppBar.jsx'
import ConsolidatedTab from './ConsolidatedTab.jsx'
import MonthlyTab from './MonthlyTab.jsx'
import AssetTab from './AssetTab.jsx'
import TransactionsTab from './TransactionsTab.jsx'
import AnalysisTab from './AnalysisTab.jsx'
import ProjectionTab from './ProjectionTab.jsx'
import { Loader, ErrorState, EmptyState } from './StateViews.jsx'
import { driveConfigured, pricesConfigured } from '../config.js'
import { fetchDriveWorkbooks } from '../lib/drive.js'
import { buildDataset } from '../lib/classify.js'
import { loadCache, saveCache } from '../lib/cache.js'
import { fetchQuotes, enrichHoldings } from '../lib/quotes.js'
import { fetchNavs, enrichMfHoldings, enrichMfTransactions, schemeCodesFor } from '../lib/navs.js'

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
  // Live market prices for stocks/ETFs (Map<symbol, price>); the sheet's stale
  // "Current value" is used as a fallback for anything not resolved here.
  const [priceMap, setPriceMap] = useState(() => new Map())
  const [pricesAt, setPricesAt] = useState(null)
  const [pricesBusy, setPricesBusy] = useState(false)
  // Live MF NAVs (Map<schemeCode, { history, latest }>) from mfapi.in; the sheet's
  // stale MF "Current value" is the fallback for any fund not resolved here.
  const [navMap, setNavMap] = useState(() => new Map())

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
      const symbols = dataset.holdings
        .filter((h) => (h.type === 'stock' || h.type === 'etf') && h.symbol)
        .map((h) => h.symbol)
      if (symbols.length === 0) return
      setPricesBusy(true)
      try {
        const map = await fetchQuotes(symbols, { force })
        if (map.size > 0) {
          setPriceMap(map)
          setPricesAt(new Date())
        }
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
      if (!dataset) return
      const codes = [
        ...new Set([
          ...schemeCodesFor(dataset.holdings, false),
          ...schemeCodesFor(dataset.mfTransactions, true),
        ]),
      ]
      if (codes.length === 0) return
      const map = await fetchNavs(codes, { force })
      if (map.size > 0) setNavMap(map)
    },
    [dataset],
  )

  // Refresh prices + NAVs whenever the dataset changes (load from Drive or cache).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (cancelled) return
      await loadPrices(false)
      await loadNavs(false)
    })()
    return () => {
      cancelled = true
    }
  }, [loadPrices, loadNavs])

  // Holdings with live prices applied; everything downstream (cards, allocation,
  // tabs) reads these so the UI reflects live values without further changes.
  const view = useMemo(
    () =>
      dataset
        ? {
            ...dataset,
            holdings: enrichMfHoldings(enrichHoldings(dataset.holdings, priceMap), navMap),
            mfTransactions: enrichMfTransactions(dataset.mfTransactions, navMap),
          }
        : null,
    [dataset, priceMap, navMap],
  )

  // Refresh always re-pulls from Drive (when configured).
  const refresh = driveConfigured() ? loadFromDrive : null
  // The manual action force-refreshes live stock prices and MF NAVs together.
  const refreshPrices = () => {
    if (pricesConfigured()) loadPrices(true)
    loadNavs(true)
  }

  return (
    <div className="app">
      <AppBar
        source={source}
        lastUpdated={lastUpdated}
        onRefresh={refresh}
        busy={status === 'loading'}
        onRefreshPrices={refreshPrices}
        pricesBusy={pricesBusy}
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
              <ConsolidatedTab holdings={view.holdings} transactions={view.transactions} />
            )}
            {tab === 'monthly' && (
              <MonthlyTab transactions={view.transactions} mfTransactions={view.mfTransactions} />
            )}
            {tab === 'stock' && <AssetTab type="stock" label="Stocks" holdings={view.holdings} />}
            {tab === 'mf' && <AssetTab type="mf" label="Mutual Funds" holdings={view.holdings} />}
            {tab === 'etf' && <AssetTab type="etf" label="ETFs" holdings={view.holdings} />}
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
