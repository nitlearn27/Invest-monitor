// Buying-pattern analysis for the Mutual Funds tab: per market-cap category,
// compare the value path of the user's actual INDmoney buys against "what if
// every one of those buys had gone into <candidate fund of the category>", plus
// a NAV-trend view (each fund rebased to 100, buys marked). Candidates are the
// top two funds of the category on INDmoney and on Coin. Data from whatif.js;
// the card chrome is shared with the equity tabs (WhatIfCard.jsx).
import { useMemo } from 'react'
import WhatIfSection from './WhatIfCard.jsx'
import { whatIfByCategory } from '../lib/whatif.js'
import { platformOf, platformKeyOf } from '../config.js'

// Series colours (validated for CVD + contrast on the app's dark navy surface).
// Each broker owns a hue pair, indexed by the fund's slot within that broker —
// so colour follows the fund, never its rank overall. Broker is double-encoded:
// Coin lines are dashed, INDmoney lines solid.
const FUND_COLORS = {
  indmoney: ['#18a3b8', '#c9b3ff'],
  coin: ['#c08618', '#e25663'],
}
const DASH = { coin: '5 3' }

// Drop the plan/option boilerplate every AMFI name carries, then the separators
// it leaves stranded ("DSP Midcap Fund - Direct Plan - Growth" → "DSP Midcap").
const shortName = (name) =>
  name
    .replace(/\b(fund|direct|regular|growth|plan|option|scheme)\b/gi, ' ')
    .replace(/[-–—·|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

// A fund's label carries its broker — the same scheme can sit on either
// platform — and flags Regular plan, whose NAV grows ~1%/yr slower purely on
// commission. Direct is the norm here, so only the exception is called out.
const planTag = (plan) => (plan === 'Regular' ? ' (Reg)' : '')
const brokerOf = (f) => platformOf(f.source)?.label ?? f.source

const SPEC = {
  noun: 'fund',
  colHead: 'Fund',
  trendLabel: 'NAV trend',
  historyNoun: 'NAV',
  shorten: shortName,
  colorOf: (f) => FUND_COLORS[platformKeyOf(f.source ?? f.chartSource)]?.[f.slot] ?? '#5b8cff',
  dashOf: (f) => DASH[platformKeyOf(f.source ?? f.chartSource)] ?? null,
  brokerOf,
  shortLabel: (f) => `${shortName(f.name)}${planTag(f.plan)}`,
  fullLabel: (f) => `${shortName(f.name)}${planTag(f.plan)} · ${brokerOf(f)}`,
  tagOf: (r) => (r.plan === 'Regular' ? 'Reg' : null),
  note: 'Tap a column to sort · % return · 3Y annualised · Reg = Regular plan (higher fees)',
}

export default function MfWhatIf({ mfTransactions = [], holdings = [], navMap }) {
  const cards = useMemo(
    () => whatIfByCategory(mfTransactions, navMap, holdings),
    [mfTransactions, navMap, holdings],
  )
  return <WhatIfSection cards={cards} spec={SPEC} intro="Which fund is actually winning, per category." />
}
