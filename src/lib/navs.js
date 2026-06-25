// Live NAV for mutual-fund holdings.
//
// The sheet stays the source of truth for invested (and, once present, units),
// but the MF "Current value" / P&L is recomputed from a live NAV fetched here —
// the MF analogue of quotes.js for stocks/ETFs.
//
// Provider: mfapi.in (https://www.mfapi.in), a free, no-key JSON mirror of the
// official AMFI daily NAV file. It sends `access-control-allow-origin: *`, so the
// browser calls it directly — no CORS proxy needed (unlike Yahoo for stocks).
//
// There is no ISIN/scheme code in our sheets, so each fund is matched to an AMFI
// scheme code OFFLINE (once) by scripts/build-mf-schemes.mjs, which writes the
// committed map below. At runtime we only read that map — never search.
import SCHEME_MAP from '../../resources/mf-schemes.json'

const MFAPI = 'https://api.mfapi.in/mf'
const TTL_MS = 12 * 60 * 60 * 1000 // NAV is daily — refresh at most ~twice a day
const HISTORY_KEEP = 1000 // newest entries to retain (covers any sheet snapshot)
const CACHE_KEY = 'invest-monitor:navs:v1'

// Normalize an MF name to a stable lookup key. More discriminating than
// reconcile's nameKey (which keeps only the first two tokens) because MF names
// share AMC prefixes ("ICICI Prudential Bluechip" vs "… Technology"). Plan/option
// words are stripped so "<Fund> Direct Growth" and "<Fund>" map to the same key.
// IMPORTANT: scripts/build-mf-schemes.mjs duplicates this — keep them identical.
const MF_STOP = new Set([
  'direct', 'regular', 'growth', 'idcw', 'dividend', 'plan', 'option',
  'reinvestment', 'reinvest', 'payout', 'fund', 'scheme', 'the', 'of',
])
export function mfKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !MF_STOP.has(t))
    .join(' ')
    .trim()
}

// Scheme descriptor ({ schemeCode, schemeName, plan }) for a fund name, or null.
export function schemeFor(name) {
  return SCHEME_MAP[mfKey(name)] || null
}

// AMFI scheme codes needed to price a set of holdings or transactions (deduped).
export function schemeCodesFor(items, isTxn = false) {
  const codes = new Set()
  for (const h of items || []) {
    if (!isTxn && h.type !== 'mf') continue
    const s = schemeFor(h.name)
    if (s?.schemeCode != null) codes.add(s.schemeCode)
  }
  return [...codes]
}

// --- localStorage NAV cache: { [schemeCode]: { history, ts } } ---------------
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
    // best-effort (quota)
  }
}

// mfapi history -> [{ t: epochMs, nav }] newest-first, trimmed to HISTORY_KEEP.
function parseHistory(data) {
  const rows = Array.isArray(data?.data) ? data.data : []
  const out = []
  for (const r of rows) {
    const nav = Number(r.nav)
    const [dd, mm, yyyy] = String(r.date).split('-')
    const t = Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd))
    if (nav > 0 && Number.isFinite(t)) out.push({ t, nav })
  }
  out.sort((a, b) => b.t - a.t)
  return out.slice(0, HISTORY_KEEP)
}

// Fetch NAV history for the given AMFI scheme codes. Returns
// Map<schemeCode, { history, latest }> (INR). Fresh-cached codes skip the
// network; `force` bypasses the TTL (manual refresh). Never throws.
export async function fetchNavs(schemeCodes, { force = false } = {}) {
  const result = new Map()
  const wanted = [...new Set((schemeCodes || []).filter((c) => c != null))]
  if (wanted.length === 0) return result

  const cache = readCache()
  const now = Date.now()
  const stale = []
  for (const code of wanted) {
    const hit = cache[code]
    if (!force && hit && now - hit.ts < TTL_MS && hit.history?.length) {
      result.set(code, { history: hit.history, latest: hit.history[0].nav })
    } else {
      stale.push(code)
    }
  }

  await Promise.all(
    stale.map(async (code) => {
      try {
        const res = await fetch(`${MFAPI}/${code}`)
        if (!res.ok) return
        const history = parseHistory(await res.json())
        if (!history.length) return
        result.set(code, { history, latest: history[0].nav })
        cache[code] = { history, ts: now }
      } catch {
        // leave unresolved; caller falls back to the sheet value
      }
    }),
  )

  writeCache(cache)
  return result
}

// NAV on (or just before) a date, from newest-first history. No date -> latest
// (so the snapshot-scaling fallback becomes a no-op when asOf is unknown).
export function navOn(history, date) {
  if (!history?.length) return null
  if (!date) return history[0].nav
  const t = date instanceof Date ? date.getTime() : new Date(date).getTime()
  if (!Number.isFinite(t)) return history[0].nav
  for (const h of history) {
    if (h.t <= t) return h.nav
  }
  return history[history.length - 1].nav // older than all history
}

// Apply live NAVs to MF holdings (pure; mirrors enrichHoldings in quotes.js).
// Units are taken from the first available source, in priority order:
//   1. real units from the sheet (h.qty), when present  — exact, preferred
//   2. Coin avg NAV (units = invested / avgPrice)        — exact
//   3. implied from the sheet snapshot (current / NAV@asOf) — fallback for funds
//      with no units yet; equivalent to scaling Current by NAV growth since the
//      sheet was pasted.
// invested is never touched. Unmatched funds (and non-MF holdings) pass through;
// a fund with a NAV but no derivable units keeps its sheet Current and just
// exposes the live NAV as marketPrice.
export function enrichMfHoldings(holdings, navMap) {
  if (!holdings) return holdings
  return holdings.map((h) => {
    if (h.type !== 'mf') return h
    const scheme = schemeFor(h.name)
    if (!scheme) {
      console.warn(`[navs] no scheme code for MF "${h.name}" (key: "${mfKey(h.name)}") — using sheet value`)
      return { ...h, marketPrice: h.marketPrice ?? null }
    }
    const nav = navMap?.get?.(scheme.schemeCode)
    if (!nav || nav.latest == null) return { ...h, marketPrice: h.marketPrice ?? null }

    let units = h.qty
    if (units == null && h.avgPrice && h.invested != null) units = h.invested / h.avgPrice
    if (units == null && h.current != null) {
      const navAt = navOn(nav.history, h.asOf)
      if (navAt) units = h.current / navAt
    }
    if (units == null) return { ...h, marketPrice: nav.latest } // show NAV, keep sheet Current

    const current = units * nav.latest
    const pnl = h.invested != null ? current - h.invested : null
    return {
      ...h,
      marketPrice: nav.latest,
      current,
      pnl,
      pnlPct: pnl != null && h.invested ? (pnl / h.invested) * 100 : null,
    }
  })
}

// Apply historical NAVs to MF transactions to resolve missing amount/units.
export function enrichMfTransactions(mfTxns, navMap) {
  if (!mfTxns) return mfTxns
  return mfTxns.map((t) => {
    // If we already have everything, or don't have a date, skip.
    if (!t.date || (t.amount != null && t.units != null && t.nav != null)) return t

    const scheme = schemeFor(t.name)
    if (!scheme) return t

    const nav = navMap?.get?.(scheme.schemeCode)
    if (!nav || !nav.history?.length) return t

    const navAt = navOn(nav.history, t.date)
    if (navAt == null) return t

    const enriched = { ...t }
    if (enriched.nav == null) enriched.nav = navAt

    if (enriched.amount == null && enriched.units != null) {
      enriched.amount = Math.round(enriched.units * navAt)
    } else if (enriched.units == null && enriched.amount != null) {
      enriched.units = enriched.amount / navAt
    }

    return enriched
  })
}

