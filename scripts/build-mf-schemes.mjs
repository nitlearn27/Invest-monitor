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

// Fallback plan per source, used only when the fund's own name doesn't say.
// Bank distributors sell Regular plans. Groww defaults to REGULAR: its pages
// spell out "Direct" in the scheme name whenever the holding is Direct (verified
// across all 10 Groww funds against their 19-Jun-2026 NAVs), so a Groww name
// with no plan word is a Regular-plan holding bought before the user moved to
// direct plans. Getting this wrong is expensive and silent — a Regular fund
// priced at its Direct NAV read ~14% high on the ICICI Banking holding alone.
const SOURCE_PLAN = {
  'My MFs': 'Direct',
  'My MF Coin': 'Direct',
  'MF Groww': 'Regular',
  'Axis Bank MF': 'Regular',
}

// The name itself wins when it declares a plan — brokers write "… Direct
// Growth" / "… Regular growth" — otherwise fall back to the source default.
const planFor = (name, source) => {
  if (/\bdirect\b/i.test(name)) return 'Direct'
  if (/\bregular\b/i.test(name)) return 'Regular'
  return SOURCE_PLAN[source] || 'Direct'
}

// Manual overrides (keyed by mfKey) for funds where mfapi's search doesn't return
// the right plan/variant in its result set (legacy ICICI schemes mostly), so the
// auto-matcher can't reach it. Verified by hand against /mf/<code>/latest. These
// survive re-runs. Add an entry here rather than editing mf-schemes.json directly.
// The Groww block below was pinned on 2026-08-15 by dividing the 19-Jun-2026
// Groww snapshot's Current Value by its Units for all 10 funds: each implied NAV
// lands on that one date under exactly one plan, which settles the plan per fund.
// Cross-checked against MF Central for Kotak Flexicap (₹1,32,207.08, NAV 86.42) —
// exact to the paisa.
const OVERRIDES = {
  'icici pru multi asset': { schemeCode: 101144, plan: 'Regular' },
  'icici prudential value': { schemeCode: 120323, plan: 'Direct' },
  // Legacy 2015 lump-sum holding — Regular plan, unlike everything else on
  // INDmoney (sheet current ₹8.32L / 899.243 units ⇒ NAV ~925 = Regular; the
  // Direct NAV would imply ~₹9.4L). The Groww ELSS is Regular too, so the one
  // shared key serves both.
  'icici prudential elss tax saver': { schemeCode: 100354, plan: 'Regular' },
  // Groww Regular-plan holdings (pre-direct-plan era; Groww omits "Direct" from
  // the scheme name for these). Priced at their Direct NAV they read up to 14%
  // high.
  'icici prudential banking and financial services': { schemeCode: 109445, plan: 'Regular' },
  'icici prudential flexicap': { schemeCode: 148989, plan: 'Regular' },
  'kotak flexicap': { schemeCode: 112090, plan: 'Regular' },
  'sbi equity hybrid': { schemeCode: 102885, plan: 'Regular' },
  'icici prudential medium term bond': { schemeCode: 102741, plan: 'Regular' },
  'icici prudential corporate bond': { schemeCode: 111987, plan: 'Regular' },
  // Sold out of in Jul 2025, so it never shows in holdings — but the SELL rows
  // carry units and no amount, so the NAV still sets the released cost. Same
  // Groww Regular-plan era as the block above; without this the search returns
  // only the Direct code and the label disagreed with the scheme.
  'icici prudential balanced advantage': { schemeCode: 104685, plan: 'Regular' },
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
  //
  // Every (name, source) variant behind a key is kept alongside, purely so
  // `warnPlanClashes` can shout if two brokers hold the same fund in DIFFERENT
  // plans. The map has no source dimension, so one key cannot serve both, and
  // the loser would be silently mispriced by ~1%/yr of expense-ratio drift.
  const byKey = new Map()
  const seen = (k, name, source) => {
    if (!k) return
    if (!byKey.has(k)) byKey.set(k, { name, source, variants: [] })
    const e = byKey.get(k)
    if (!e.variants.some((v) => v.name === name && v.source === source)) e.variants.push({ name, source })
  }
  for (const h of holdings) {
    if (h.type === 'mf') seen(mfKey(h.name), h.name, h.source)
  }
  for (const t of mfTransactions) seen(mfKey(t.name), t.name, t.source)
  return [...byKey.entries()].map(([key, v]) => ({ key, ...v }))
}

// The same fund held in DIFFERENT plans on two brokers. The key is the name, so
// the entry needs a per-broker `bySource` block (built below) — this just names
// them up front so the split is visible in the log rather than inferred from it.
// Overridden keys are already settled by hand and stay quiet.
function warnPlanClashes(funds) {
  for (const f of funds) {
    if (OVERRIDES[f.key]) continue
    const plans = new Set(f.variants.map((v) => planFor(v.name, v.source)))
    if (plans.size < 2) continue
    console.warn(`  !! PLAN SPLIT on "${f.key}" — held in ${[...plans].join(' and ')}:`)
    for (const v of f.variants) console.warn(`       ${v.source.padEnd(14)} ${v.name}  => ${planFor(v.name, v.source)}`)
    console.warn('     Resolving per broker into bySource.\n')
  }
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
  const plan = planFor(name, source)
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
  warnPlanClashes(funds)
  const map = {}
  const unmatched = []
  for (const { key, name, source, variants } of funds) {
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
      // Same fund, different plans on different brokers: resolve each broker's
      // own variant into `bySource` so schemeFor(name, source) can pick. An
      // OVERRIDE means a human already settled the fund, so leave it alone.
      const plans = new Set(variants.map((v) => planFor(v.name, v.source)))
      if (plans.size > 1 && !OVERRIDES[key]) {
        const bySource = {}
        for (const v of variants) {
          const h = await resolve1(v.name, v.source)
          if (h) bySource[v.source] = h
        }
        if (Object.keys(bySource).length > 1) {
          hit = { ...hit, bySource }
          console.log(`  ↳ per-broker plans for "${key}":`)
          for (const [s, h] of Object.entries(bySource)) console.log(`      ${s.padEnd(14)} ${h.schemeCode}  ${h.schemeName}`)
        }
      }
      map[key] = hit
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
