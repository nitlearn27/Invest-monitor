# Invest Monitor

A sleek dashboard to track your **INDmoney** portfolio — stocks, mutual funds and
ETFs — and to verify that the transactions you make actually reflect in your
holdings.

- **Consolidated view** with totals, allocation chart and top holdings
- **Road to ₹5 Cr** goal tracker at the top of the Consolidated page: your
  **total corpus** (what everything is worth today, profits included) valued day
  by day against the goal, with the invested line beneath it, continued as a
  dashed projection that compounds a monthly investment you type in at an assumed
  return — so you see the year the goal actually lands. Plus a monthly-investment
  chart and this-month-vs-last-month corpus figures. Change the target with
  `CORPUS_GOAL` in `src/config.js`
- **Separate tabs** for Stocks, Mutual Funds and ETFs — all three read the same
  way: name and broker, then today's gain, total return, and the position
  itself, ending in what it's worth now
- **Buying-pattern analysis** on all three tabs: replays your buys as if they
  had all gone into each of the top holdings you're being compared against —
  the *what-if gain* lines show whether you picked the right one, and the
  *trend* view (rebased to 100, your buys marked) shows the prices you acted on.
  Mutual funds are compared per category (mid/small/large cap…); stocks and ETFs
  compare the top 4 you put the most money into
- **Returns leaderboard** under each trend chart: every fund, stock or ETF you
  hold on any broker, scored over 1M / 3M / 6M / 1Y / 3Y with the winner of each
  column highlighted. Tap a column to sort by it
- **Monthly** view: invested per month split MF vs Stocks & ETFs, per-month MF
  market-cap and stock/ETF donuts, and a per-month transaction breakdown
- **Transactions** log with a **reconciliation** panel (net traded qty vs current
  holding, per scrip) so you can confirm trades went through
- Loads data from a **Google Drive folder**, with a **drag-and-drop** fallback

## Getting the data in

Only **transaction sheets** need upkeep in your Drive folder. Each is a simple
copy-paste of a broker's web page into a blank Google Sheet:

| Sheet | Copy this page into it |
|---|---|
| **Stocks Transactions** | INDmoney → My Stocks → **Orders** (executed buys/sells) |
| **MF Transactions** | INDmoney → Mutual Funds → **Transactions** (the *Buy/Sell* list) |
| **MF Groww Transactions** | Groww → Mutual Funds → **Orders / Transactions** |
| **Groww Stocks Transactions** | Groww → Stocks → **Orders** |

Current **holdings are derived automatically** from the transactions — qty and
invested by summing your orders, current value & P&L from live prices/NAVs. The
old *My Stocks* / *My MFs* / *MF Groww* / *Stocks Groww* holdings sheets are no
longer needed (if they're still in the folder, any position the transactions
already cover is ignored).

Two things matter for the derivation to stay correct:

- **Paste the complete order history every time** (scroll to the end of the
  broker's page). A partial paste silently shrinks your derived holdings.
- **Positions that predate the transactions page** — old lump sums, or something
  you stopped adding to but still hold — need one row each so the app knows you
  own them. On INDmoney they go in as ordinary rows in *MF Transactions*. On
  Groww, add an **`Opening`** row to the matching transactions sheet:

  | Sheet | Set | Put the position's… |
  |---|---|---|
  | *MF Groww Transactions* | Type = `Opening` | **units** and **invested amount** |
  | *Groww Stocks Transactions* | Order Type = `Opening` | **quantity** and **average price** |

  The date can be anything — nothing is calculated from it. The app then values
  the position live every day, but never counts it as money you added that
  month. (For stocks/ETFs, add the ticker to `resources/name-symbols.json` if
  the name isn't already an NSE symbol, or it can't be priced.)

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
  shown instead). Quotes are cached in localStorage for ~10 minutes, and carry
  the previous session's close so every tab can show a **1-day** gain/loss.
- **Mutual funds** — NAVs come from [mfapi.in](https://www.mfapi.in/), a free
  no-key mirror of AMFI's daily NAV that allows CORS, so no proxy is needed.
  NAVs are cached for ~12 hours. Each fund is matched to its AMFI scheme code
  offline by `node scripts/build-mf-schemes.mjs`, which writes
  `resources/mf-schemes.json`; re-run it when you add a new fund (the console
  warns about unmatched funds).
- The **Refresh prices** action in the ⋮ menu force-refreshes both.
- Every asset tab carries a **freshness stamp** at the left of the broker-chip
  row, just above the table. On Mutual Funds it reads `● NAV 25 Aug` — the day
  the NAV itself was struck, which is the day your Current value is worth. NAVs
  publish once a day late in the evening, so on the 26th you are normally
  looking at the 25th's NAV; the time we fetched it is deliberately not shown.
  Stocks/ETFs have no such date (a quote moves all session), so theirs reads
  `● Prices · 4 min ago`. The dot turns amber when a NAV is more than 4 days
  old, or a quote older than its 10-minute cache. Tapping the stamp refreshes
  prices and NAVs, same as the ⋮ menu item.
- New stock/ETF holdings with descriptive names may need a line added to
  `resources/name-symbols.json` (broker name → NSE ticker).

## Monthly correction strategy

On mobile, the opening Consolidated page has a dedicated **Invest** tab in the
bottom swipeable section dock. It shows a monthly NAV sparkline, drawdown metric,
budget progress bar and trigger timeline. Tap the other tabs for Goal, Total,
Funds and Stocks; scrolling the dock does not change the active view. Detailed
alerts and history expand on demand, and the info icon holds the strategy rules.
On desktop the strategy remains the first card. Select any mapped portfolio mutual fund (Direct/Regular plans remain
separate) to see its own NAV, monthly high, drawdown, allocation progress and
recommendations. Unmapped funds are listed as unavailable. Invesco India Mid Cap
Direct Growth, AMFI **120403**, is always available as the default selection.

Each fund starts with an independent **₹1,00,000** monthly budget: **55%** on the
first published NAV date, **20% / 15% / 10%** at **3% / 5% / 7%** drawdowns, and
the entire remainder on the **15th**, or the next published NAV date. These are
per-fund budgets, not portions of a shared portfolio budget. Use **Configure** to
change the budget, initial percentage, correction levels and cutoff day. Levels
can be added/removed; allocations must total 100%. Cutoff days exceeding a
month's length are clamped to its last day.

Drawdown is `(highest NAV in this calendar month − current NAV) / highest NAV × 100`.
The engine processes NAV dates chronologically, triggers all crossed pending
levels together, and never recommends more than the monthly budget. Cutoff takes
precedence over correction levels on the cutoff NAV date. A completed month's
NAV metrics continue updating without issuing more allocation recommendations.
Dates use the Indian calendar, independently of the browser's timezone.

**Allocated means recommended, not invested.** Recommendations do not create
transactions or change holdings. **Mark reviewed** acknowledges an alert without
claiming a purchase or freeing its allocation. The card shows outstanding current
month recommendations and preserves a dated recommendation log, including pending
alerts from earlier months. On first use it catches up from the start of the
current month; later checks catch up missed NAV dates/months since tracking began.
Historical trigger dates are displayed, so a catch-up alert is distinguishable
from a trigger on the latest NAV.

Once a month has recommended money, configuration changes apply **next month**;
its budget and rules are frozen to protect already-issued recommendations. If
there are no recommendations yet, settings apply immediately. The editable form
shows the saved settings; current-month metrics always use that month's snapshot.

This repository is a static React app with no server database, cron scheduler or
notification service. The feature reuses `fetchNavs` and its history/cache; checks
also run every 30 minutes while visible, on focus/return and on reconnect. There
are **no checks or push notifications while the app is closed**. `STRATEGY_POLL_MS`
and default strategy values live in `src/lib/correctionStrategy.js`.

Persistent schema: IndexedDB **`invest-monitor:strategies`**, version **1**, created
automatically on first use:

| Store | Key | Contents |
|---|---|---|
| `strategies` | AMFI `schemeCode` | Saved per-fund configuration, tracking start month |
| `months` | `schemeCode:YYYY-MM` | Frozen config, integer-paise budget/allocated/remaining, current/monthly-high NAV, drawdown, trigger keys, NAV/cutoff dates and statuses |
| `recommendations` | Monthly ID + trigger keys | Amount, component levels, trigger NAV/date, creation date, pending/reviewed status |

An overlapping IndexedDB read/write transaction commits monthly state and alerts
together, serializing concurrent jobs across tabs. A unique multi-entry
`triggerKeys` index also rejects duplicate monthly triggers. Storage errors are
shown rather than silently issuing unsaved recommendations. This guarantee and
history are **local to this browser and site origin**; other devices have separate
records, and clearing site data removes the history. No server migration is
required. The pure strategy evaluator takes NAV history as data and can be reused
for backtesting without the live API.

Run `npm test` for trigger, cutoff, monthly rollover, configuration, persistence
and concurrency coverage (using Node's test runner and `fake-indexeddb`).

## Platform colours

Holdings can come from several brokers; rows are tinted by platform —
**INDmoney** (violet), **Groww** (blue), **Axis** (rose), **Coin** (amber) —
with a legend whose chips also work as a tap-to-filter on the Stocks/MF/ETF
tabs.

## The ₹5 Cr goal tracker

The goal is tracked on the **total corpus** — the market value of everything you
hold, profits included. It is valued day by day as `units held on that day × price
on that day`, using the NAV history the MF tab already downloads (mfapi) and 5
years of daily closes from Yahoo for stocks/ETFs. Nothing is extrapolated: where a
held asset's history doesn't reach back far enough, the corpus line simply starts
later — the card says from when.

The **invested** line (money put in, at cost) runs underneath it over the full
history, so the gap between the two lines is your profit. Both series end exactly
on the Total Portfolio card's Current / Invested figures.

Holdings whose broker has no transaction sheet (Axis, Coin), or that no price
history could be found for, cannot be placed on a timeline, so they are carried as
a **constant baseline** — the level matches your real portfolio while every
month-over-month change still comes from a real transaction. The card names the
amount and the sources when this applies.

The dashed **projection** compounds forward: each month the corpus grows at the
assumed annual return and your monthly investment lands at month end. Both inputs
sit on the card — the monthly amount is prefilled with your own 6-month average
and can be typed over (try ₹1.5L), the return is a 8 / 10 / 12% switch. The ETA,
and the split of what's left between your contributions and growth, update with
them. The return is an assumption you dial in; it is never used to value anything
in the past.

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
