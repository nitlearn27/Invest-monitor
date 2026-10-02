// Generic sortable table. `columns` describe how to render + sort each field.
//   { key, label, align, render(row), sortValue(row), className }
import { useMemo, useState } from 'react'

export default function HoldingsTable({ columns, rows, initialSort, footer, rowClassName, rowStyle, className, mobileCards = false }) {
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
    <div className={`table-wrap card${className ? ` ${className}` : ''}${mobileCards ? ' table-wrap--mobile-cards' : ''}`}>
      {mobileCards && (
        <div className="holding-cards">
          <div className="holding-cards__sort">
            <label htmlFor="holding-card-sort">Sort by</label>
            <select
              id="holding-card-sort"
              className="search select"
              value={sort.key || ''}
              onChange={(event) => setSort({ key: event.target.value, dir: 'desc' })}
            >
              {columns.filter((col) => col.sortable !== false).map((col) => (
                <option key={col.key} value={col.key}>{col.label}</option>
              ))}
            </select>
            <button
              type="button"
              className="holding-cards__direction"
              onClick={() => setSort((s) => ({ ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' }))}
              aria-label={`Sort ${sort.dir === 'asc' ? 'descending' : 'ascending'}`}
              title={sort.dir === 'asc' ? 'Ascending' : 'Descending'}
            >
              {sort.dir === 'asc' ? '▲' : '▼'}
            </button>
          </div>
          <div className="holding-cards__list">
            {sorted.map((row, i) => (
              <article
                key={row.isin || row.key || i}
                className={`holding-card${rowClassName ? ` ${rowClassName(row) || ''}` : ''}`}
                style={rowStyle ? rowStyle(row) : undefined}
              >
                <h3 className="holding-card__name">{columns[0].render ? columns[0].render(row) : row[columns[0].key]}</h3>
                <dl className="holding-card__fields">
                  {columns.slice(1).map((col) => (
                    <div className="holding-card__field" key={col.key}>
                      <dt>{col.label}</dt>
                      <dd>{col.render ? col.render(row) : row[col.key]}</dd>
                    </div>
                  ))}
                </dl>
              </article>
            ))}
          </div>
        </div>
      )}
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
