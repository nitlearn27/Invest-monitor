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
   `Stock Name | Market Price | Invested (Qty/Price) | Current value | Total PnL`.
   `parseMyStocks` splits `Name\nSYMBOL` and the `₹invested / "N Qty" / "₹avg Avg."`
   cell; P&L = current − invested (the sheet's Total PnL cell is often `#ERROR!`).
   → holdings with real **current value + P&L**.
2. **My MFs** — current MF portfolio. Concatenated rows under a `Gain/ Loss`
   marker: `<Fund>Invested₹<v>Current Value₹<v>Gain/ Loss₹<v>▲/▼<pct>%`. Values
   are **compact** (`₹4.14L`, `₹-3.04K`). `parseMyMfs`. No units/folio available.
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
**live** price (`current = qty × livePrice`). MFs keep the sheet's value.

- Source: Yahoo Finance batch `spark` endpoint, `<SYMBOL>.NS` (NSE, INR). Yahoo
  has no CORS, so requests route through the `VITE_PRICE_PROXY` Worker.
- `src/lib/quotes.js` — `fetchQuotes(symbols)` (batched, 10-min localStorage TTL,
  `force` for manual refresh, never throws) + `enrichHoldings(holdings, priceMap)`
  (pure; recomputes current/pnl, leaves qty/avg/invested untouched). Unresolved
  symbols/MFs fall back to the sheet's Current with `marketPrice: null`.
- `Dashboard` fetches on load + cache-boot and exposes a **Refresh prices** action
  (`AppBar` ⋮ menu). It renders an `enrichHoldings` `useMemo` so every tab/card
  sees live values — `portfolio.js` needs no change.
- Symbol resolution: **My Stocks** carries the ticker (2nd name line). **Stocks
  Groww** lists only "Company" — `growwSymbol` in `classify.js` uses it directly
  if it's ticker-like, else maps known descriptive ETF names via
  `GROWW_NAME_TO_SYMBOL` (e.g. `ICICI Prud Gold ETF`→`GOLDIETF`, `Mirae … FANG+`
  →`MAFANG`). Add a line there when a new descriptively-named ETF appears.
- Worker: `proxy/` (`src/worker.js` + `wrangler.jsonc`), locked to Yahoo hosts,
  60s edge cache. Deploy/redeploy with `cd proxy && npx wrangler deploy`.

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
  normalize → `{holdings, transactions, meta}`), `quotes` (live prices + enrich),
  `portfolio` (totals/allocation), `reconcile` (txns vs holdings), `sourceStyle`
  (per-source row tint hooks), `format` (INR/number/date helpers)
- `proxy/` — Cloudflare Worker that CORS-proxies Yahoo Finance (live prices)
- `src/components/` — `Dashboard` (loads data, owns tabs) + `AppBar`,
  `SummaryCard`, `AllocationDonut`, `HoldingsTable` (generic sortable),
  `AssetTab` (generic Stocks/ETFs/MF), `ConsolidatedTab`, `TransactionsTab`,
  `ReconcilePanel`, `FileDropzone`, `StateViews`, `SourceLegend` (platform colour key)
- `resources/` — sample INDmoney exports for local dev/testing

## Normalized shapes
- holding: `{ name, isin, symbol|null, type:'stock'|'etf'|'mf', qty, avgPrice,
  invested, current|null, pnl|null, pnlPct|null, marketPrice|null, folio|null,
  source }` (`symbol` drives live-price lookup; `marketPrice` is the live price)
- transaction: `{ date:Date, name, symbol, isin, side:'BUY'|'SELL', qty, price,
  status }`

## Commands
- `npm run dev` — start dev server
- `npm run build` — production build
- `npm run lint` — eslint
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
