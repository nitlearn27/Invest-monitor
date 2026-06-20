// Detect INDmoney report types by sheet/header content and normalize rows into
// a common shape. Files are identified by their columns, NOT their filename.

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

// --- "My MFs" page (current MF portfolio). Concatenated rows under a
// "Gain/ Loss" marker, e.g.:
//   "ICICI ... GrowthInvested₹4.14LCurrent Value₹8.09LGain/ Loss₹3.95L▲95.33%"
const MYMF_RE = /^(.*?)invested₹(-?[\d.,]+(?:cr|l|k)?)current value₹(-?[\d.,]+(?:cr|l|k)?)gain\/\s*loss₹(-?[\d.,]+(?:cr|l|k)?)(▲|▼)([\d.]+)%/i

function parseMyMfs(sheet) {
  const holdings = []
  for (const row of sheet.rows) {
    for (const cell of row || []) {
      if (cell == null) continue
      const m = String(cell).match(MYMF_RE)
      if (!m) continue
      const [, name, inv, cur, gl] = m
      const invested = parseMoney(inv)
      const current = parseMoney(cur)
      const pnl = parseMoney(gl)
      holdings.push({
        name: name.trim(),
        isin: null,
        type: 'mf',
        qty: null,
        avgPrice: null,
        invested,
        current,
        pnl,
        pnlPct: pnl != null && invested ? (pnl / invested) * 100 : null,
        folio: null,
        source: 'My MFs',
      })
    }
  }
  return holdings.length ? { holdings } : null
}

// --- "My MF Coin" page (Zerodha Coin current MF holdings, copy-pasted into a
// Google Sheet). Unlike INDmoney's single-cell rows, Coin lays each fund out as
// a fixed block of single-column cells:
//   <Fund name>
//   Growth<Equity|Others|…><Sub-category>   e.g. "GrowthEquityMid Cap"
//   <avg NAV>        (number)
//   <current NAV>    (number)
//   <invested>       "4,39,977.88"
//   <current value>  "5,13,048.48"
//   <P&L><P&L%>      "73,070.5916.61"  (concatenated — we recompute instead)
//   <day P&L><day%>  "3,705.980.73"
// Detected by the category row; P&L is recomputed as current − invested.
const COIN_CAT_RE = /^(growth|idcw|dividend|payout|reinvest)[a-z ]*?(equity|others|debt|hybrid|liquid)/i

function parseCoinMfs(sheet) {
  const rows = sheet.rows
  const cell = (i) => (rows[i] && rows[i][0] != null ? String(rows[i][0]).trim() : '')
  const holdings = []
  for (let i = 1; i < rows.length; i++) {
    if (!COIN_CAT_RE.test(cell(i))) continue // category row marks a fund block
    const name = cell(i - 1)
    if (!name) continue
    const invested = parseMoney(cell(i + 3))
    const current = parseMoney(cell(i + 4))
    if (invested == null && current == null) continue
    const pnl = invested != null && current != null ? current - invested : null
    holdings.push({
      name,
      isin: null,
      type: 'mf',
      qty: null,
      avgPrice: toNum(cell(i + 1)),
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
// "Fund Name | (blank) | Invested Amount | Current Amount". Values are compact
// (e.g. "1.5 L", "75K"); there's no Gain/Loss column, so P&L is derived.
function parseAxisMfs(sheet) {
  const header = findHeader(sheet.rows, ['fund name', 'invested amount', 'current amount'])
  if (!header) return null
  const c = {
    name: col(header.colMap, 'fund name'),
    invested: col(header.colMap, 'invested amount', 'invested'),
    current: col(header.colMap, 'current amount', 'current'),
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
      qty: null,
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
    holdings.push({
      name,
      isin: null,
      symbol: null,
      type: classifyEquity(name, null),
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
      qty: null,
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

// --- "My Stocks" page (current stocks + ETFs). A real table with header
// "Stock Name | Market Price | Invested (Qty/Price) | Current value | Total PnL".
function parseMyStocks(sheet) {
  const header = findHeader(sheet.rows, ['stock name', 'market price', 'current value'])
  if (!header) return null
  const c = {
    name: col(header.colMap, 'stock name'),
    invested: col(header.colMap, 'invested'),
    current: col(header.colMap, 'current value'),
  }
  const holdings = []
  for (let i = header.index + 1; i < sheet.rows.length; i++) {
    const row = sheet.rows[i] || []
    const nameCell = row[c.name]
    const investedCell = row[c.invested]
    if (!nameCell || !/qty/i.test(String(investedCell || ''))) {
      if (holdings.length) break // table ended
      continue
    }
    const nameParts = String(nameCell).split('\n').map((s) => s.trim()).filter(Boolean)
    const name = nameParts[0]
    const symbol = nameParts[1] || null
    const lines = String(investedCell).split('\n').map((s) => s.trim()).filter(Boolean)
    const invested = parseMoney(lines[0])
    const qtyLine = lines.find((l) => /qty/i.test(l))
    const qty = qtyLine ? toNum(qtyLine.replace(/qty/i, '')) : null
    const avgLine = lines.find((l) => /avg/i.test(l))
    const avgPrice = avgLine ? parseMoney(avgLine.replace(/avg\.?/i, '')) : null
    const current = parseMoney(row[c.current])
    const pnl = invested != null && current != null ? current - invested : null
    holdings.push({
      name,
      isin: null,
      symbol,
      type: classifyEquity(name, symbol),
      qty,
      avgPrice,
      invested,
      current,
      pnl,
      pnlPct: pnl != null && invested ? (pnl / invested) * 100 : null,
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
    for (const sheet of file.sheets) {
      const myStocks = parseMyStocks(sheet)
      if (myStocks) {
        holdings.push(...myStocks.holdings)
        recognized.push({ file: file.fileName, sheet: sheet.name, type: 'my-stocks' })
        continue
      }
      const myMfs = parseMyMfs(sheet)
      if (myMfs) {
        holdings.push(...myMfs.holdings)
        recognized.push({ file: file.fileName, sheet: sheet.name, type: 'my-mfs' })
        continue
      }
      const coinMfs = parseCoinMfs(sheet)
      if (coinMfs) {
        holdings.push(...coinMfs.holdings)
        recognized.push({ file: file.fileName, sheet: sheet.name, type: 'coin-mfs' })
        continue
      }
      const axisMfs = parseAxisMfs(sheet)
      if (axisMfs) {
        holdings.push(...axisMfs.holdings)
        recognized.push({ file: file.fileName, sheet: sheet.name, type: 'axis-mfs' })
        continue
      }
      const growwStocks = parseGrowwStocks(sheet)
      if (growwStocks) {
        holdings.push(...growwStocks.holdings)
        recognized.push({ file: file.fileName, sheet: sheet.name, type: 'groww-stocks' })
        continue
      }
      const growwMfs = parseGrowwMfs(sheet)
      if (growwMfs) {
        holdings.push(...growwMfs.holdings)
        recognized.push({ file: file.fileName, sheet: sheet.name, type: 'groww-mfs' })
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
