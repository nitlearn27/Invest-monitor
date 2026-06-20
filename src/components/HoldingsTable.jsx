// Generic sortable table. `columns` describe how to render + sort each field.
//   { key, label, align, render(row), sortValue(row), className }
import { useMemo, useState } from 'react'

export default function HoldingsTable({ columns, rows, initialSort, footer, rowClassName, rowStyle }) {
  const [sort, setSort] = useState(initialSort || { key: null, dir: 'desc' })

  const sorted = useMemo(() => {
    if (!sort.key) return rows
    const colDef = columns.find((c) => c.key === sort.key)
    const valueOf = colDef?.sortValue || ((r) => r[sort.key])
    const out = [...rows].sort((a, b) => {
      const av = valueOf(a)
      const bv = valueOf(b)
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') return av - bv
      return String(av).localeCompare(String(bv))
    })
    return sort.dir === 'desc' ? out.reverse() : out
  }, [rows, sort, columns])

  const toggle = (key) =>
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' },
    )

  return (
    <div className="table-wrap card">
      <table className="table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={`${col.align === 'right' ? 'ta-r' : ''} ${
                  col.sortable === false ? '' : 'th--sortable'
                }`}
                onClick={col.sortable === false ? undefined : () => toggle(col.key)}
              >
                {col.label}
                {sort.key === col.key && (
                  <span className="th__arrow">{sort.dir === 'asc' ? '▲' : '▼'}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr
              key={row.isin || row.key || i}
              className={rowClassName ? rowClassName(row) : undefined}
              style={rowStyle ? rowStyle(row) : undefined}
            >
              {columns.map((col) => (
                <td key={col.key} className={`${col.align === 'right' ? 'ta-r' : ''} ${col.className || ''}`}>
                  {col.render ? col.render(row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
    </div>
  )
}
