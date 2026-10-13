import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { IconButton } from './Button'

export interface MenuItem {
  label: string
  icon?: ReactNode
  onSelect: () => void
  tone?: 'default' | 'danger'
  disabled?: boolean
  hint?: string
}
export type MenuEntry = MenuItem | 'separator' | { heading: string }

interface MenuProps {
  items: MenuEntry[]
  /** Custom trigger; receives props to spread onto a button */
  trigger?: (p: { ref: (el: HTMLElement | null) => void; onClick: () => void; 'aria-haspopup': 'menu'; 'aria-expanded': boolean; 'aria-controls': string }) => ReactNode
  label?: string
  align?: 'start' | 'end'
  className?: string
}

/**
 * Accessible dropdown menu: arrow keys, Home/End, Escape, typeahead,
 * logical alignment (start/end flip with direction) and viewport flipping.
 */
export function Menu({ items, trigger, label = 'More actions', align = 'end', className }: MenuProps) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const anchor = useRef<HTMLElement | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const id = useId()
  const actionable = items.filter((i): i is MenuItem => typeof i === 'object' && 'onSelect' in i)

  const close = (focusTrigger = true) => {
    setOpen(false)
    if (focusTrigger) anchor.current?.focus()
  }

  useLayoutEffect(() => {
    if (!open || !anchor.current || !panel.current) return
    const r = anchor.current.getBoundingClientRect()
    const p = panel.current.getBoundingClientRect()
    const rtl = document.documentElement.dir === 'rtl'
    const alignEnd = (align === 'end') !== rtl
    let left = alignEnd ? r.right - p.width : r.left
    left = Math.max(8, Math.min(left, window.innerWidth - p.width - 8))
    let top = r.bottom + 4
    if (top + p.height > window.innerHeight - 8) top = Math.max(8, r.top - p.height - 4)
    setPos({ top, left })
  }, [open, align])

  useEffect(() => {
    if (!open) return
    const first = panel.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')
    first?.focus()
    const onDown = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node)) close(false)
    }
    const onScroll = () => close(false)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('resize', onScroll)
    }
  }, [open])

  const onKeyDown = (e: React.KeyboardEvent) => {
    const els = Array.from(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') || [])
    const idx = els.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'ArrowDown') { e.preventDefault(); els[(idx + 1) % els.length]?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); els[(idx - 1 + els.length) % els.length]?.focus() }
    else if (e.key === 'Home') { e.preventDefault(); els[0]?.focus() }
    else if (e.key === 'End') { e.preventDefault(); els[els.length - 1]?.focus() }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); close() }
    else if (e.key.length === 1) {
      const match = els.find((el) => el.textContent?.trim().toLowerCase().startsWith(e.key.toLowerCase()))
      match?.focus()
    }
  }

  const triggerProps = {
    ref: (el: HTMLElement | null) => { anchor.current = el },
    onClick: () => setOpen((o) => !o),
    'aria-haspopup': 'menu' as const,
    'aria-expanded': open,
    'aria-controls': id,
  }

  if (actionable.length === 0) return null

  return (
    <>
      {trigger ? trigger(triggerProps) : (
        <IconButton
          ref={triggerProps.ref as (el: HTMLButtonElement | null) => void}
          onClick={triggerProps.onClick}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={id}
          label={label}
          icon={<MoreHorizontal className="size-4" />}
          size="sm"
          tooltip={false}
          className={className}
        />
      )}
      {open && createPortal(
        <div
          ref={panel}
          id={id}
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
          className="fixed z-[150] min-w-[200px] max-w-[280px] rounded-lg border border-line bg-surface p-1 shadow-lg animate-pop-in"
          style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
        >
          {items.map((item, i) => {
            if (item === 'separator') return <div key={i} role="separator" className="my-1 h-px bg-line" />
            if ('heading' in item) return <div key={i} className="px-2.5 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wide text-fg-4">{item.heading}</div>
            return (
              <button
                key={i}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => { close(); item.onSelect() }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-start text-sm outline-none',
                  'focus:bg-surface-3 hover:bg-surface-3 disabled:opacity-40',
                  item.tone === 'danger' ? 'text-danger-fg' : 'text-fg-2',
                )}
              >
                {item.icon && <span className="flex size-4 shrink-0 items-center justify-center [&>svg]:size-4">{item.icon}</span>}
                <span className="flex-1 truncate">{item.label}</span>
                {item.hint && <span className="text-xs text-fg-4">{item.hint}</span>}
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </>
  )
}
