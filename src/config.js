// App configuration. Drive credentials come from Vite env vars (see .env.example).
export const DRIVE = {
  folderId: import.meta.env.VITE_GDRIVE_FOLDER_ID || '',
  apiKey: import.meta.env.VITE_GDRIVE_API_KEY || '',
}

export const driveConfigured = () => Boolean(DRIVE.folderId && DRIVE.apiKey)

// Live market prices come from Yahoo Finance (NSE, INR), reached through a public
// CORS proxy since Yahoo sends no CORS headers. Override the proxy with
// VITE_PRICE_PROXY (e.g. a self-hosted one) if the default becomes unreliable.
// When the proxy is blank, the app falls back to the sheet's "Current value".
export const PRICE = {
  proxy: import.meta.env.VITE_PRICE_PROXY || 'https://api.allorigins.win/raw?url=',
}

export const pricesConfigured = () => Boolean(PRICE.proxy)

// Asset class labels + display order used across the UI.
export const ASSET_TYPES = {
  stock: { key: 'stock', label: 'Stocks' },
  etf: { key: 'etf', label: 'ETFs' },
  mf: { key: 'mf', label: 'Mutual Funds' },
}

export const ASSET_COLORS = {
  stock: '#5b8cff',
  etf: '#22c7a9',
  mf: '#b07cff',
}

// Broker platforms a holding can originate from, with a distinct accent colour
// (dark-theme friendly) used to tag rows across the UI. Each Drive sheet's
// `source` string maps to one of these via SOURCE_PLATFORM below.
export const PLATFORMS = {
  indmoney: { key: 'indmoney', label: 'INDmoney', color: '#9b8cff' },
  groww: { key: 'groww', label: 'Groww', color: '#4f9cff' },
  axis: { key: 'axis', label: 'Axis', color: '#ef5a98' },
  coin: { key: 'coin', label: 'Coin', color: '#f5a524' },
}

export const SOURCE_PLATFORM = {
  'My Stocks': 'indmoney',
  'My MFs': 'indmoney',
  'Stocks Groww': 'groww',
  'MF Groww': 'groww',
  'Axis Bank MF': 'axis',
  'My MF Coin': 'coin',
}

// Resolve a holding's `source` to its platform descriptor (or null if unknown).
export const platformOf = (source) => PLATFORMS[SOURCE_PLATFORM[source]] || null

// Platform key for a holding's `source` (or null) — used for source filtering.
export const platformKeyOf = (source) => SOURCE_PLATFORM[source] || null
