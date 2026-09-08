import { useCallback, useEffect, useMemo, useState } from 'react'
import { schemeFor } from './navs.js'
import { DEFAULT_CORRECTION_STRATEGY, indiaDate } from './correctionStrategy.js'
import { openStrategyStore } from './strategyStore.js'

let storePromise
const getStore = () => {
  if (!storePromise) storePromise = openStrategyStore().catch((error) => {
    storePromise = null
    throw error
  })
  return storePromise
}

export function strategyFunds(holdings) {
  const funds = new Map([[DEFAULT_CORRECTION_STRATEGY.schemeCode, {
    schemeCode: DEFAULT_CORRECTION_STRATEGY.schemeCode,
    fundName: DEFAULT_CORRECTION_STRATEGY.fundName,
  }]])
  for (const holding of holdings || []) {
    if (holding.type !== 'mf') continue
    const scheme = schemeFor(holding.name, holding.source)
    if (scheme) funds.set(scheme.schemeCode, { schemeCode: scheme.schemeCode, fundName: scheme.schemeName })
    else funds.set(`unmapped:${holding.name}`, { schemeCode: null, fundName: holding.name })
  }
  return [...funds.values()]
}

export function useCorrectionStrategies(holdings, navMap, tick) {
  const fundsKey = JSON.stringify(strategyFunds(holdings))
  const funds = useMemo(() => JSON.parse(fundsKey), [fundsKey])
  const [snapshot, setSnapshot] = useState(null)
  const [error, setError] = useState(null)
  const [revision, setRevision] = useState(0)
  const refresh = useCallback(() => setRevision((value) => value + 1), [])

  useEffect(() => {
    let cancelled = false
    getStore().then((store) => store.monitor(funds.filter((fund) => fund.schemeCode), navMap, indiaDate()))
      .then((next) => {
        if (!cancelled) { setSnapshot(next); setError(null) }
      }).catch((failure) => { if (!cancelled) setError(failure.message) })
    return () => { cancelled = true }
  }, [funds, navMap, revision, tick])

  // Tab updates only request a fresh read/evaluation; atomicity lives in the DB.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const channel = new BroadcastChannel('invest-monitor:strategies')
    channel.onmessage = refresh
    return () => channel.close()
  }, [refresh])

  const changed = useCallback(() => {
    refresh()
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('invest-monitor:strategies')
      channel.postMessage('changed')
      channel.close()
    }
  }, [refresh])
  const saveConfig = useCallback(async (config) => {
    const result = await (await getStore()).saveConfig(config, indiaDate())
    changed()
    return result
  }, [changed])
  const review = useCallback(async (id) => {
    await (await getStore()).review(id)
    changed()
  }, [changed])

  return { funds, snapshot, error, saveConfig, review, refresh, navMap }
}
