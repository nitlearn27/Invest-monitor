// Detect INDmoney report types by sheet/header content and normalize rows into
// a common shape. Files are identified by their columns, NOT their filename.

import NAME_SYMBOLS from '../../resources/name-symbols.json'

const norm = (v) => (v == null ? '' : String(v).trim().toLowerCase())

const toNum = (v) => {
  if (v == null || v === '') return null
  if (typeof v === 'number') return v
  const n = parseFloat(String(v).replace(/,/g, ''))
  return Number.isNaN(n) ? null : n
}

// Find the first row whose cells contain all required header keywords.
// Returns { index, colMap } where colMap maps a normalized header label to its
// column index, or null if not found.
function findHeader(rows, required) {
  for (let i = 0; i < rows.length; i++) {
    const cells = (rows[i] || []).map(norm)
    const hit = required.every((key) => cells.some((c) => c.includes(key)))
    if (hit) {
      const colMap = {}
      cells.forEach((c, idx) => {
        if (c) colMap[c] = idx
      })
      return { index: i, colMap }
    }
  }
  return null
}

// Resolve a column index by matching any of the candidate substrings.
function col(colMap, ...candidates) {
  for (const cand of candidates) {
    for (const key of Object.keys(colMap)) {
      if (key.includes(cand)) return colMap[key]
    }
  }
  return -1
}

// --- MF transactions (INDmoney "My Mutual Funds → Transactions" page, pasted
// into a Google Sheet). Each transaction is one concatenated string in the
// column under a "Buy/Sell" marker cell, e.g.:
//   "Invesco India Mid Cap FundBuy SuccessfulOrder Date08 Jun 2026Units91.04 (Nav 219.68)Amount₹20K"
// We detect by that marker (not filename) and ignore everything else on the page.
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }

function parseDmy(s) {
  const m = String(s).match(/(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/)
  if (!m) return null
  const mon = MONTHS[m[2].slice(0, 3).toLowerCase()]
  if (mon == null) return null
  return new Date(Number(m[3]), mon, Number(m[1]))
}

function suffixMul(s) {
  const u = (s || '').toLowerCase()
  if (u.startsWith('cr')) return 1e7
  if (u.startsWith('l')) return 1e5
  if (u.startsWith('k')) return 1e3
  return 1
}

// Parse INDmoney money strings: "₹2,27,232.68", "₹4.14L", "₹-3.04K", "-781.37".
function parseMoney(v) {
  if (v == null) return null
  let s = String(v).replace(/[₹,\s]/g, '')
  const neg = s.startsWith('-')
  if (neg) s = s.slice(1)
  const m = s.match(/^([\d.]+)\s*(cr|l|k)?/i)
  if (!m) return null
  const n = parseFloat(m[1])
  if (Number.isNaN(n)) return null
  const val = n * suffixMul(m[2] || '')
  return neg ? -val : val
}

// Stocks vs ETFs (no ISIN in these sheets) — classify by name/symbol keywords.
const ETF_KEYWORDS = ['etf', 'nasdaq', 'nifty', 'bees', 'sensex', 'next50', 'setf', 'mon100', 'n100', 'beta']
function classifyEquity(name, symbol) {
  const s = `${name || ''} ${symbol || ''}`.toLowerCase()
  return ETF_KEYWORDS.some((k) => s.includes(k)) ? 'etf' : 'stock'
}

const MF_TXN_RE =
  /^(.*?)(buy|sell)\s+successful.*?order date\s*(\d{1,2}\s+[a-z]{3,}\s+\d{4}).*?units\s*([\d.]+).*?\(nav\s*([\d.]+)\)(?:.*?amount\s*₹\s*([\d.,]+)\s*([a-z]*))?/i

function parseMfTransactions(sheet) {
  // Locate the "Buy/Sell" marker cell; transactions sit below it in that column.
  let marker = null
  for (let i = 0; i < sheet.rows.length && !marker; i++) {
    const row = sheet.rows[i] || []
    for (let j = 0; j < row.length; j++) {
      if (norm(row[j]) === 'buy/sell') {
        marker = { row: i, col: j }
        break
      }
    }
  }
  if (!marker) return null

  const transactions = []
  for (let i = marker.row + 1; i < sheet.rows.length; i++) {
    const cell = (sheet.rows[i] || [])[marker.col]
    if (cell == null) continue
    const m = String(cell).match(MF_TXN_RE)
    if (!m) continue // skips SIP/Switch/STP tabs and promo rows
    const [, name, side, dateStr, unitsStr, navStr, amtStr, amtSuf] = m
    const units = toNum(unitsStr)
    const nav = toNum(navStr)
    let amount = units != null && nav != null ? units * nav : null
    if (amount == null && amtStr) amount = toNum(amtStr) * suffixMul(amtSuf)
    transactions.push({
      date: parseDmy(dateStr),
      name: name.trim(),
      side: side.toUpperCase(),
      units,
      nav,
      amount: amount != null ? Math.round(amount) : null,
    })
  }
  return transactions.length ? { transactions } : null
}

// --- "My MFs" page (current MF portfolio). Now a real table with header
// "Fund Name | Invested | Current Value | Units". Values are compact (e.g.
// "₹4.14L"), and so are the Units (e.g. "3K" = 3000, "7.61K"), so both go
// through parseMoney. P&L is derived from current − invested; `units` → qty
// drives the live-NAV valuation (current = units × NAV) in navs.js.
//
// Detected LAST among the MF tables (see buildDataset): its loose header tokens
// (fund name / invested / current value) are substrings of the Coin and Groww
// headers, so those must be tried first.
function parseMyMfs(sheet) {
  const header = findHeader(sheet.rows, ['fund name', 'invested', 'current value', 'units'])
  if (!header) return null
  const c = {
    name: col(header.colMap, 'fund name'),
    invested: col(header.colMap, 'invested'),
    current: col(header.colMap, 'current value', 'current'),
    units: col(header.colMap, 'units'),
  }
  const holdings = []
  for (let i = header.index + 1; i < sheet.rows.length; i++) {
    const row = sheet.rows[i] || []
    const name = row[c.name] == null ? '' : String(row[c.name]).trim()
    if (!name) {
      if (holdings.length) break // table ended
      continue
    }
    const invested = parseMoney(row[c.invested])
    const current = parseMoney(row[c.current])
    if (invested == null && current == null) continue
    const pnl = invested != null && current != null ? current - invested : null
    holdings.push({
      name,
      isin: null,
      type: 'mf',
      qty: parseMoney(row[c.units]),
      avgPrice: null,
      invested,
      current,
      pnl,
      pnlPct: pnl != null && invested ? (pnl / invested) * 100 : null,
      folio: null,
      source: 'My MFs',
    })
  }
  return holdings.length ? { holdings } : null
}

// --- "My MF Coin" page (Zerodha Coin current MF holdings, copy-pasted into a
// Google Sheet). Now a real table with header
// "Mutual Fund Name | Invested Amount (₹) | Current Value (₹) | Units". Detected
// by the distinctive "mutual fund name" header; P&L is derived from
// current − invested. `units` → qty drives the live-NAV valuation in navs.js.
function parseCoinMfs(sheet) {
  const header = findHeader(sheet.rows, ['mutual fund name', 'invested amount', 'units'])
  if (!header) return null
  const c = {
    name: col(header.colMap, 'mutual fund name', 'fund name'),
    invested: col(header.colMap, 'invested amount', 'invested'),
    current: col(header.colMap, 'current value', 'current'),
    units: col(header.colMap, 'units'),
  }
  const holdings = []
  for (let i = header.index + 1; i < sheet.rows.length; i++) {
    const row = sheet.rows[i] || []
    const name = row[c.name] == null ? '' : String(row[c.name]).trim()
    if (!name) {
      if (holdings.length) break // table ended
      continue
    }
    const invested = parseMoney(row[c.invested])
    const current = parseMoney(row[c.current])
    if (invested == null && current == null) continue
    const pnl = invested != null && current != null ? current - invested : null
    holdings.push({
      name,
      isin: null,
      type: 'mf',
      qty: parseMoney(row[c.units]),
      avgPrice: null,
      invested,
      current,
      pnl,
      pnlPct: pnl != null && invested ? (pnl / invested) * 100 : null,
      folio: null,
      source: 'My MF Coin',
    })
  }
  return holdings.length ? { holdings } : null
}

// --- "Axis Bank MF" page (regular-plan MFs bought via Axis Bank, copy-pasted
// into a Google Sheet). A simple table with header
// "Fund Name | units | Invested Amount | Current Amount". Values are compact
// (e.g. "1.5 L", "75K"); there's no Gain/Loss column, so P&L is derived. `units`
// → qty drives the live-NAV valuation (current = units × NAV) in navs.js.
function parseAxisMfs(sheet) {
  const header = findHeader(sheet.rows, ['fund name', 'invested amount', 'current amount'])
  if (!header) return null
  const c = {
    name: col(header.colMap, 'fund name'),
    invested: col(header.colMap, 'invested amount', 'invested'),
    current: col(header.colMap, 'current amount', 'current'),
    units: col(header.colMap, 'units'),
  }
  const holdings = []
  for (let i = header.index + 1; i < sheet.rows.length; i++) {
    const row = sheet.rows[i] || []
    const name = row[c.name] == null ? '' : String(row[c.name]).trim()
    if (!name) {
      if (holdings.length) break // table ended
      continue
    }
    const invested = parseMoney(row[c.invested])
    const current = parseMoney(row[c.current])
    if (invested == null && current == null) continue
    const pnl = invested != null && current != null ? current - invested : null
    holdings.push({
      name,
      isin: null,
      type: 'mf',
      qty: parseMoney(row[c.units]),
      avgPrice: null,
      invested,
      current,
      pnl,
      pnlPct: pnl != null && invested ? (pnl / invested) * 100 : null,
      folio: null,
      source: 'Axis Bank MF',
    })
  }
  return holdings.length ? { holdings } : null
}

// The Groww sheet lists holdings by "Company": sometimes that's already the NSE
// ticker (e.g. NIFTYBEES), sometimes a descriptive ETF name with no ticker. We
// derive a symbol so live prices can be fetched: use the name as-is when it looks
// like a ticker, else map known descriptive names to their NSE ticker.
const TICKER_RE = /^[A-Z0-9&-]{2,}$/
function growwSymbol(name) {
  const key = name.toLowerCase().trim()
  if (NAME_SYMBOLS.groww[key]) return NAME_SYMBOLS.groww[key]
  return TICKER_RE.test(name.trim()) ? name.trim() : null
}

// --- "Stocks Groww" page (stocks + ETFs held on Groww, copy-pasted into a Google
// Sheet). A real table with header
// "Company | Shares | Avg. Price | Market Price | Returns (Amt) | Returns (%) |
//  Current Value | Invested Value". Returns (Amt) is often "#ERROR!", so P&L is
// derived from current − invested. Stock vs ETF via classifyEquity (no ISIN).
function parseGrowwStocks(sheet) {
  const header = findHeader(sheet.rows, ['company', 'shares', 'invested value'])
  if (!header) return null
  const c = {
    name: col(header.colMap, 'company'),
    qty: col(header.colMap, 'shares'),
    avg: col(header.colMap, 'avg'),
    invested: col(header.colMap, 'invested value', 'invested'),
    current: col(header.colMap, 'current value', 'current'),
  }
  const holdings = []
  for (let i = header.index + 1; i < sheet.rows.length; i++) {
    const row = sheet.rows[i] || []
    const name = row[c.name] == null ? '' : String(row[c.name]).trim()
    if (!name) {
      if (holdings.length) break // table ended
      continue
    }
    const invested = parseMoney(row[c.invested])
    const current = parseMoney(row[c.current])
    if (invested == null && current == null) continue
    const pnl = invested != null && current != null ? current - invested : null
    const symbol = growwSymbol(name)
    holdings.push({
      name,
      isin: null,
      symbol,
      type: classifyEquity(name, symbol),
      qty: toNum(row[c.qty]),
      avgPrice: parseMoney(row[c.avg]),
      invested,
      current,
      pnl,
      pnlPct: pnl != null && invested ? (pnl / invested) * 100 : null,
      folio: null,
      source: 'Stocks Groww',
    })
  }
  return holdings.length ? { holdings } : null
}

// --- "MF Groww" page (mutual funds held on Groww, copy-pasted into a Google
// Sheet). A real table with header
// "Fund Name | XIRR (%) | Day Change (Amt) | Day Change (%) | Returns (Amt) |
//  Returns (%) | Current Value | Invested Value". P&L is derived from
// current − invested.
function parseGrowwMfs(sheet) {
  const header = findHeader(sheet.rows, ['fund name', 'invested value', 'current value'])
  if (!header) return null
  const c = {
    name: col(header.colMap, 'fund name'),
    invested: col(header.colMap, 'invested value', 'invested'),
    current: col(header.colMap, 'current value', 'current'),
    units: col(header.colMap, 'units'),
  }
  const holdings = []
  for (let i = header.index + 1; i < sheet.rows.length; i++) {
    const row = sheet.rows[i] || []
    const name = row[c.name] == null ? '' : String(row[c.name]).trim()
    if (!name) {
      if (holdings.length) break // table ended
      continue
    }
    const invested = parseMoney(row[c.invested])
    const current = parseMoney(row[c.current])
    if (invested == null && current == null) continue
    const pnl = invested != null && current != null ? current - invested : null
    holdings.push({
      name,
      isin: null,
      type: 'mf',
      qty: parseMoney(row[c.units]),
      avgPrice: null,
      invested,
      current,
      pnl,
      pnlPct: pnl != null && invested ? (pnl / invested) * 100 : null,
      folio: null,
      source: 'MF Groww',
    })
  }
  return holdings.length ? { holdings } : null
}

// My Stocks lists descriptive fund/company names with no ticker, so map them to
// their NSE symbol for live pricing. Maps live in resources/name-symbols.json
// (hand-maintained); add a line there when a new INDmoney holding appears.
function indStocksSymbol(name) {
  const key = name.toLowerCase().trim()
  if (NAME_SYMBOLS.indmoney[key]) return NAME_SYMBOLS.indmoney[key]
  return TICKER_RE.test(name.trim()) ? name.trim() : null
}

// --- "My Stocks" page (current stocks + ETFs). A real table with header
// "Stock Name | Quantity | Avg. Price". Invested is derived (qty × avgPrice);
// the sheet no longer carries Market Price / Current value — those come live.
function parseMyStocks(sheet) {
  const header = findHeader(sheet.rows, ['stock name', 'quantity', 'avg'])
  if (!header) return null
  const c = {
    name: col(header.colMap, 'stock name', 'name'),
    qty: col(header.colMap, 'quantity', 'qty'),
    avg: col(header.colMap, 'avg'),
  }
  const holdings = []
  for (let i = header.index + 1; i < sheet.rows.length; i++) {
    const row = sheet.rows[i] || []
    const name = row[c.name] == null ? '' : String(row[c.name]).trim()
    const qty = toNum(row[c.qty])
    if (!name || qty == null) {
      if (holdings.length) break // table ended
      continue
    }
    const avgPrice = parseMoney(row[c.avg])
    const invested = avgPrice != null ? qty * avgPrice : null
    const symbol = indStocksSymbol(name)
    holdings.push({
      name,
      isin: null,
      symbol,
      type: classifyEquity(name, symbol),
      qty,
      avgPrice,
      invested,
      // current/pnl recomputed from the live price in enrichHoldings (the sheet
      // no longer carries a Current value); stay null until then.
      current: null,
      pnl: null,
      pnlPct: null,
      folio: null,
      source: 'My Stocks',
    })
  }
  return holdings.length ? { holdings } : null
}

// --- "Stocks Transactions" page (stock/ETF orders). Orders grouped under
// ordinal date headers like "8th Jun'26" / "30th Sept'25"; each transaction row
// has "N Qty" in col 1 and a "Buy/Sell Executed" status in col 4.
const ORD_DATE_RE = /^(\d{1,2})(?:st|nd|rd|th)\s+([A-Za-z]+)'(\d{2})$/
const QTY_RE = /([\d.,]+)\s*qty/i

function parseStockTransactions(sheet) {
  const transactions = []
  let curDate = null
  for (const row of sheet.rows) {
    if (!row) continue
    const s0 = row[0] == null ? '' : String(row[0]).trim()
    const dm = s0.match(ORD_DATE_RE)
    if (dm) {
      const mon = MONTHS[dm[2].slice(0, 3).toLowerCase()]
      if (mon != null) curDate = new Date(2000 + Number(dm[3]), mon, Number(dm[1]))
      continue
    }
    const c1 = row[1]
    const c4 = row[4]
    if (!c1 || !/qty/i.test(String(c1))) continue
    if (!c4 || !/executed/i.test(String(c4))) continue
    const name = s0.split('\n')[0].trim()
    const qm = String(c1).match(QTY_RE)
    transactions.push({
      date: curDate,
      name,
      symbol: null,
      isin: null,
      type: classifyEquity(name, null),
      side: /sell/i.test(String(c4)) ? 'SELL' : 'BUY',
      qty: qm ? toNum(qm[1]) : null,
      price: parseMoney(row[3]),
      status: String(c4).trim(),
    })
  }
  return transactions.length ? { transactions } : null
}

// --- "Projection" page (goal tracking). A table with header
// "Name | Amount -2025 Dec | 2026-Dec | Current | Shortfall | Sheets". The
// Sheets column names which holding `source`s feed each goal (Current/Shortfall
// are computed in projection.js, not read from the sheet).
function parseProjection(sheet) {
  const header = findHeader(sheet.rows, ['name', '2026', 'sheets'])
  if (!header) return null
  const c = {
    name: col(header.colMap, 'name'),
    target2026: col(header.colMap, '2026'),
    baseline2025: col(header.colMap, '2025'),
    sheets: col(header.colMap, 'sheets'),
  }
  const rows = []
  for (let i = header.index + 1; i < sheet.rows.length; i++) {
    const row = sheet.rows[i] || []
    const name = row[c.name] == null ? '' : String(row[c.name]).trim()
    if (!name) {
      if (rows.length) break // table ended
      continue
    }
    rows.push({
      name,
      baseline2025: toNum(row[c.baseline2025]),
      target2026: toNum(row[c.target2026]),
      sheetsRaw: row[c.sheets] == null ? '' : String(row[c.sheets]).trim(),
    })
  }
  return rows.length ? { rows } : null
}

// Classify a list of parsed workbooks and merge into a single dataset.
export function buildDataset(parsedFiles) {
  const holdings = []
  const transactions = []
  const mfTransactions = []
  const projection = []
  const recognized = []

  for (const file of parsedFiles) {
    // The sheet's snapshot date (Drive last-modified). Stamped onto every holding
    // as `asOf` so live MF NAV can back out units from the stale Current value.
    const asOf = file.modifiedTime ? new Date(file.modifiedTime) : null
    const addHoldings = (hs) => holdings.push(...hs.map((h) => ({ ...h, asOf })))
    for (const sheet of file.sheets) {
      const myStocks = parseMyStocks(sheet)
      if (myStocks) {
        addHoldings(myStocks.holdings)
        recognized.push({ file: file.fileName, sheet: sheet.name, type: 'my-stocks' })
        continue
      }
      const coinMfs = parseCoinMfs(sheet)
      if (coinMfs) {
        addHoldings(coinMfs.holdings)
        recognized.push({ file: file.fileName, sheet: sheet.name, type: 'coin-mfs' })
        continue
      }
      const axisMfs = parseAxisMfs(sheet)
      if (axisMfs) {
        addHoldings(axisMfs.holdings)
        recognized.push({ file: file.fileName, sheet: sheet.name, type: 'axis-mfs' })
        continue
      }
      const growwStocks = parseGrowwStocks(sheet)
      if (growwStocks) {
        addHoldings(growwStocks.holdings)
        recognized.push({ file: file.fileName, sheet: sheet.name, type: 'groww-stocks' })
        continue
      }
      const growwMfs = parseGrowwMfs(sheet)
      if (growwMfs) {
        addHoldings(growwMfs.holdings)
        recognized.push({ file: file.fileName, sheet: sheet.name, type: 'groww-mfs' })
        continue
      }
      // My MFs runs LAST among the MF tables: its loose header tokens are
      // substrings of the Coin/Groww headers, so those must match first.
      const myMfs = parseMyMfs(sheet)
      if (myMfs) {
        addHoldings(myMfs.holdings)
        recognized.push({ file: file.fileName, sheet: sheet.name, type: 'my-mfs' })
        continue
      }
      const proj = parseProjection(sheet)
      if (proj) {
        projection.push(...proj.rows)
        recognized.push({ file: file.fileName, sheet: sheet.name, type: 'projection' })
        continue
      }
      const stockTxn = parseStockTransactions(sheet)
      if (stockTxn) {
        transactions.push(...stockTxn.transactions)
        recognized.push({ file: file.fileName, sheet: sheet.name, type: 'stock-transactions' })
        continue
      }
      const mfTxn = parseMfTransactions(sheet)
      if (mfTxn) {
        mfTransactions.push(...mfTxn.transactions)
        recognized.push({ file: file.fileName, sheet: sheet.name, type: 'mf-transactions' })
      }
    }
  }

  const byDateDesc = (a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0)
  transactions.sort(byDateDesc)
  mfTransactions.sort(byDateDesc)

  return {
    holdings,
    transactions,
    mfTransactions,
    projection,
    meta: { recognized },
  }
}
