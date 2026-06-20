// Row-tint hooks for colour-coding holdings by their broker platform. Passed to
// HoldingsTable (`rowClassName`/`rowStyle`) and reused on the Consolidated bar
// rows; the colours are mapped back to names by `SourceLegend`.
import { platformOf } from '../config.js'

export const sourceRowClassName = (row) => (platformOf(row.source) ? 'row--source' : undefined)

export const sourceRowStyle = (row) => {
  const p = platformOf(row.source)
  return p ? { '--src': p.color } : undefined
}
