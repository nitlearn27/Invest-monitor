# Invest Monitor

A sleek dashboard to track your **INDmoney** portfolio — stocks, mutual funds and
ETFs — and to verify that the transactions you make actually reflect in your
holdings.

- **Consolidated view** with totals, allocation chart and top holdings
- **Separate tabs** for Stocks, Mutual Funds and ETFs (with live P&L)
- **Buying-pattern analysis** on the MF tab: per category (mid/small/large cap…),
  replays your buys as if they had all gone into each fund of that category —
  gain-over-invested lines show whether you picked the right fund, and a NAV
  trend view (rebased to 100, your buys marked) shows the prices you acted on
- **Monthly** view: invested per month split MF vs Stocks & ETFs, per-month MF
  market-cap and stock/ETF donuts, and a per-month transaction breakdown
- **Transactions** log with a **reconciliation** panel (net traded qty vs current
  holding, per scrip) so you can confirm trades went through
- Loads data from a **Google Drive folder**, with a **drag-and-drop** fallback

## Getting the data in

Only **2 INDmoney Google Sheets** need upkeep in your Drive folder. Each is a
simple copy-paste of an INDmoney web page into a blank Google Sheet:

| Sheet | Copy this INDmoney page into it |
|---|---|
| **Stocks Transactions** | My Stocks → **Orders** (your executed buys/sells) |
| **MF Transactions** | Mutual Funds → **Transactions** (the *Buy/Sell* list) |

Current **holdings are derived automatically** from the transactions — qty and
invested by summing your orders, current value & P&L from live prices/NAVs. The
old *My Stocks* / *My MFs* holdings sheets are no longer needed (if they're
still in the folder, they're ignored).

Two things matter for the derivation to stay correct:

- **Paste the complete order history every time** (scroll to the end of the
  INDmoney page). A partial paste silently shrinks your derived holdings.
- **Purchases that predate the transactions page** (old lump sums) can be added
  as ordinary rows in *MF Transactions* — date, scheme name, amount and units
  are enough (NAV can be blank).

The app figures out which sheet is which by its **content**, so the file names
can be anything. Just paste the whole page — the rest of the page (menus, ads,
footers) is ignored. Re-paste and **Refresh** whenever you want fresh numbers.

> You can also drag-and-drop exported `.xlsx`/Sheets onto the dashboard to load
> them locally without Drive.

## Run locally

```bash
npm install
npm run dev
```

## Connect Google Drive

1. Put the 4 sheets in one Drive folder.
2. Share the **folder** as **"Anyone with the link – Viewer"** (an API key can
   only read public files; the link itself stays private/unlisted).
3. In Google Cloud Console, enable the **Google Drive API** and create an
   **API key** (restrict it to the Drive API; add an HTTP-referrer restriction
   for your domain).
4. Copy `.env.example` to `.env` and fill in:

   ```
   VITE_GDRIVE_FOLDER_ID=...
   VITE_GDRIVE_API_KEY=...
   VITE_PRICE_PROXY=...   # live-price proxy URL, ending in /?url= (see below)
   ```

5. Restart `npm run dev`. The app lists the folder, pulls the sheets, and caches
   them in the browser; click **Refresh** (top-right) to re-pull after updating a
   sheet. Native Google Sheets are read via the Drive *export* endpoint.

## Live prices & NAVs

The sheets are the source of truth only for **quantity / avg price / invested**;
current value, market price and P&L are recomputed **live** in the browser:

- **Stocks & ETFs** — prices come from Yahoo Finance (NSE, `.NS` symbols).
  Yahoo has no CORS, so requests go through a tiny **Cloudflare Worker** in
  `proxy/` that whitelists Yahoo hosts and edge-caches for 60s. Deploy it once
  with `cd proxy && npx wrangler deploy`, then point `VITE_PRICE_PROXY` at it
  (URL ending in `/?url=`). Leaving it blank falls back to a flaky public
  proxy; setting it empty disables live prices (the sheet's stale value is
  shown instead). Quotes are cached in localStorage for ~10 minutes.
- **Mutual funds** — NAVs come from [mfapi.in](https://www.mfapi.in/), a free
  no-key mirror of AMFI's daily NAV that allows CORS, so no proxy is needed.
  NAVs are cached for ~12 hours. Each fund is matched to its AMFI scheme code
  offline by `node scripts/build-mf-schemes.mjs`, which writes
  `resources/mf-schemes.json`; re-run it when you add a new fund (the console
  warns about unmatched funds).
- The **Refresh prices** action in the ⋮ menu force-refreshes both.
- New stock/ETF holdings with descriptive names may need a line added to
  `resources/name-symbols.json` (broker name → NSE ticker).

## Platform colours

Holdings can come from several brokers; rows are tinted by platform —
**INDmoney** (violet), **Groww** (blue), **Axis** (rose), **Coin** (amber) —
with a legend whose chips also work as a tap-to-filter on the Stocks/MF/ETF
tabs.

## Notes

- Holdings and orders name the same scrip differently and carry no ISIN, so
  reconciliation joins them with a fuzzy name match.
- A ₹10,000/month Edelweiss Mid Cap **SIP** (from May 2025) is synthesized into
  the transactions and derived holdings — INDmoney doesn't list SIP installments
  on its Transactions page. Units for each installment come from the fund's
  actual NAV on the SIP date. Edit `RECURRING_SIPS` in `src/lib/monthly.js` if
  the SIP changes or stops.
- The API key only reads public files; keep it Drive-API + referrer restricted.

## Install as an app (PWA)

The dashboard is an installable PWA (`public/manifest.webmanifest` +
`public/sw.js`, registered in production only):

- **Install** — on installable Chromium browsers (e.g. Android Chrome) the ⋮
  menu shows an **Install app** item (it hides once installed, and on iOS).
- **Auto-update** — every `npm run build` stamps a unique version into
  `dist/sw.js` (`scripts/stamp-sw.mjs`), so each deploy ships a byte-distinct
  service worker. The browser detects the update, the new worker takes over
  immediately, old caches are deleted, and the running app reloads itself —
  no manual reinstall. The app also checks for updates on load and whenever
  the (installed) app regains focus.

## Deploy to Cloudflare

Two Workers on the free tier: **`invest-monitor`** (the SPA, static assets,
config in root `wrangler.jsonc`) and **`invest-monitor-price-proxy`** (the
Yahoo CORS proxy in `proxy/` — deploy it with `cd proxy && npx wrangler
deploy`, then set `VITE_PRICE_PROXY`).

> ⚠️ **Privacy:** the app embeds the Drive folder id + API key in the browser
> bundle and reads from a public Drive folder, so **anyone who opens the deployed
> URL can see your portfolio**. Put the site behind **Cloudflare Access** (Zero
> Trust → restrict to your email) if you don't want it public.

**Option A — Wrangler CLI (Workers static assets):**

```bash
npx wrangler login          # one-time
npm run deploy              # builds with your local .env, then deploys
```

Your `.env` (`VITE_GDRIVE_FOLDER_ID`, `VITE_GDRIVE_API_KEY`, `VITE_PRICE_PROXY`)
is read at **build** time and baked into the bundle. Deploys to
`invest-monitor.<subdomain>.workers.dev`.

**Option B — Cloudflare Pages + GitHub (auto-deploy on push):**

1. Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git → pick the repo.
2. Build command `npm run build`, output directory `dist`.
3. Add environment variables `VITE_GDRIVE_FOLDER_ID`, `VITE_GDRIVE_API_KEY`
   and `VITE_PRICE_PROXY` (Production **and** Preview). Deploys to
   `invest-monitor.pages.dev`.

**After deploying (required):** add the deployed origin (e.g.
`https://invest-monitor.pages.dev/*` or the `*.workers.dev` URL) to your Google
API key's **HTTP referrer** allowlist, or Drive fetches will return 403.

## Scripts

- `npm run dev` — dev server
- `npm run build` — production build (also stamps the service-worker version)
- `npm run lint` — lint
- `npm run deploy` — build + deploy to Cloudflare (Workers static assets)
- `cd proxy && npx wrangler deploy` — deploy the live-price proxy Worker
- `node scripts/build-mf-schemes.mjs` — regenerate the MF → AMFI scheme-code map
