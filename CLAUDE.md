# Invest Monitor

Personal portfolio dashboard that tracks INDmoney holdings & transactions
(stocks, mutual funds, ETFs) so daily trades can be verified and reconciled.

## Stack
- Vite + React 19 (JS, no TypeScript)
- Plain modern CSS (CSS variables, dark theme) — no Tailwind
- SheetJS (`xlsx`) for in-browser .xlsx parsing
- Hand-rolled SVG/CSS charts (no chart library)
- No backend of our own; data is fetched client-side from Google Drive. The only
  server-side piece is a tiny **Cloudflare Worker** that proxies Yahoo Finance for
  live prices (CORS) — see `proxy/`.

## Data source
INDmoney `.xlsx` reports are uploaded to a **Google Drive folder** (shared
"Anyone with the link – Viewer"). The app lists the folder and downloads files
via the **Drive API v3 with an API key** (CORS-friendly for public files), then
parses them in the browser. A drag-and-drop fallback (`FileDropzone`) accepts
the same files locally and runs the identical pipeline — so the app works before
Drive is configured and during dev.

Config (`.env`, see `.env.example`):
- `VITE_GDRIVE_FOLDER_ID` — the shared Drive folder ID
- `VITE_GDRIVE_API_KEY` — API key restricted to the Drive API
- `VITE_PRICE_PROXY` — base URL of the CORS proxy for live prices (the deployed
  Worker, ending in `/?url=`). Blank ⇒ falls back to a flaky public proxy; empty
  ⇒ live prices disabled (the sheet's stale Current value is used).

The data source is **4 native Google Sheets** in the Drive folder, each a
copy-paste of an INDmoney web page. They are auto-detected by **content/structure**
(not filename) in `classify.js`; each parser returns `null` if its shape isn't
present. Native Google Sheets are fetched via the Drive **export** endpoint (not
`alt=media`) — see `drive.js`. (The old `.xlsx` parsers remain as harmless
fallbacks.)

1. **My Stocks** — current stocks **+ ETFs** portfolio. A real table, header
   `Stock Name | Quantity | Avg. Price`. `parseMyStocks` reads the three columns;
   **invested is derived** (`qty × avgPrice`). The sheet no longer carries a ticker,
   Market Price, or Current value — symbol comes from `IND_NAME_TO_SYMBOL` and
   **current value + P&L are recomputed live** (see Live prices / Symbol resolution).
2. **My MFs** — current MF portfolio. A real table, header
   `Fund Name | Invested | Current Value | Units`. Values are **compact**
   (`₹4.14L`, `₹-3.04K`) so they go through `parseMoney`. `parseMyMfs` reads
   `Units` → `qty` (no folio). Detected **last** among the MF tables (its loose
   header tokens are substrings of the Coin/Groww headers — see `buildDataset`).
3. **Stocks Transactions** — stock/ETF orders. Grouped under ordinal date headers
   (`8th Jun'26`, `30th Sept'25`); rows have `N Qty` (col 1) and `Buy/Sell Executed`
   (col 4). `parseStockTransactions` → equity `transactions` (carry `type`).
4. **MF Transactions** — `Buy/Sell` marker + `<Fund>Buy SuccessfulOrder Date<DD Mon
   YYYY>Units<u> (Nav <n>)Amount₹<amt>`. `parseMfTransactions` → `mfTransactions`
   (amount = units×nav). Feeds the **Monthly** tab.

`resources/others/` is intentionally ignored.

## Asset classification (Stock vs ETF)
No ISIN in these sheets — classify by name/symbol keywords (`classifyEquity` in
classify.js): ETF if it contains any of `etf, nasdaq, nifty, bees, sensex, next50,
setf, mon100, n100, beta`, else stock. MF rows are always `mf`.

## Source platforms (color coding)
Holdings come from several Drive sheets, each parser stamping a `source` string.
Those 6 sources map to **4 broker platforms** (`SOURCE_PLATFORM` in `config.js`):
- **INDmoney** ← `My Stocks`, `My MFs`
- **Groww** ← `Stocks Groww`, `MF Groww`
- **Axis** ← `Axis Bank MF`
- **Coin** ← `My MF Coin`

`PLATFORMS` (config.js) gives each a label + accent colour (INDmoney violet
`#9b8cff`, Groww blue `#4f9cff`, Axis rose `#ef5a98`, Coin amber `#f5a524`).
`platformOf(source)` resolves a holding to its platform (null if unknown).

Rows are **tinted by source** (background + left accent stripe), not labelled
per-row: `sourceRowClassName`/`sourceRowStyle` (`src/lib/sourceStyle.js`) set the
`.row--source` class + a `--src` colour var, passed to `HoldingsTable`'s
`rowClassName`/`rowStyle` props (Stocks/ETFs/MF tables) and applied to the
Consolidated top-holdings bar rows (`ConsolidatedTab` + `ConsolidatedMobile`).
`SourceLegend.jsx` renders the colour→name key; with an `onSelect`/`active` pair
(used in `AssetTab`) its chips become a **single-source filter** — tapping a
platform shows only its holdings and the strip/footer totals recompute (filter
state is per-tab via `platformKeyOf`). CSS lives under "Source / platform colour
coding" in `App.css`.

## Live prices (Stocks/ETFs)
The sheet is the source of truth only for **qty / avgPrice / invested**; the
**Current value, market price, and P&L** for stocks/ETFs are recomputed from a
**live** price (`current = qty × livePrice`). MFs get live **NAV** too — see
**Live NAV (MFs)** below.

- Source: Yahoo Finance batch `spark` endpoint, `<SYMBOL>.NS` (NSE, INR). Yahoo
  has no CORS, so requests route through the `VITE_PRICE_PROXY` Worker.
- `src/lib/quotes.js` — `fetchQuotes(symbols)` (batched, 10-min localStorage TTL,
  `force` for manual refresh, never throws) + `enrichHoldings(holdings, priceMap)`
  (pure; recomputes current/pnl, leaves qty/avg/invested untouched). Unresolved
  symbols/MFs fall back to the sheet's Current with `marketPrice: null`.
- `Dashboard` fetches on load + cache-boot and exposes a **Refresh prices** action
  (`AppBar` ⋮ menu). It renders an `enrichHoldings` `useMemo` so every tab/card
  sees live values — `portfolio.js` needs no change.
- Symbol resolution: both broker name→NSE-ticker maps live in the committed
  **`resources/name-symbols.json`** (`{ indmoney, groww }`, hand-maintained — add
  a line when a new descriptively-named holding appears). **My Stocks** has no
  ticker — `indStocksSymbol` reads the `indmoney` map. **Stocks Groww** lists only
  "Company" — `growwSymbol` uses it directly if it's ticker-like, else maps known
  descriptive ETF names via the `groww` map (e.g. `ICICI Prud Gold ETF`→`GOLDIETF`,
  `Mirae … FANG+`→`MAFANG`). Both resolvers live in `classify.js`.
- Worker: `proxy/` (`src/worker.js` + `wrangler.jsonc`), locked to Yahoo hosts,
  60s edge cache. Deploy/redeploy with `cd proxy && npx wrangler deploy`.

## Live NAV (MFs)
MF **Current value + P&L** are recomputed from a **live NAV** (`current = units ×
NAV`); only `invested` (and `units`/`avgPrice` when the sheet has them) come from
the sheet.

- Source: **mfapi.in** (`https://api.mfapi.in/mf/<code>`), a free, no-key JSON
  mirror of AMFI's daily NAV. It sends `access-control-allow-origin: *`, so the
  browser calls it **directly — no proxy** (unlike Yahoo). AMFI's own `NAVAll.txt`
  has no CORS, hence mfapi.in.
- No ISIN/scheme code in our sheets, so each fund is matched to an AMFI **scheme
  code OFFLINE, once**, by `scripts/build-mf-schemes.mjs` → committed
  **`resources/mf-schemes.json`** (`mfKey(name) → {schemeCode, schemeName, plan}`).
  At runtime the app only **reads** that map (never searches). Re-run the
  generator when a new fund appears (the app `console.warn`s any unmatched MF).
  The generator harvests fund names from Drive, scores mfapi search hits (Growth +
  plan-by-source: Axis=Regular, others=Direct; active vs index never crossed), and
  has an `OVERRIDES` map for legacy ICICI schemes mfapi search can't reach.
- `src/lib/navs.js` — `mfKey` (name→stable key, more discriminating than reconcile's
  `nameKey` since MF names share AMC prefixes), `schemeCodesFor(holdings)`,
  `fetchNavs(codes)` (per-code NAV history, **~12h localStorage TTL**, `force` for
  manual refresh, never throws), `navOn(history, date)`, and
  `enrichMfHoldings(holdings, navMap)` (pure; recomputes current/pnl, leaves
  invested untouched). Units priority: **sheet `qty` → Coin avg-NAV
  (`invested/avgPrice`) → snapshot-scale** (`current / NAV@asOf`, where `asOf` is
  the Drive file's `modifiedTime` threaded through `parse.js`→`classify.js`;
  reproduces the sheet value while fresh, diverges as NAV moves past the sheet
  date). **All 4 MF sheets now carry a `Units` column**, so sheet `qty` is the
  primary path for every fund; the avg-NAV / snapshot-scale steps are now just
  fallbacks for any future sheet without units. Unmatched funds / funds without
  derivable units keep the sheet Current.
- `Dashboard` loads NAVs on load + cache-boot (alongside prices) and the **Refresh
  prices** action force-refreshes both. `view` composes
  `enrichMfHoldings(enrichHoldings(…))`.

## Key rules
- The sheet supplies qty/avgPrice/invested; live prices supply current/P&L for
  stocks/ETFs (see Live prices above). Never fabricate values.
- Holdings and orders name the same scrip differently and have no ISIN, so
  `reconcile.js` joins them with a fuzzy first-two-significant-tokens `nameKey`.
- A hardcoded ₹10k/month Edelweiss Mid Cap SIP is injected into the Monthly MF
  calc (`RECURRING_SIPS` in `monthly.js`) — it's absent from the MF Buy/Sell sheet
  (lives under INDmoney's SIP tab); a same-day guard prevents double counting.

## Project layout
- `src/config.js` — Drive + price-proxy env config, asset-type labels & colors
- `src/lib/` — `drive` (fetch), `parse` (SheetJS → rows), `classify` (detect +
  normalize → `{holdings, transactions, meta}`), `quotes` (live stock/ETF prices +
  enrich), `navs` (live MF NAV + enrich), `portfolio` (totals/allocation),
  `reconcile` (txns vs holdings), `sourceStyle` (per-source row tint hooks),
  `format` (INR/number/date helpers)
- `proxy/` — Cloudflare Worker that CORS-proxies Yahoo Finance (live prices)
- `scripts/build-mf-schemes.mjs` — one-time (re-runnable) generator for
  `resources/mf-schemes.json` (MF name → AMFI scheme code); run `node
  scripts/build-mf-schemes.mjs`
- `src/components/` — `Dashboard` (loads data, owns tabs) + `AppBar`,
  `SummaryCard`, `AllocationDonut`, `HoldingsTable` (generic sortable),
  `AssetTab` (generic Stocks/ETFs/MF), `ConsolidatedTab`, `TransactionsTab`,
  `ReconcilePanel`, `StateViews`, `SourceLegend` (platform colour key)
- `resources/` — sample INDmoney exports for local dev/testing (gitignored as
  personal financial data), plus two committed maps: `mf-schemes.json`
  (MF-name→scheme-code) and `name-symbols.json` (broker name→NSE-ticker, `{ indmoney,
  groww }`). The dir is gitignored, but both JSONs are explicitly un-ignored
  (`!resources/mf-schemes.json`, `!resources/name-symbols.json`) since `navs.js` /
  `classify.js` import them at build time and bake them into the bundle (scheme
  codes and NSE tickers are public data).

## Normalized shapes
- holding: `{ name, isin, symbol|null, type:'stock'|'etf'|'mf', qty, avgPrice,
  invested, current|null, pnl|null, pnlPct|null, marketPrice|null, folio|null,
  source, asOf|null }` (`symbol` drives stock/ETF live-price lookup; for MFs
  `mfKey(name)` drives the NAV lookup; `marketPrice` is the live price/NAV; `asOf`
  is the sheet's snapshot date — the Drive file's `modifiedTime`)
- transaction: `{ date:Date, name, symbol, isin, side:'BUY'|'SELL', qty, price,
  status }`

## Commands
- `npm run dev` — start dev server
- `npm run build` — production build
- `npm run lint` — eslint
- `node scripts/build-mf-schemes.mjs` — (re)generate `resources/mf-schemes.json`
  (MF name → AMFI scheme code) from the Drive sheets; run when a new MF appears
- `npm run deploy` — build + deploy the SPA to Cloudflare (Workers static assets,
  config in root `wrangler.jsonc`, served from `./dist` with SPA fallback)
- `cd proxy && npx wrangler deploy` — deploy the live-price proxy Worker

## Deployment (Cloudflare)
Two Workers on the free tier: **`invest-monitor`** (the SPA, root `wrangler.jsonc`,
assets-only) and **`invest-monitor-price-proxy`** (the Yahoo CORS proxy, `proxy/`).
`VITE_*` vars are **baked into the bundle at build time**, so `npm run deploy`
builds from the local `.env` and uploads `dist`. (If you ever switch to Git-based
Cloudflare Builds instead, set the `VITE_*` vars in the dashboard build env, since
`.env` is gitignored.) The Drive API key is embedded in the public bundle by
design — restrict it by HTTP referrer to the deployed domain in Google Cloud.
