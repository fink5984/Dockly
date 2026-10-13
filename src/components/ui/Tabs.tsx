import { useRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface TabItem {
  id: string
  label: ReactNode
  count?: number
  icon?: ReactNode
}

interface TabsProps {
  tabs: TabItem[]
  value: string
  onChange: (id: string) => void
  label: string
  className?: string
  variant?: 'line' | 'pill'
}

/** WAI-ARIA tabs with roving focus (arrow keys move & select, Home/End). */
export function Tabs({ tabs, value, onChange, label, className, variant = 'line' }: TabsProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const rtl = document.documentElement.dir === 'rtl'
    const next = (d: number) => {
      const n = (i + d + tabs.length) % tabs.length
      refs.current[n]?.focus()
      onChange(tabs[n].id)
    }
    if (e.key === (rtl ? 'ArrowLeft' : 'ArrowRight')) { e.preventDefault(); next(1) }
    if (e.key === (rtl ? 'ArrowRight' : 'ArrowLeft')) { e.preventDefault(); next(-1) }
    if (e.key === 'Home') { e.preventDefault(); refs.current[0]?.focus(); onChange(tabs[0].id) }
    if (e.key === 'End') { e.preventDefault(); refs.current[tabs.length - 1]?.focus(); onChange(tabs[tabs.length - 1].id) }
  }
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        'flex gap-1 overflow-x-auto scroll-thin',
        variant === 'line' ? 'border-b border-line' : 'rounded-lg bg-surface-3 p-1',
        className,
      )}
    >
      {tabs.map((tab, i) => {
        const selected = tab.id === value
        return (
          <button
            key={tab.id}
            ref={(el) => { refs.current[i] = el }}
            role="tab"
            type="button"
            id={`tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              'relative inline-flex shrink-0 items-center gap-2 whitespace-nowrap text-sm font-medium transition-colors focus-visible:outline-none',
              variant === 'line'
                ? cn('h-10 px-3 -mb-px border-b-2', selected ? 'border-brand-600 text-fg' : 'border-transparent text-fg-3 hover:text-fg-2 focus-visible:text-fg')
                : cn('h-8 rounded-md px-3', selected ? 'bg-surface text-fg shadow-xs' : 'text-fg-3 hover:text-fg-2'),
            )}
          >
            {tab.icon}
            {tab.label}
            {tab.count !== undefined && (
              <span className={cn('tabular rounded-full px-1.5 text-2xs font-semibold leading-4', selected ? 'bg-brand-soft text-brand-700' : 'bg-surface-3 text-fg-3')}>
                {tab.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export function TabPanel({ id, active, children, className }: { id: string; active: boolean; children: ReactNode; className?: string }) {
  if (!active) return null
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} tabIndex={0} className={cn('focus-visible:outline-none', className)}>
      {children}
    </div>
  )
}
