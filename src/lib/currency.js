export const USD_INR_SYMBOL = 'USDINR=X'
const FX_URL = 'https://open.er-api.com/v6/latest/USD'
const FX_CACHE_KEY = 'invest-monitor:usd-inr:v1'

// The open endpoint publishes a new USD table once per day and permits browser
// requests. Prefer its published timestamp to a local fetch timestamp.
export async function fetchUsdInr({ force = false } = {}) {
  let cached = null
  try { cached = JSON.parse(localStorage.getItem(FX_CACHE_KEY)) } catch { /* no cache */ }
  const now = Date.now()
  if (!force && cached?.rate > 0 && cached.nextUpdate > now) return cached
  try {
    const res = await fetch(FX_URL)
    if (!res.ok) throw new Error(`USD/INR fetch failed (${res.status})`)
    const data = await res.json()
    const rate = Number(data?.rates?.INR)
    if (data?.result !== 'success' || !(rate > 0)) throw new Error('USD/INR response missing INR rate')
    const quote = {
      rate,
      asOf: Number(data.time_last_update_unix) * 1000 || now,
      nextUpdate: Number(data.time_next_update_unix) * 1000 || now + 60 * 60 * 1000,
    }
    try { localStorage.setItem(FX_CACHE_KEY, JSON.stringify(quote)) } catch { /* best effort */ }
    return quote
  } catch {
    return cached?.rate > 0 ? cached : null
  }
}

// Keep source transactions in USD and revalue them whenever the latest FX
// quote changes. The portfolio's invested cost is therefore an INR translation
// of the USD cost basis at today's rate.
export function convertUsTransactions(transactions = [], usdInr = null) {
  return transactions.map((t) => t.type === 'us_stock'
    ? { ...t, price: usdInr > 0 ? t.priceUsd * usdInr : null }
    : t)
}
