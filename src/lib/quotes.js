// Live market prices for stock/ETF holdings.
//
// The INDmoney sheet stays the source of truth for qty / avgPrice / invested,
// but the "Current value" is recomputed from a live price fetched here.
//
// Provider: Yahoo Finance's batch "spark" endpoint, which returns NSE quotes in
// INR (no API key, no per-symbol rate cost). Yahoo doesn't send CORS headers, so
// the browser can't call it directly — we route through a public CORS proxy
// (allorigins by default; override with VITE_PRICE_PROXY). Everything is isolated
// in this module so the provider/proxy can be swapped without touching the app.
//
// Markets are Indian only (NSE), so prices are already in INR — no currency
// conversion. On any failure callers get a partial/empty map and fall back to the
// sheet's stale value.
import { PRICE } from '../config.js'

const SPARK = 'https://query1.finance.yahoo.com/v8/finance/spark'
const SUFFIX = '.NS' // NSE
const CHUNK = 40 // symbols per request (keeps the proxied URL a sane length)
const TTL_MS = 10 * 60 * 1000 // reuse a price for 10 min before refetching
const CACHE_KEY = 'invest-monitor:prices:v1'

// INDmoney symbol -> full Yahoo symbol, for names that don't map to "<SYM>.NS"
// (e.g. BSE-only scrips needing ".BO"). Populate as mismatches surface. Keys are
// upper-cased INDmoney symbols.
const SYMBOL_OVERRIDES = {}

const normalize = (s) => String(s || '').trim().toUpperCase()
const yahooSymbol = (sym) => SYMBOL_OVERRIDES[sym] || `${sym}${SUFFIX}`
const proxied = (url) => `${PRICE.proxy}${encodeURIComponent(url)}`

// --- localStorage price cache: { [symbol]: { price, ts } } -------------------
function readCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}
  } catch {
    return {}
  }
}

function writeCache(cache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    // best-effort
  }
}

const chunk = (arr, n) => {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

// Latest price from a Yahoo spark entry: last finite `close`, else prev close.
function priceFrom(entry) {
  if (!entry) return null
  const closes = Array.isArray(entry.close) ? entry.close.filter((v) => Number.isFinite(v)) : []
  const v = closes.length ? closes[closes.length - 1] : Number(entry.chartPreviousClose)
  return Number.isFinite(v) && v > 0 ? v : null
}

// Fetch one chunk -> { yahooSymbol: price|null }. The spark response is keyed by
// symbol directly, or nested under { spark: { result: [...] } } depending on the
// endpoint/proxy; handle both.
async function fetchChunk(ySymbols) {
  const url = `${SPARK}?symbols=${ySymbols.join(',')}&range=1d&interval=1d`
  const res = await fetch(proxied(url))
  if (!res.ok) throw new Error(`Quote fetch failed (${res.status})`)
  const data = await res.json()
  const out = {}
  const results = data?.spark?.result
  if (Array.isArray(results)) {
    for (const r of results) out[r.symbol] = priceFrom(r.response?.[0]?.meta || r.response?.[0])
  } else {
    for (const sym of ySymbols) out[sym] = priceFrom(data?.[sym])
  }
  return out
}

// Fetch live prices for the given symbols. Returns a Map<symbol, number> (INR).
// Symbols with a fresh cache entry skip the network. `force` bypasses the TTL
// (manual Refresh button). Never throws — partial results are returned on error.
export async function fetchQuotes(symbols, { force = false } = {}) {
  const result = new Map()
  if (!PRICE.proxy) return result

  const wanted = [...new Set(symbols.map(normalize).filter(Boolean))]
  const cache = readCache()
  const now = Date.now()

  const stale = []
  for (const sym of wanted) {
    const hit = cache[sym]
    if (!force && hit && now - hit.ts < TTL_MS && hit.price != null) {
      result.set(sym, hit.price)
    } else {
      stale.push(sym)
    }
  }

  for (const group of chunk(stale, CHUNK)) {
    const ySymbols = group.map(yahooSymbol)
    let prices
    try {
      prices = await fetchChunk(ySymbols)
    } catch {
      continue // leave these unresolved; caller falls back to the sheet value
    }
    group.forEach((sym, i) => {
      const price = prices[ySymbols[i]]
      if (price != null) {
        result.set(sym, price)
        cache[sym] = { price, ts: now }
      }
    })
  }

  writeCache(cache)
  return result
}

// --- daily close history (goal tracker) --------------------------------------
// The same spark endpoint over a 5-year window, so the Consolidated goal chart
// can value past holdings on the day they were held. Cached separately from the
// live price (history changes once a day, and it is far bulkier).
const HISTORY_KEY = 'invest-monitor:price-history:v1'
const HISTORY_TTL_MS = 12 * 60 * 60 * 1000
const HISTORY_KEEP = 1300 // ~5 years of trading days

function readHistoryCache() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || {}
  } catch {
    return {}
  }
}

// Spark entry -> ascending { t: epochMs[], c: close[] }, gaps dropped. The
// closes sit either directly on the entry or under indicators.quote[0],
// depending on which response shape the proxy returns.
function seriesFrom(entry) {
  const stamps = entry?.timestamp
  const closes = Array.isArray(entry?.close) ? entry.close : entry?.indicators?.quote?.[0]?.close
  if (!Array.isArray(stamps) || !Array.isArray(closes)) return null
  const t = []
  const c = []
  for (let i = 0; i < stamps.length; i++) {
    const px = Number(closes[i])
    if (!Number.isFinite(px) || px <= 0 || !Number.isFinite(stamps[i])) continue
    t.push(stamps[i] * 1000)
    c.push(px)
  }
  return t.length ? { t: t.slice(-HISTORY_KEEP), c: c.slice(-HISTORY_KEEP) } : null
}

async function fetchHistoryChunk(ySymbols) {
  const url = `${SPARK}?symbols=${ySymbols.join(',')}&range=5y&interval=1d`
  const res = await fetch(proxied(url))
  if (!res.ok) throw new Error(`History fetch failed (${res.status})`)
  const data = await res.json()
  const out = {}
  const results = data?.spark?.result
  if (Array.isArray(results)) {
    for (const r of results) out[r.symbol] = seriesFrom(r.response?.[0])
  } else {
    for (const sym of ySymbols) out[sym] = seriesFrom(data?.[sym])
  }
  return out
}

// Daily close history for the given symbols -> Map<symbol, { t, c }> (ascending).
// Same contract as fetchQuotes: cached, never throws, partial results are fine —
// anything unresolved is carried at cost by the goal chart.
export async function fetchPriceHistory(symbols, { force = false } = {}) {
  const result = new Map()
  if (!PRICE.proxy) return result

  const wanted = [...new Set(symbols.map(normalize).filter(Boolean))]
  const cache = readHistoryCache()
  const now = Date.now()

  const stale = []
  for (const sym of wanted) {
    const hit = cache[sym]
    if (!force && hit && now - hit.ts < HISTORY_TTL_MS && hit.series?.t?.length) {
      result.set(sym, hit.series)
    } else {
      stale.push(sym)
    }
  }

  for (const group of chunk(stale, CHUNK)) {
    const ySymbols = group.map(yahooSymbol)
    let series
    try {
      series = await fetchHistoryChunk(ySymbols)
    } catch {
      continue
    }
    group.forEach((sym, i) => {
      const s = series[ySymbols[i]]
      if (s) {
        result.set(sym, s)
        cache[sym] = { series: s, ts: now }
      }
    })
  }

  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(cache))
  } catch {
    // best-effort (quota) — the history simply refetches next load
  }
  return result
}

// Apply a price map to holdings (pure). Stock/ETF holdings with a resolved price
// and a qty get a live marketPrice + recomputed current/pnl/pnlPct; everything
// else (no price, no qty, or MFs) keeps the sheet's current with marketPrice null.
// Never mutates qty / avgPrice / invested.
export function enrichHoldings(holdings, priceMap) {
  if (!holdings) return holdings
  return holdings.map((h) => {
    const price = priceMap?.get?.(normalize(h.symbol))
    if ((h.type !== 'stock' && h.type !== 'etf') || price == null || h.qty == null) {
      // A derived holding with no ticker can never be priced — it silently sits
      // at cost forever. Say so, the same way navs.js does for unmatched funds:
      // the fix is one line in resources/name-symbols.json.
      if ((h.type === 'stock' || h.type === 'etf') && !h.symbol) {
        console.warn(`[quotes] no NSE symbol for "${h.name}" (${h.source}) — add it to resources/name-symbols.json; carried at cost`)
      }
      return { ...h, marketPrice: h.marketPrice ?? null }
    }
    const current = h.qty * price
    const pnl = h.invested != null ? current - h.invested : null
    return {
      ...h,
      marketPrice: price,
      current,
      pnl,
      pnlPct: pnl != null && h.invested ? (pnl / h.invested) * 100 : null,
    }
  })
}
