// One-time (re-runnable) generator for resources/mf-schemes.json — the committed
// map from each mutual-fund name to its AMFI scheme code. Our sheets carry no
// ISIN/scheme code, so we resolve them ONCE here (offline) and the app just reads
// the map at runtime (never hits the search endpoint).
//
// It harvests the actual fund names from the configured Google Drive folder
// (reusing the app's real parsers), then matches each via mfapi.in's search,
// preferring the right plan (Direct/Regular) and Growth option.
//
//   node scripts/build-mf-schemes.mjs
//
// Re-run when a new fund appears (the app logs any unmatched fund to the console).
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parseWorkbook } from '../src/lib/parse.js'
import { buildDataset } from '../src/lib/classify.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'resources/mf-schemes.json')
const DRIVE_API = 'https://www.googleapis.com/drive/v3'
const GSHEET_MIME = 'application/vnd.google-apps.spreadsheet'
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const MFAPI_SEARCH = 'https://api.mfapi.in/mf/search'

// Bank distributors sell Regular plans; everyone else here is Direct.
const SOURCE_PLAN = {
  'My MFs': 'Direct',
  'My MF Coin': 'Direct',
  'MF Groww': 'Direct',
  'Axis Bank MF': 'Regular',
}

// Manual overrides (keyed by mfKey) for funds where mfapi's search doesn't return
// the right plan/variant in its result set (legacy ICICI schemes mostly), so the
// auto-matcher can't reach it. Verified by hand against /mf/<code>/latest. These
// survive re-runs. Add an entry here rather than editing mf-schemes.json directly.
const OVERRIDES = {
  'icici pru multi asset': { schemeCode: 101144, plan: 'Regular' },
  'icici prudential value': { schemeCode: 120323, plan: 'Direct' },
  'icici prudential medium term bond': { schemeCode: 120670, plan: 'Direct' },
  'icici prudential corporate bond': { schemeCode: 120692, plan: 'Direct' },
  // Legacy 2015 lump-sum holding — Regular plan, unlike everything else on
  // INDmoney (sheet current ₹8.32L / 899.243 units ⇒ NAV ~925 = Regular; the
  // Direct NAV would imply ~₹9.4L).
  'icici prudential elss tax saver': { schemeCode: 100354, plan: 'Regular' },
}

// MUST stay identical to mfKey() in src/lib/navs.js.
const MF_STOP = new Set([
  'direct', 'regular', 'growth', 'idcw', 'dividend', 'plan', 'option',
  'reinvestment', 'reinvest', 'payout', 'fund', 'scheme', 'the', 'of',
])
const mfKey = (name) =>
  String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !MF_STOP.has(t))
    .join(' ')
    .trim()

// Canonical form used only for MATCHING (not for the map key): expand common
// abbreviations and glue compound cap-types so "Mid Cap" == "Midcap", so the
// right fund isn't lost to a "Large & Mid Cap" superset.
const ABBREV = { pru: 'prudential', prud: 'prudential', oswal: 'oswal' }
const canon = (name) =>
  String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(mid|small|large|multi|flexi|micro)\s+cap\b/g, '$1cap')
    .split(/\s+/)
    .map((t) => ABBREV[t] || t)
    .filter((t) => t && !MF_STOP.has(t))

const tokens = (name) => new Set(canon(name))

// Query keeps cap-types SPACED (mfapi stores "Small Cap", not "Smallcap"), only
// expanding abbreviations and dropping plan/option noise — for good recall.
const cleanQuery = (name) =>
  String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .map((t) => ABBREV[t] || t)
    .filter((t) => t && !MF_STOP.has(t))
    .join(' ')

const isIndex = (s) => /\b(index|nifty|sensex|bees|etf)\b/i.test(s)
// Closed-end / legacy / non-Growth-Regular-Direct variants we never want.
const NOISE = /institutional|bonus|retail|super premium|weekly|daily|monthly|fort ?nightly|quarterly|annual|half yearly| series |plan [b-z]\b/i

function readEnv() {
  const env = {}
  try {
    for (const line of readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m) env[m[1]] = m[2]
    }
  } catch {
    // no .env
  }
  return env
}

async function harvestNames() {
  const env = readEnv()
  const folderId = env.VITE_GDRIVE_FOLDER_ID
  const apiKey = env.VITE_GDRIVE_API_KEY
  if (!folderId || !apiKey) {
    throw new Error('Set VITE_GDRIVE_FOLDER_ID and VITE_GDRIVE_API_KEY in .env first.')
  }
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`)
  const listUrl = `${DRIVE_API}/files?q=${q}&key=${apiKey}&fields=files(id,name,modifiedTime,mimeType)&pageSize=100`
  const files = (await (await fetch(listUrl)).json()).files || []

  const parsed = []
  for (const f of files) {
    if (f.mimeType !== GSHEET_MIME) continue
    const url = `${DRIVE_API}/files/${f.id}/export?mimeType=${encodeURIComponent(XLSX_MIME)}&key=${apiKey}`
    const res = await fetch(url)
    if (!res.ok) continue
    parsed.push(parseWorkbook(await res.arrayBuffer(), f.name, f.modifiedTime))
  }
  const { holdings, mfTransactions } = buildDataset(parsed)
  // Unique MF names by mfKey, keeping the first name + its source. Harvest from
  // holdings AND MF transactions — the INDmoney holdings sheet is gone (holdings
  // are derived from transactions now), so transactions are the only place its
  // fund names appear.
  const byKey = new Map()
  for (const h of holdings) {
    if (h.type !== 'mf') continue
    const k = mfKey(h.name)
    if (k && !byKey.has(k)) byKey.set(k, { name: h.name, source: h.source })
  }
  for (const t of mfTransactions) {
    const k = mfKey(t.name)
    if (k && !byKey.has(k)) byKey.set(k, { name: t.name, source: t.source })
  }
  return [...byKey.values()]
}

// Score an mfapi candidate against the wanted fund; higher is better, -1 reject.
function score(want, plan, cand) {
  const cn = cand.schemeName
  const wantIdcw = /idcw|dividend/i.test(want)
  const candIdcw = /idcw|dividend|payout|reinvest/i.test(cn)
  if (candIdcw !== wantIdcw) return -1 // never cross Growth <-> IDCW
  if (isIndex(cn) !== isIndex(want)) return -1 // never cross active <-> index
  if (NOISE.test(` ${cn} `)) return -1

  const wt = tokens(want)
  const ct = tokens(cn)
  let overlap = 0
  for (const t of wt) if (ct.has(t)) overlap += 1
  const coverage = wt.size ? overlap / wt.size : 0
  if (coverage < 0.6) return -1 // too weak a name match

  let s = overlap * 10 - (ct.size - overlap) // reward overlap, penalize extra tokens
  if (new RegExp(`\\b${plan}\\b`, 'i').test(cn)) s += 100 // strong plan preference
  if (!wantIdcw && /growth/i.test(cn)) s += 3 // mild Growth preference
  return s
}

async function resolve1(name, source) {
  const plan = SOURCE_PLAN[source] || 'Direct'
  // Query both spellings ("Mid Cap" and "Midcap") since AMFI/mfapi substring
  // search is spelling-sensitive; merge + dedupe results before scoring.
  const spaced = cleanQuery(name)
  const glued = canon(name).join(' ')
  const queries = [...new Set([spaced, glued])]
  const byCode = new Map()
  for (const q of queries) {
    const res = await fetch(`${MFAPI_SEARCH}?q=${encodeURIComponent(q)}`)
    if (!res.ok) continue
    for (const c of await res.json()) byCode.set(c.schemeCode, c)
  }
  const candidates = [...byCode.values()]
  let best = null
  let bestScore = -1
  for (const c of candidates) {
    const sc = score(name, plan, c)
    if (sc > bestScore) {
      bestScore = sc
      best = c
    }
  }
  if (!best) return null
  return { schemeCode: best.schemeCode, schemeName: best.schemeName, plan }
}

async function main() {
  const funds = await harvestNames()
  console.log(`Harvested ${funds.length} unique MF holdings from Drive.\n`)
  const map = {}
  const unmatched = []
  for (const { name, source } of funds) {
    const key = mfKey(name)
    let hit
    if (OVERRIDES[key]) {
      const o = OVERRIDES[key]
      const meta = await fetch(`https://api.mfapi.in/mf/${o.schemeCode}/latest`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
      hit = { schemeCode: o.schemeCode, schemeName: meta?.meta?.scheme_name || '(override)', plan: o.plan }
    } else {
      hit = await resolve1(name, source)
    }
    if (hit) {
      map[mfKey(name)] = hit
      console.log(`  ✓ ${name}  [${source}]\n      -> ${hit.schemeCode}  ${hit.schemeName}`)
    } else {
      unmatched.push(`${name}  [${source}]`)
      console.log(`  ✗ ${name}  [${source}]  — NO MATCH`)
    }
  }
  // Sort keys for a stable, reviewable diff.
  const sorted = Object.fromEntries(Object.keys(map).sort().map((k) => [k, map[k]]))
  writeFileSync(OUT, JSON.stringify(sorted, null, 2) + '\n')
  console.log(`\nWrote ${Object.keys(sorted).length} schemes to ${OUT}`)
  if (unmatched.length) {
    console.log(`\n${unmatched.length} unmatched (add by hand to ${OUT}):`)
    unmatched.forEach((u) => console.log('  - ' + u))
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
