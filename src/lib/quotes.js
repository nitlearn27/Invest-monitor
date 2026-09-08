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
export const PRICE_TTL_MS = 10 * 60 * 1000 // reuse a price for 10 min before refetching
const TTL_MS = PRICE_TTL_MS
const CACHE_KEY = 'invest-monitor:prices:v2'

// INDmoney symbol -> full Yahoo symbol, for names that don't map to "<SYM>.NS"
// (e.g. BSE-only scrips needing ".BO"). Populate as mismatches surface. Keys are
// upper-cased INDmoney symbols.
const SYMBOL_OVERRIDES = {}

const normalize = (s) => String(s || '').trim().toUpperCase()
const yahooSymbol = (sym) => SYMBOL_OVERRIDES[sym] || `${sym}${SUFFIX}`
const proxied = (url) => `${PRICE.proxy}${encodeURIComponent(url)}`

// --- localStorage price cache: { [symbol]: { price, prev, ts } } -------------
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

// Latest price + the previous session's close from a Yahoo spark entry, as
// { price, prev }. The two response shapes nest things differently: the flat one
// carries `close` and `chartPreviousClose` on the entry itself, the wrapped one
// splits them into `meta` and `indicators.quote[0].close`.
//
// `prev` is what makes a 1-day move computable. It is deliberately NULLED when
// the entry has no intraday close and we fall back to the previous close as the
// price — reporting a 0.00% move there would be a fabricated figure, not a flat
// day.
function quoteFrom(node) {
  if (!node) return { price: null, prev: null }
  const meta = node.meta || node
  const raw = Array.isArray(node.close) ? node.close : node.indicators?.quote?.[0]?.close
  const closes = Array.isArray(raw) ? raw.filter((v) => Number.isFinite(v) && v > 0) : []
  const last = closes.length ? closes[closes.length - 1] : null
  const prevRaw = Number(meta.chartPreviousClose ?? meta.previousClose)
  const prev = Number.isFinite(prevRaw) && prevRaw > 0 ? prevRaw : null
  if (last != null) return { price: last, prev }
  return { price: prev, prev: null }
}

// Fetch one chunk -> { yahooSymbol: { price, prev } }. The spark response is
// keyed by symbol directly, or nested under { spark: { result: [...] } }
// depending on the endpoint/proxy; handle both.
async function fetchChunk(ySymbols) {
  const url = `${SPARK}?symbols=${ySymbols.join(',')}&range=1d&interval=1d`
  const res = await fetch(proxied(url))
  if (!res.ok) throw new Error(`Quote fetch failed (${res.status})`)
  const data = await res.json()
  const out = {}
  const results = data?.spark?.result
  if (Array.isArray(results)) {
    for (const r of results) out[r.symbol] = quoteFrom(r.response?.[0])
  } else {
    for (const sym of ySymbols) out[sym] = quoteFrom(data?.[sym])
  }
  return out
}

// Fetch live prices for the given symbols. Returns a
// Map<symbol, { price, prev, ts }> (INR; `prev` = previous session's close, null
// when unknown; `ts` = when that quote was pulled — a cache hit keeps its
// original time, so a page reload can't pass stale prices off as just-fetched). Symbols with a fresh cache entry skip the network. `force` bypasses
// the TTL (manual Refresh button). Never throws — partial results on error.
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
      result.set(sym, { price: hit.price, prev: hit.prev ?? null, ts: hit.ts })
    } else {
      stale.push(sym)
    }
  }

  for (const group of chunk(stale, CHUNK)) {
    const ySymbols = group.map(yahooSymbol)
    let quotes
    try {
      quotes = await fetchChunk(ySymbols)
    } catch {
      continue // leave these unresolved; caller falls back to the sheet value
    }
    group.forEach((sym, i) => {
      const q = quotes[ySymbols[i]]
      if (q?.price != null) {
        result.set(sym, { ...q, ts: now })
        cache[sym] = { price: q.price, prev: q.prev, ts: now }
      }
    })
  }

  writeCache(cache)
  return result
}

// When the prices in a quote map were last pulled — the OLDEST entry, since a
// part-cached refresh is only as current as its stalest quote. null if empty.
export function quotesSyncedAt(priceMap) {
  let oldest = null
  for (const q of priceMap?.values?.() || []) {
    if (q?.ts != null && (oldest == null || q.ts < oldest)) oldest = q.ts
  }
  return oldest == null ? null : new Date(oldest)
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

// Close on (or before) a calendar date, from an ascending { t, c } history.
// Yahoo stamps each candle at the session's opening instant in UTC while our
// transaction dates are IST midnight, so the compare is against the END of the
// target day — the same calendar-date reasoning navOn spells out for NAVs.
// Returns null BEFORE the history starts: unlike navOn (which clamps to the
// oldest NAV so a snapshot can still be scaled), every equity caller here is
// drawing a line, and clamping would draw a flat run that never happened.
export function priceOn(series, date) {
  const t = series?.t
  const c = series?.c
  if (!t?.length) return null
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return c[c.length - 1]
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
  let lo = 0
  let hi = t.length - 1
  let at = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (t[mid] < end) {
      at = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return at >= 0 ? c[at] : null
}

// Apply a price map to holdings (pure). Stock/ETF holdings with a resolved price
// and a qty get a live marketPrice + recomputed current/pnl/pnlPct + today's
// move; everything else (no price, no qty, or MFs) keeps the sheet's current
// with marketPrice null. Never mutates qty / avgPrice / invested.
export function enrichHoldings(holdings, priceMap) {
  if (!holdings) return holdings
  return holdings.map((h) => {
    const quote = priceMap?.get?.(normalize(h.symbol))
    const price = quote?.price
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
    // Today's move against the previous session's close — the stock/ETF twin of
    // the NAV-vs-previous-NAV figure enrichMfHoldings computes for funds, so
    // every asset tab can lead with the same "1D P&L" column.
    const prev = quote.prev
    return {
      ...h,
      marketPrice: price,
      current,
      pnl,
      pnlPct: pnl != null && h.invested ? (pnl / h.invested) * 100 : null,
      oneDayChange: prev ? (price - prev) * h.qty : null,
      oneDayChangePct: prev ? ((price - prev) / prev) * 100 : null,
    }
  })
}
