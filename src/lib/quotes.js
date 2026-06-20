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

// Apply a price map to holdings (pure). Stock/ETF holdings with a resolved price
// and a qty get a live marketPrice + recomputed current/pnl/pnlPct; everything
// else (no price, no qty, or MFs) keeps the sheet's current with marketPrice null.
// Never mutates qty / avgPrice / invested.
export function enrichHoldings(holdings, priceMap) {
  if (!holdings) return holdings
  return holdings.map((h) => {
    const price = priceMap?.get?.(normalize(h.symbol))
    if ((h.type !== 'stock' && h.type !== 'etf') || price == null || h.qty == null) {
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
