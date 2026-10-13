import { useState, useRef, useEffect } from 'react'
import { MoreVertical } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface CardMenuItem {
  label: string
  icon?: React.ReactNode
  onClick: () => void
  variant?: 'default' | 'danger' | 'warning'
}

interface CardMenuProps {
  items: CardMenuItem[]
}

export function CardMenu({ items }: CardMenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  if (items.length === 0) return null

  return (
    <div ref={ref} className="relative" onClick={e => e.stopPropagation()}>
      <button
        onClick={() => setOpen(!open)}
        className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
      >
        <MoreVertical className="w-4 h-4" />
      </button>

      {open && (
        <div className={cn(
          'absolute z-50 mt-1 py-1 min-w-[160px] rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-lg',
          'end-0'
        )}>
          {items.map((item, i) => (
            <button
              key={i}
              onClick={() => {
                setOpen(false)
                item.onClick()
              }}
              className={cn(
                'flex items-center gap-2 w-full px-3 py-2 text-xs font-medium transition-colors',
                'hover:bg-[var(--bg-tertiary)]',
                item.variant === 'danger' && 'text-red-500 hover:text-red-600',
                item.variant === 'warning' && 'text-amber-500 hover:text-amber-600',
                !item.variant || item.variant === 'default' ? 'text-[var(--text-secondary)]' : ''
              )}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
