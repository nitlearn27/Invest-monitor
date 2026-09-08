// Formatting helpers (INR, numbers, percentages, dates).

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

const inrPaise = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
})

const num = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })

export function formatINR(value, { paise = false } = {}) {
  if (value == null || Number.isNaN(value)) return '—'
  return paise ? inrPaise.format(value) : inr.format(value)
}

export function formatNumber(value) {
  if (value == null || Number.isNaN(value)) return '—'
  return num.format(value)
}

export function formatPct(value) {
  if (value == null || Number.isNaN(value)) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

// Compact INR for KPI cards (e.g. ₹25.6L, ₹1.2Cr).
export function formatINRCompact(value) {
  if (value == null || Number.isNaN(value)) return '—'
  const abs = Math.abs(value)
  if (abs >= 1e7) return `₹${(value / 1e7).toFixed(2)}Cr`
  if (abs >= 1e5) return `₹${(value / 1e5).toFixed(2)}L`
  if (abs >= 1e3) return `₹${(value / 1e3).toFixed(1)}K`
  return inr.format(value)
}

export function formatDate(value) {
  if (!value) return '—'
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function formatDateTime(value) {
  if (!value) return '—'
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Day + month only ("25 Aug") — for chips where the year is noise and the full
// date is a tooltip away.
export function formatDayMonth(value) {
  if (!value) return '—'
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

// How long ago a timestamp was: "just now" / "6 min ago" / "3 hr ago" /
// "yesterday" / "4 days ago". Floors every step, so a value never reads as the
// next unit up ("24 hr ago").
export function formatAgo(value, now = Date.now()) {
  if (!value) return '—'
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  const secs = Math.max(0, Math.floor((now - d.getTime()) / 1000))
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hr ago`
  const days = Math.floor(hrs / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}
