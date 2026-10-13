import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/contexts/I18nContext'

export interface Column<T> {
  id: string
  header: ReactNode
  cell: (row: T) => ReactNode
  sortable?: boolean
  className?: string
  headerClassName?: string
  /** Hide below this breakpoint in table mode */
  hideBelow?: 'md' | 'lg' | 'xl'
  align?: 'start' | 'end'
}

interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  sort?: { id: string; dir: 'asc' | 'desc' }
  onSortChange?: (s: { id: string; dir: 'asc' | 'desc' }) => void
  /** Card rendering used on small screens */
  mobileRow?: (row: T) => ReactNode
  caption: string
  className?: string
  rowClassName?: (row: T) => string | undefined
}

const hide = { md: 'hidden md:table-cell', lg: 'hidden lg:table-cell', xl: 'hidden xl:table-cell' }

export function DataTable<T>({ columns, rows, rowKey, onRowClick, sort, onSortChange, mobileRow, caption, className, rowClassName }: DataTableProps<T>) {
  const { t } = useI18n()
  return (
    <div className={className}>
      {mobileRow && (
        <ul className="divide-y divide-line md:hidden">
          {rows.map((row) => (
            <li key={rowKey(row)}>
              {onRowClick ? (
                <button type="button" onClick={() => onRowClick(row)} className="block w-full px-4 py-3 text-start hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none">
                  {mobileRow(row)}
                </button>
              ) : <div className="px-4 py-3">{mobileRow(row)}</div>}
            </li>
          ))}
        </ul>
      )}
      <div className={cn('overflow-x-auto scroll-thin', mobileRow && 'hidden md:block')}>
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line bg-surface-2">
              {columns.map((c) => {
                const active = sort?.id === c.id
                return (
                  <th
                    key={c.id}
                    scope="col"
                    aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={cn('h-9 px-4 text-start text-xs font-medium text-fg-3 first:ps-5 last:pe-5', c.align === 'end' && 'text-end', c.hideBelow && hide[c.hideBelow], c.headerClassName)}
                  >
                    {c.sortable && onSortChange ? (
                      <button
                        type="button"
                        onClick={() => onSortChange({ id: c.id, dir: active && sort!.dir === 'asc' ? 'desc' : 'asc' })}
                        className="inline-flex items-center gap-1 rounded hover:text-fg-2 focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
                        aria-label={`${typeof c.header === 'string' ? c.header : ''} — ${t('common.sort')}`}
                      >
                        {c.header}
                        {active ? (sort!.dir === 'asc' ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />) : <ChevronsUpDown className="size-3.5 opacity-50" />}
                      </button>
                    ) : c.header}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? (e) => {
                  // Let inner links/buttons handle their own clicks.
                  if ((e.target as HTMLElement).closest('a,button,input,[role="menuitem"]')) return
                  onRowClick(row)
                } : undefined}
                onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onRowClick(row) } : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                className={cn(onRowClick && 'cursor-pointer hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none', rowClassName?.(row))}
              >
                {columns.map((c) => (
                  <td key={c.id} className={cn('h-14 px-4 align-middle first:ps-5 last:pe-5', c.align === 'end' && 'text-end', c.hideBelow && hide[c.hideBelow], c.className)}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
