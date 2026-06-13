# Invest Monitor

A sleek dashboard to track your **INDmoney** portfolio — stocks, mutual funds and
ETFs — and to verify that the transactions you make actually reflect in your
holdings.

- **Consolidated view** with totals, allocation chart and top holdings
- **Separate tabs** for Stocks, Mutual Funds and ETFs (with live P&L)
- **Monthly** view: invested per month split MF vs Stocks & ETFs, per-month MF
  market-cap and stock/ETF donuts, and a per-month transaction breakdown
- **Transactions** log with a **reconciliation** panel (net traded qty vs current
  holding, per scrip) so you can confirm trades went through
- Loads data from a **Google Drive folder**, with a **drag-and-drop** fallback

## Getting the data in

The app reads **4 Google Sheets** in your Drive folder. Each is a simple
copy-paste of an INDmoney web page into a blank Google Sheet:

| Sheet | Copy this INDmoney page into it |
|---|---|
| **My Stocks** | My Stocks → current holdings (stocks **+ ETFs**) |
| **My MFs** | Mutual Funds → current holdings (the *Gain/ Loss* list) |
| **Stocks Transactions** | My Stocks → **Orders** (your executed buys/sells) |
| **MF Transactions** | Mutual Funds → **Transactions** (the *Buy/Sell* list) |

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
   ```

5. Restart `npm run dev`. The app lists the folder, pulls the sheets, and caches
   them in the browser; click **Refresh** (top-right) to re-pull after updating a
   sheet. Native Google Sheets are read via the Drive *export* endpoint.

## Notes

- All holdings show **current value + P&L**: stocks/ETFs from **My Stocks**, funds
  from **My MFs**. My Stocks values are exact; My MFs values are compact (~1%
  rounding).
- Holdings and orders name the same scrip differently and carry no ISIN, so
  reconciliation joins them with a fuzzy name match.
- A ₹10,000/month Edelweiss Mid Cap **SIP** is added to the Monthly MF figures
  (it isn't in the *Buy/Sell* transactions list); edit `RECURRING_SIPS` in
  `src/lib/monthly.js` to change or remove it.
- The API key only reads public files; keep it Drive-API + referrer restricted.

## Deploy to Cloudflare

It's a static SPA, so it deploys as static assets (config in `wrangler.jsonc`).

> ⚠️ **Privacy:** the app embeds the Drive folder id + API key in the browser
> bundle and reads from a public Drive folder, so **anyone who opens the deployed
> URL can see your portfolio**. Put the site behind **Cloudflare Access** (Zero
> Trust → restrict to your email) if you don't want it public.

**Option A — Wrangler CLI (Workers static assets):**

```bash
npx wrangler login          # one-time
npm run deploy              # builds with your local .env, then deploys
```

Your `.env` (`VITE_GDRIVE_FOLDER_ID`, `VITE_GDRIVE_API_KEY`) is read at **build**
time and baked into the bundle. Deploys to `invest-monitor.<subdomain>.workers.dev`.

**Option B — Cloudflare Pages + GitHub (auto-deploy on push):**

1. Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git → pick the repo.
2. Build command `npm run build`, output directory `dist`.
3. Add environment variables `VITE_GDRIVE_FOLDER_ID` and `VITE_GDRIVE_API_KEY`
   (Production **and** Preview). Deploys to `invest-monitor.pages.dev`.

**After deploying (required):** add the deployed origin (e.g.
`https://invest-monitor.pages.dev/*` or the `*.workers.dev` URL) to your Google
API key's **HTTP referrer** allowlist, or Drive fetches will return 403.

## Scripts

- `npm run dev` — dev server
- `npm run build` — production build
- `npm run lint` — lint
- `npm run deploy` — build + deploy to Cloudflare (Workers static assets)
