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
`null` if its shape isn't present; never rely on filenames. The 3 sheets that
need manual upkeep:

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
3. **MF Groww Transactions**: `Date | Mutual Fund Name | Amount | Type | Units |
   Status` (or the older `Amount / Units` single column). Dates like `3 Jun '26`;
   blank/failed `Status` rows are skipped. Complete for the funds still being
   bought (Quant Small Cap, Invesco Midcap — verified 2026-08-15 against the
   retired paste: units within 0.1%). Funds the user **stopped adding to but
   still holds** predate Groww's transactions page and carry one
   **opening-balance row** each — `Type: Opening`, with the fund's units and
   invested amount — see below.
4. **Groww Stocks Transactions**: same shape as Stocks Transactions plus a
   `Status` column (only `Success` counts; blank/`Failed` are skipped — the
   sheet holds an older statusless paste above the good one and the blank-status
   rule is what discards it, so **don't relax it**). Verified 2026-08-15 against
   the retired `Stocks Groww` paste: all 4 ETFs reproduce to the rupee.

**Holdings are DERIVED from these transactions** (`src/lib/derive.js`, applied
in Dashboard's view memo) for **every** source in `DERIVED_EQUITY_SOURCES`
(`My Stocks`, `Stocks Groww`) and `DERIVED_MF_SOURCES` (`My MFs`, `MF Groww`):
all four holdings pastes are retired. Their parsers remain, and
`withDerivedHoldings` replaces a paste's row only for positions the transactions
actually cover — a position with no rows yet is **left on the paste rather than
dropped**, so a missing opening row can't silently delete lakhs. Equity keys on
**symbol** first (the paste and the orders page spell scrips differently —
"ICICI Prud Gold ETF" vs "ICICI Prudential Gold ETF" — only the ticker joins
them); MFs key on name. Derivation folds the synthetic SIP legs in (units from
NAV history via `enrichMfTransactions`); SELLs release cost at the running
average. Verified 2026-07-05 (INDmoney) and 2026-08-15 (Groww): derived ==
sheets (stocks/ETFs to the rupee, MFs to <0.5%). Consequence: the Reconcile
panel is trivially "match" for INDmoney and Groww.

**Opening-balance rows** (`opening: true`, set by `parseGrowwMfTransactions` on
`Type` = `Opening` and by `parseStockTransactions` on `Order Type` = `Opening`,
where Quantity is the shares held and Requested Price the average cost) give a
carried-in position its units without a real purchase date. Groww's `Status`
filter **exempts** them — they're hand-typed, and demanding a status word on an
invented row would silently drop the position. They are ordinary buys to
derive.js — that's the point — but they are not money moved, and their date is
arbitrary, so:
- `monthly.js` skips them in every contribution aggregate (`isContribution`),
- `goal.js` keeps them **off** the timeline (`buildAssets` skips them). They stay
  inside the constant per-source baseline offset — back-projecting today's units
  across years of NAV history would invent a journey; dating them all on one
  recent day would put a false step in both lines.
- because they're off the timeline they'd never move, so `estimateMonthMovers`
  prices them for the current month like an Axis/Coin holding. Its match is
  position-level (`holdingKey` vs the timeline keys) **only** for
  `DERIVED_SOURCES`, where holdings and transactions key alike; every other
  source stays whole-source, so a paste whose names drift from its transaction
  sheet is never counted twice.
- `TransactionsTab` labels them `OPENING`, not `BUY`.

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
  localStorage TTL, never throws) + `enrichHoldings` (pure). `fetchQuotes`
  returns `Map<symbol, { price, prev }>` — `prev` is the spark meta's
  `chartPreviousClose`, and it is what gives equities the **1D P&L** column the
  MF tab already had. `prev` is deliberately **null** when the entry carries no
  intraday close and the previous close stands in as the price: a 0.00% move
  there would be fabricated, not a flat day. `priceOn(series, date)` reads the
  daily-close history on a **calendar date** (same reasoning as `navOn`) but
  returns null before the history starts instead of clamping — every equity
  caller is drawing a line, and clamping would draw a flat run that never
  happened. Name→NSE-ticker maps live in committed `resources/name-symbols.json` (`{indmoney, groww}`,
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
  **Plan (Direct vs Regular) is the sharpest failure mode here** — the wrong plan
  is a *different scheme code*, and its NAV drifts by the whole expense-ratio gap
  (the Groww book read ₹1.12L high before this was fixed on 2026-08-15). Rules:
  - The fund's own name wins when it says `Direct`/`Regular`; otherwise the
    generator's `SOURCE_PLAN` default applies. **Groww defaults to `Regular`** —
    its pages spell out "Direct" whenever the holding is Direct, so a bare Groww
    name is a pre-direct-plan holding. 7 of the 10 Groww funds are Regular.
  - To settle a fund's plan from data: divide a broker snapshot's Current Value
    by its Units and find which candidate scheme has that NAV — the whole paste
    lands on one date under exactly one plan (the Groww paste = 2026-06-19).
    Cross-checked against MF Central, which states the plan outright.
  - The map keys on **name only**, so one fund held in different plans on two
    brokers needs a per-broker `bySource` block; `schemeFor(name, source)` picks
    it and every call site passes `source`. `warnPlanClashes` in the generator
    detects the split and fills `bySource` automatically (overridden keys are
    left alone). Live case: Motilal Oswal Nifty Smallcap 250 Index — Direct on
    Coin, Regular on Axis.
  - Legacy ICICI ELSS is **Regular** on both INDmoney and Groww (`OVERRIDES`),
    although everything else on INDmoney is Direct.
- `navOn` compares on **calendar date**: NAV history is stamped at UTC midnight
  but transaction dates are IST midnight, so a raw epoch compare silently
  returned the previous business day's NAV (~1% off on the filled units).
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
- **Market band on the pace chart** (`market.js` → `PaceChart` inside
  `GoalTracker`). The goal card's "Monthly investment" chart carries two bands
  on ONE shared time axis: the mid/small-cap **market** above (index-fund NAV,
  rebased to 100 across the window) and the monthly-total bars below, each bar
  **split** into its mid slice, its small slice, and everything else. Bars keep
  their true total height, so the 6-mo average line still means what it did.
  It is deliberately NOT lines overlaid on the bars — rupees and index level
  share no unit, so one y-scale would invent a correlation the data doesn't
  hold; one crosshair spans both bands, which is what makes "was I buying into
  a fall or a rally?" readable. No separate card or mobile rail section: the
  user asked for this chart updated, not a new one.
  - Market proxy = **pinned Direct-plan index funds** (Nippon Nifty Midcap 150
    `148726`, Nifty Smallcap 250 `148519`) pulled through the existing
    `fetchNavs` (CORS-safe, cached, never throws); `MARKET_CODES` is unioned
    into Dashboard's `loadNavs`. Pinned so the series can't change shape because
    the user bought or sold a fund.
  - `navOn` clamps to the oldest entry, so a month predating the fund would
    report its **launch NAV** as that month's level; `marketVsBuys` tests the
    month against the history's oldest date first and emits null, breaking the
    line instead.
  - The cap stack is **clamped to the bar height**: goal.js's `added` and the MF
    transaction sum are computed independently, and a disagreement must show as
    a full bar, never a segment poking out the top.
  - Scope is **mid + small only**; add a row to `MARKET_SEGMENTS` to extend it.
    Colors are the `capOf` donut colors (validated as a pair for CVD separation
    and contrast on the navy surface), so a segment keeps one identity.
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
- `src/lib/` — drive, parse, classify, derive (txns → INDmoney + Groww MF
  holdings; `DERIVED_MF_SOURCES` lists the MF sheets complete enough to do it
  from — Axis/Coin have no transaction sheet, so their pastes stay), goal
  (corpus-vs-goal series), market (mid/small-cap market level vs monthly
  contributions), quotes, navs, portfolio, reconcile, monthly, whatif
  (buy simulation — `whatIfByCategory` per MF market-cap category and
  `equityWhatIf` per equity asset class; both emit the SAME card shape so one
  renderer draws all three tabs), sourceStyle, format
- `src/components/` — Dashboard (loads data, owns tabs), AppBar, SummaryCard,
  AllocationDonut, HoldingsTable (generic sortable; optional `className` for a
  scrollable variant), AssetTab (ONE column vocabulary (`COLS`) with a
  per-type `order`, so Stocks, ETFs and Mutual Funds scan identically: name +
  broker initial → **1D P&L** → Total P&L % → P&L → qty → (avg price, market
  price: equity only) → invested → current. The footer is built from the same
  `order`, so a column added to one tab can't silently misalign the totals row.
  Optional `foldTo`/`rankOf` props — the MF tab passes `foldTo={5}` + a last-buy-recency rank from Dashboard's `mfLastBuy`
  map, so 5 recently-bought funds show up front and "See all" expands to a
  scrollable table with sticky header), ConsolidatedTab, GoalTracker (goal card
  + journey/pace SVG charts + pulse tiles with their own micro-charts; card
  chrome is dropped at ≤640px so the charts span the device), ReturnSheet
  (this-month return breakdown; portalled to `<body>` — the `.card`
  backdrop-filter would otherwise contain `position:fixed`),
  TransactionsTab, ReconcilePanel, StateViews, SourceLegend, FileDropzone,
  WhatIfCard (the buying-pattern card chrome — `LineChart`, `ReturnStrip`,
  the trend/what-if toggle, the range picker — shared by ALL THREE asset tabs.
  Everything that differs between funds and equities arrives as one `spec`
  object: `noun`/`colHead`/`trendLabel`/`historyNoun`, `shorten`, `colorOf`,
  `dashOf`, `brokerOf`, `shortLabel`/`fullLabel`, `tagOf`, `note`. Add a tab by
  writing a spec, not by copying the card),
  EquityWhatIf (Stocks/ETF twin of MfWhatIf: ONE card per asset class, top
  `PICKS` (4) scrips by money in. Differences from the MF side, both because
  equities have no plans and no per-broker pricing: (a) a scrip prices the same
  wherever it is held, so candidates dedupe by **symbol**, colour is keyed to
  the scrip's rank from one 4-hue palette, nothing is dashed, and the series
  labels carry **no broker** — "All-in Infosys · Groww" would imply the
  counterfactual depends on the platform; the leaderboard's per-broker dots
  carry that instead. (b) Sells are real, so money-in is **net of proceeds** and
  the counterfactual moves the same rupees on the same day — a position closed
  out still reports its profit (in the shrunken "money in") instead of vanishing
  with its units; the alt can't sell what it never accumulated, so an oversized
  redemption just empties it. Chip percentages are suppressed when net money-in
  is ≤ 0, since there is no positive base to divide by. Both equity brokers keep
  a transaction sheet, so every buy is a real cashflow — unlike the MF card,
  there is no comparison-only broker),
  MfWhatIf (MF-tab buying-pattern analysis: per market-cap category, replays
  the INDmoney buys "all-in" each **candidate** fund of that category —
  gain-over-invested lines (raw value would hide the differences under the
  contribution staircase) + a NAV-trend view rebased to 100 with buy markers
  (the **default** view). Candidates = top `PICKS_PER_SOURCE` (2) funds of the
  category from **two brokers**: INDmoney (by amount transacted) and Coin (by
  the holdings snapshot's `invested`), deduped by AMFI scheme code — Coin has
  no txn sheet, so its funds are comparison-only, carry no buy markers, and
  never enter the "Your buys" line; a category with no priceable INDmoney buy
  has no cashflows and so no card. A fund that *is* transacted but can't be
  priced (missing from `mf-schemes.json`) has its buys dropped from the replay
  entirely and its name listed on the card (`unpriced`) — counting the money as
  invested while showing it at zero value would make "Your buys" look worse than
  it was. `equityWhatIf` does the same for a scrip with no ticker. Broker is
  double-encoded — INDmoney solid, Coin dashed — and each broker owns a colour
  pair indexed by the fund's `slot` within it. "Your buys" is valued from **every** INDmoney fund of the
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
