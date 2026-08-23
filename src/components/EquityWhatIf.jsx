// Buying-pattern analysis for the Stocks and ETF tabs — the equity twin of
// MfWhatIf. One card per asset class: the user's real buys replayed against
// "what if all of it had gone into <top scrip>", a price-trend view with the
// buys marked, and a returns leaderboard over every scrip they hold. Data from
// whatif.js's equityWhatIf; the card chrome is shared (WhatIfCard.jsx).
import { useMemo } from 'react'
import WhatIfSection from './WhatIfCard.jsx'
import { equityWhatIf } from '../lib/whatif.js'

// A scrip prices the same wherever it was bought, so candidates are one per
// symbol and colour is keyed to the scrip's rank — the same four hues the fund
// cards use, CVD-validated as a set on the navy surface. Nothing is dashed:
// with broker no longer separating two series, a dash would encode nothing.
const SCRIP_COLORS = ['#18a3b8', '#c9b3ff', '#c08618', '#e25663']

// Names arrive spelled the way each broker's orders page spells them; trim the
// wrapper words so the legend reads as the scrip, not the product.
const shortName = (name) =>
  name
    .replace(/\b(limited|ltd|the)\b\.?/gi, ' ')
    .replace(/[-–—·|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const SPEC = {
  noun: 'holding',
  colHead: 'Scrip',
  trendLabel: 'Price trend',
  historyNoun: 'price',
  shorten: shortName,
  colorOf: (f) => SCRIP_COLORS[f.slot % SCRIP_COLORS.length] ?? '#5b8cff',
  dashOf: () => null,
  // No broker on the series labels: a scrip prices the same wherever it is
  // held, so "All-in Infosys · Groww" would imply the counterfactual depends on
  // the platform. (The fund cards DO carry it — there the plan, and therefore
  // the NAV, really is per broker.) Where the position sits is still shown:
  // the leaderboard rows below carry a dot per broker.
  brokerOf: () => null,
  shortLabel: (f) => shortName(f.name),
  fullLabel: (f) => shortName(f.name),
  tagOf: () => null,
  note: 'Tap a column to sort · % price return · 3Y annualised · dividends not included',
}

export default function EquityWhatIf({ type, label, transactions = [], holdings = [], priceHistory }) {
  const cards = useMemo(
    () => equityWhatIf({ transactions, holdings, priceHistory, type, label }),
    [transactions, holdings, priceHistory, type, label],
  )
  return (
    <WhatIfSection
      cards={cards}
      spec={SPEC}
      intro={`Which ${type === 'etf' ? 'ETFs' : 'stocks'} are actually winning, and how your buys were timed.`}
    />
  )
}
