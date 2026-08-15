# Invest Monitor

Personal dashboard tracking INDmoney holdings & transactions (stocks, MFs, ETFs)
to verify/reconcile daily trades. User setup, deployment, and PWA details live
in README.md — keep it updated for user-facing changes.

## Stack
Vite + React 19 (JS, no TS) · plain CSS, dark theme (no Tailwind) · SheetJS ·
hand-rolled SVG/CSS charts · no backend except a Cloudflare Worker (`proxy/`)
that CORS-proxies Yahoo Finance.

## Data pipeline
Native Google Sheets in a public Drive folder (copy-pastes of broker pages:
2 INDmoney transaction sheets + Groww/Axis/Coin holdings & transaction sheets),
fetched via Drive API v3 + API key using the **export** endpoint (`drive.js`);
`FileDropzone` is a local drag-drop fallback into the same pipeline. Sheets are
auto-detected by **content/structure** in `classify.js` — each parser returns
`null` if its shape isn't present; never rely on filenames. The 2 INDmoney
sheets that need manual upkeep:

1. **Stocks Transactions**: `Date | Stock Name | Quantity | Order Type |
   Requested Price`. `Order Type` carries the side ("Buy"/"Sell": contains
   "sell" ⇒ SELL, else BUY). Symbol via the `indmoney` name map. **Must be
   complete history** — INDmoney stock/ETF holdings are derived from it.
2. **MF Transactions**: `Order Date | Scheme Name | Amount | Units | NAV`.
   Compact amounts; all rows stamped `side:'BUY'` (no side column yet); amount
   from sheet, fallback units×nav; NAV may be blank (legacy lump-sum rows —
   pre-history ELSS purchases live here as ordinary rows). → `mfTransactions`
   (feeds Monthly + Transactions tabs and MF holdings derivation). **Must be
   complete history.**

**INDmoney holdings are DERIVED from these transactions** (`src/lib/derive.js`,
applied in Dashboard's view memo): the manual "My Stocks" / "My MFs" holdings
sheets are retired. Their parsers remain; if the sheets still exist in Drive,
derived rows replace them (`withDerivedHoldings` filters sources `My Stocks` /
`My MFs`). Derivation folds the synthetic SIP legs in (units from NAV history
via `enrichMfTransactions`); SELLs release cost at the running average. Verified
2026-07-05: derived == sheets exactly (stocks to the rupee, MFs to <0.5%).
Consequence: the Reconcile panel is trivially "match" for INDmoney.

Gotchas: export XLSX is parsed with `cellDates:true`, so date columns arrive as
JS `Date` — `parseNumericDmy` accepts a `Date` or a `DD-MM-YYYY` string. An
optional leading `Prompt:` row is skipped by header detection. The old `.xlsx`
parsers remain as harmless fallbacks. `resources/others/` is intentionally
ignored. JSON imports use `with { type: 'json' }` so `src/lib` stays importable
from Node scripts (build-mf-schemes) as well as Vite.

## Classification & platforms
- No ISIN anywhere. Stock vs ETF by name/symbol keywords (`classifyEquity` in
  classify.js): `etf, nasdaq, nifty, bees, sensex, next50, setf, mon100, n100,
  beta` ⇒ ETF, else stock.
- 6 `source` strings map to 4 broker platforms (`SOURCE_PLATFORM`/`PLATFORMS`
  in `config.js`): INDmoney, Groww, Axis, Coin. Rows are tinted per source via
  `src/lib/sourceStyle.js` (`rowClassName`/`rowStyle` props); `SourceLegend`
  chips double as a single-source filter in `AssetTab`.

## Live prices & NAVs
The sheet supplies only qty/avgPrice/invested; current/marketPrice/P&L are
recomputed live. **Never fabricate values.**
- Stocks/ETFs: Yahoo spark `<SYMBOL>.NS` via the `VITE_PRICE_PROXY` Worker
  (Yahoo has no CORS). `src/lib/quotes.js`: `fetchQuotes` (batched, 10-min
  localStorage TTL, never throws) + `enrichHoldings` (pure). Name→NSE-ticker
  maps live in committed `resources/name-symbols.json` (`{indmoney, groww}`,
  hand-maintained — add a line when a new descriptively-named scrip appears in
  the transactions; keys must cover the **transaction-sheet names**, since
  derived holdings get their symbol from the transactions); resolvers
  `indStocksSymbol`/`growwSymbol` in `classify.js`. `loadPrices` collects
  symbols from holdings **and** transactions.
- MFs: mfapi.in called **directly** (it has CORS; AMFI doesn't). Fund → AMFI
  scheme code is matched OFFLINE by `scripts/build-mf-schemes.mjs` → committed
  `resources/mf-schemes.json`; the app only reads the map and `console.warn`s
  unmatched funds — re-run the generator when a new fund appears.
  `src/lib/navs.js`: `mfKey`, `fetchNavs` (~12h TTL), `enrichMfHoldings`,
  `enrichMfTransactions` (fills missing units/nav/amount on txns from NAV
  history — this is what gives SIP legs their units). Units priority in
  `enrichMfHoldings`: qty → invested/avgPrice → snapshot-scale via `asOf`;
  derived holdings always carry qty, so the fallbacks are dormant. Note the
  legacy ICICI ELSS is the **Regular** plan (generator `OVERRIDES`) although
  everything else on INDmoney is Direct.
- `Dashboard` fetches both on load/cache-boot and on **Refresh prices** (⋮
  menu); the `view` memo composes `withRecurringSips` → `enrichMfTransactions`
  → `withDerivedHoldings` → `enrichHoldings` → `enrichMfHoldings`, so
  `portfolio.js` needs no change.

## Key rules
- Holdings and orders name the same scrip differently (no ISIN) —
  `reconcile.js` joins on a fuzzy first-two-significant-tokens `nameKey`
  (`mfKey` in navs.js is the more discriminating MF variant).
- **Goal tracker** (`goal.js` → `GoalTracker`, first card on Consolidated, own
  section on the mobile Consolidated rail). The goal is on the **total corpus**
  (market value incl. profits), valued day by day as `units held × price that
  day` — MF NAV history from `navMap`, stock/ETF daily closes from
  `fetchPriceHistory` (quotes.js, spark `range=5y&interval=1d`, own 12h
  localStorage cache). The **invested** (cost) series runs alongside using
  derive.js's running-average sell accounting. Both endpoints are level-matched
  per source to the Total Portfolio card's Current / Invested via a **constant
  baseline offset** (Axis/Coin have no txn sheets; positions with no price
  history are carried at cost) — level matches, month deltas stay real. Samples
  are all txn dates + month starts, daily for 6 months back then weekly. The
  corpus line is **null before every held position is priceable** (`valueFrom`) —
  never extrapolate across a history gap. `projectToGoal` compounds monthly:
  `v = v*(1+r) + monthly`, with the monthly amount (seeded from `avg6`) and the
  return (8/10/12%) chosen in the UI (behind the ETA band's summary chip, not
  always-on); chart horizon capped at 144 months.
- **This-month detail** (`goalProgress().detail` → `ReturnSheet`). The pulse
  tiles under the progress bar are tappable: the two money tiles deep-link to
  the **Monthly tab** at that month (`onOpenMonth` — Dashboard → Consolidated →
  GoalTracker; MonthlyTab seeds `selectedMonth` from `focusMonth` and unmounts
  on every tab switch, so seeding is enough), and "Markets gave" opens
  ReturnSheet — the month as a waterfall (corpus on the 1st + added + market =
  today), split by asset class and by position. Per-position levels come off the
  timeline only, so the constant baseline offset is reported separately as
  `detail.untracked`; it never moves, so class markets sum to `growth.market`
  exactly. `detail` is null unless the corpus line already existed at the
  opening sample (`openIdx >= valueFrom`).
  Holdings from `baselineSources` (Axis/Coin — no txn sheet) would therefore
  never move: `estimateMonthMovers` prices them **for the current month only**,
  units assumed unchanged, level-scaled off the holding's live `current`
  (`open = current × nav_1st/nav_now`). They join `detail.movers` tagged
  `estimated:true` and are **excluded** from `market`/`classes` (which must keep
  tying to the corpus series) — the sheet states the combined figure in words.
  A baseline holding with no NAV/price match lands in `detail.unpriced` and the
  sheet names it, so an unmapped fund is visible instead of silently missing.
- Hardcoded ₹10k/month Edelweiss Mid Cap SIP injected via `RECURRING_SIPS` in
  `monthly.js` — it's absent from the MF sheet; a same-day guard prevents
  double counting. The SIP **must have an explicit `start`** (`'2025-05'`,
  verified against the last holdings snapshot): the txn sheet reaches back to
  a 2015 lump-sum row, so an earliest-txn fallback would fabricate a decade of
  legs. Injection happens once, in Dashboard's view memo (MonthlyTab no longer
  calls it); legs flow into Monthly, Transactions, and holdings derivation.

## Layout
- `src/config.js` — Drive/proxy env config, asset-type labels & colors,
  platform map, `CORPUS_GOAL` (₹5 Cr goal target)
- `src/lib/` — drive, parse, classify, derive (txns → INDmoney holdings), goal
  (corpus-vs-goal series), quotes, navs, portfolio, reconcile, monthly, whatif
  (per-category buy simulation), sourceStyle, format
- `src/components/` — Dashboard (loads data, owns tabs), AppBar, SummaryCard,
  AllocationDonut, HoldingsTable (generic sortable; optional `className` for a
  scrollable variant), AssetTab (optional `foldTo`/`rankOf` props — the MF tab
  passes `foldTo={5}` + a last-buy-recency rank from Dashboard's `mfLastBuy`
  map, so 5 recently-bought funds show up front and "See all" expands to a
  scrollable table with sticky header), ConsolidatedTab, GoalTracker (goal card
  + journey/pace SVG charts + pulse tiles with their own micro-charts; card
  chrome is dropped at ≤640px so the charts span the device), ReturnSheet
  (this-month return breakdown; portalled to `<body>` — the `.card`
  backdrop-filter would otherwise contain `position:fixed`),
  TransactionsTab, ReconcilePanel, StateViews, SourceLegend, FileDropzone,
  MfWhatIf (MF-tab buying-pattern analysis: per market-cap category, replays
  the INDmoney buys "all-in" each **candidate** fund of that category —
  gain-over-invested lines (raw value would hide the differences under the
  contribution staircase) + a NAV-trend view rebased to 100 with buy markers
  (the **default** view). Candidates = top `PICKS_PER_SOURCE` (2) funds of the
  category from **two brokers**: INDmoney (by amount transacted) and Coin (by
  the holdings snapshot's `invested`), deduped by AMFI scheme code — Coin has
  no txn sheet, so its funds are comparison-only, carry no buy markers, and
  never enter the "Your buys" line; a category with no priceable INDmoney buy
  has no cashflows and so no card. Broker is double-encoded — INDmoney solid,
  Coin dashed — and each broker owns a colour pair indexed by the fund's `slot`
  within it. "Your buys" is valued from **every** INDmoney fund of the
  category, not just the two charted (uncharted ones are named in the card
  subtitle). `histStart` comes from the INDmoney picks alone and a Coin
  candidate whose NAV history starts later is **skipped** rather than charted —
  otherwise one recently-launched fund truncates every line, or empties the
  category and deletes the card. Under the NAV trend sits `ReturnStrip`: a
  leaderboard of **every** MF of that category the user holds on **any** broker
  (`returnRows`, deduped by scheme code so one row can carry several broker
  dots; Direct/Regular are distinct codes ⇒ distinct rows), scored over
  `RETURN_WINDOWS` (1M/3M/6M/1Y/3Y, 3Y annualised so every column stays on one
  scale) with the winner of each column pilled in the **accent**, not green —
  green/red already mean gain/loss, so reusing them for "best" blurs both.
  Consistency across columns is the keep-or-switch signal the what-if chart
  can't give. Column headers are sort buttons (default 1Y desc; unrated funds
  sink in both directions). Cells carry no `%` or `+` — the unit is stated once
  in the caption and gain/loss is the colour; the minus on negatives stays,
  since a bare red number is indistinguishable in greyscale or CVD.
  ≤640px the name moves onto its own line above its numbers and **every** row
  gets a tinted block with a gap — zebra striping on a two-line row floats
  alternate funds apart instead of binding each name to its own figures.
  `periodReturn`
  returns null unless the trimmed history actually reaches back (navOn would
  otherwise clamp to the oldest entry and report a short window as a full one).
  Regular-plan funds carry a "Reg" tag in the strip and "(Reg)" in chart labels
  — their NAV grows ~1%/yr slower on commission alone, so an untagged
  comparison is unfair. Hand-rolled SVG with crosshair/tooltip; one time-range
  control (1M/3M/6M/1Y/All, default 6M) above the cards scopes every chart —
  NAV series re-rebase to the window start; the whatif.js sample grid is
  denser near today (daily ≤30d, 3-day ≤90d, else weekly) so short windows
  stay smooth, and x-ticks are picked evenly in time then snapped to samples;
  series colours CVD-validated for the navy surface; txns older than any
  charted fund's trimmed NAV history are excluded per category)
- `proxy/` — Yahoo CORS Worker · `scripts/` — build-mf-schemes.mjs, stamp-sw.mjs
- `resources/` — gitignored personal exports, EXCEPT `mf-schemes.json` and
  `name-symbols.json` (explicitly un-ignored; imported at build time)

## Normalized shapes
- holding: `{ name, isin, symbol|null, type:'stock'|'etf'|'mf', qty, avgPrice,
  invested, current|null, pnl|null, pnlPct|null, marketPrice|null, folio|null,
  source, asOf|null }` (`symbol` drives price lookup; `mfKey(name)` drives NAV
  lookup; `asOf` = Drive file's `modifiedTime`)
- transaction: `{ date:Date, name, symbol, isin, side:'BUY'|'SELL', qty, price,
  status }`

## Commands
- `npm run dev` / `npm run build` / `npm run lint`
- `npm run deploy` — build + deploy the SPA (root `wrangler.jsonc`)
- `cd proxy && npx wrangler deploy` — deploy the price-proxy Worker
- `node scripts/build-mf-schemes.mjs` — regenerate the MF scheme-code map

## Build/deploy gotchas
- `VITE_*` vars are baked into the bundle at build time from the local `.env`
  (`VITE_GDRIVE_FOLDER_ID`, `VITE_GDRIVE_API_KEY`, `VITE_PRICE_PROXY` — blank
  proxy ⇒ flaky public fallback, empty ⇒ live prices disabled).
- `npm run build` runs `scripts/stamp-sw.mjs`, which replaces the
  `__BUILD_VERSION__` placeholder in `dist/sw.js` — this drives PWA
  auto-update; don't rename the placeholder or the SW cache name scheme.
