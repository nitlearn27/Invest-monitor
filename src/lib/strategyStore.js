import {
  DEFAULT_CORRECTION_STRATEGY, createStrategyMonth, evaluateStrategyMonth, validateStrategy,
} from './correctionStrategy.js'

const DB_NAME = 'invest-monitor:strategies'
const STORES = ['strategies', 'months', 'recommendations']

// All read/modify/write operations use ONE overlapping readwrite transaction.
// IndexedDB serializes these across tabs/connections. A unique multi-entry index
// additionally prevents the same monthly trigger appearing in two alerts.
export function openStrategyStore(factory = globalThis.indexedDB, name = DB_NAME) {
  return new Promise((resolve, reject) => {
    if (!factory) return reject(new Error('Strategy storage is unavailable in this browser.'))
    const request = factory.open(name, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      db.createObjectStore('strategies', { keyPath: 'schemeCode' })
      const months = db.createObjectStore('months', { keyPath: 'id' })
      months.createIndex('schemeCode', 'schemeCode')
      const recommendations = db.createObjectStore('recommendations', { keyPath: 'id' })
      recommendations.createIndex('monthId', 'monthId')
      recommendations.createIndex('triggerKeys', 'triggerKeys', { unique: true, multiEntry: true })
    }
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Close older Invest Monitor tabs to upgrade strategy storage.'))
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => db.close()

      function transaction(mode, change) {
        return new Promise((resolveTransaction, rejectTransaction) => {
          const tx = db.transaction(STORES, mode)
          const snapshot = {}
          let pending = STORES.length
          let result, failure
          tx.oncomplete = () => resolveTransaction(result)
          tx.onabort = () => rejectTransaction(failure || tx.error || new Error('Strategy update was not saved.'))
          tx.onerror = () => { /* onabort handles rollback and rejection */ }
          for (const store of STORES) {
            const read = tx.objectStore(store).getAll()
            read.onsuccess = () => {
              snapshot[store] = read.result
              if (--pending !== 0) return
              try {
                result = change(snapshot, (table, value) => tx.objectStore(table).put(value))
              } catch (error) {
                failure = error
                tx.abort()
              }
            }
          }
        })
      }

      resolve({
        close: () => db.close(),
        read: () => transaction('readonly', (snapshot) => snapshot),
        monitor: (funds, navMap, asOf) => transaction('readwrite', (snapshot, put) => {
          const month = asOf.slice(0, 7)
          const strategies = new Map(snapshot.strategies.map((config) => [config.schemeCode, config]))
          const months = new Map(snapshot.months.map((record) => [record.id, record]))
          const recommendations = new Map(snapshot.recommendations.map((record) => [record.id, record]))
          for (const fund of funds) {
            if (!strategies.has(fund.schemeCode)) {
              const config = { ...validateStrategy({ ...DEFAULT_CORRECTION_STRATEGY, ...fund }), startedMonth: month }
              strategies.set(fund.schemeCode, config)
              put('strategies', config)
            }
          }
          for (const config of strategies.values()) {
            const history = navMap.get(config.schemeCode)?.history || []
            // Resume missed months since tracking began, preserving every month's
            // configuration snapshot and catching up on actual NAV observations.
            for (let cursor = config.startedMonth; cursor <= month;) {
              const id = `${config.schemeCode}:${cursor}`
              const previous = months.get(id) || createStrategyMonth(config, cursor)
              const evaluated = evaluateStrategyMonth(previous, history, asOf)
              months.set(id, evaluated.state)
              put('months', evaluated.state)
              for (const recommendation of evaluated.recommendations) {
                const record = { ...recommendation, createdAt: new Date().toISOString() }
                recommendations.set(record.id, record)
                put('recommendations', record)
              }
              const [year, number] = cursor.split('-').map(Number)
              cursor = new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 7)
            }
          }
          return { strategies: [...strategies.values()], months: [...months.values()], recommendations: [...recommendations.values()] }
        }),
        saveConfig: (input, asOf) => transaction('readwrite', (snapshot, put) => {
          const config = validateStrategy(input)
          const existing = snapshot.strategies.find((item) => item.schemeCode === config.schemeCode)
          const saved = { ...config, startedMonth: existing?.startedMonth || asOf.slice(0, 7) }
          put('strategies', saved)
          const current = snapshot.months.find((item) => item.id === `${config.schemeCode}:${asOf.slice(0, 7)}`)
          // Never reinterpret already-issued recommendations under a new budget.
          const deferred = Boolean(current?.allocatedPaise)
          if (current && !deferred) put('months', createStrategyMonth(saved, current.month))
          return { deferred }
        }),
        review: (id) => transaction('readwrite', (snapshot, put) => {
          const record = snapshot.recommendations.find((item) => item.id === id)
          if (record) put('recommendations', { ...record, status: 'reviewed', reviewedAt: new Date().toISOString() })
        }),
      })
    }
  })
}
