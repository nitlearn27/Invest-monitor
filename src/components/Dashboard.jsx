// Root dashboard: loads data from Google Drive, manages tabs.
import { useCallback, useEffect, useState } from 'react'
import AppBar from './AppBar.jsx'
import ConsolidatedTab from './ConsolidatedTab.jsx'
import MonthlyTab from './MonthlyTab.jsx'
import AssetTab from './AssetTab.jsx'
import TransactionsTab from './TransactionsTab.jsx'
import { Loader, ErrorState, EmptyState } from './StateViews.jsx'
import { driveConfigured } from '../config.js'
import { fetchDriveWorkbooks } from '../lib/drive.js'
import { buildDataset } from '../lib/classify.js'
import { loadCache, saveCache } from '../lib/cache.js'

const TABS = [
  { key: 'consolidated', label: 'Consolidated' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'stock', label: 'Stocks' },
  { key: 'mf', label: 'Mutual Funds' },
  { key: 'etf', label: 'ETFs' },
  { key: 'transactions', label: 'Transactions' },
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

  const loadFromDrive = useCallback(async () => {
    setStatus('loading')
    setError(null)
    try {
      const { parsed } = await fetchDriveWorkbooks()
      const data = buildDataset(parsed)
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

  // Refresh always re-pulls from Drive (when configured).
  const refresh = driveConfigured() ? loadFromDrive : null

  return (
    <div className="app">
      <AppBar
        source={source}
        lastUpdated={lastUpdated}
        onRefresh={refresh}
        busy={status === 'loading'}
        tabs={
          status === 'ready' && dataset
            ? TABS.map((t) => ({
                ...t,
                count: t.key === 'transactions' ? dataset.transactions.length : 0,
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

      {status === 'ready' && dataset && (
        <>
          <main className="container">
            {tab === 'consolidated' && (
              <ConsolidatedTab holdings={dataset.holdings} transactions={dataset.transactions} />
            )}
            {tab === 'monthly' && (
              <MonthlyTab transactions={dataset.transactions} mfTransactions={dataset.mfTransactions} />
            )}
            {tab === 'stock' && <AssetTab type="stock" label="Stocks" holdings={dataset.holdings} />}
            {tab === 'mf' && <AssetTab type="mf" label="Mutual Funds" holdings={dataset.holdings} />}
            {tab === 'etf' && <AssetTab type="etf" label="ETFs" holdings={dataset.holdings} />}
            {tab === 'transactions' && (
              <TransactionsTab holdings={dataset.holdings} transactions={dataset.transactions} />
            )}
          </main>
        </>
      )}
    </div>
  )
}
