import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  className?: string
  hover?: boolean
  onClick?: () => void
  style?: React.CSSProperties
}

export function Card({ children, className, hover, onClick, style }: CardProps) {
  return (
    <div
      onClick={onClick}
      style={style}
      className={cn(
        'bg-[var(--bg-primary)] rounded-xl border border-[var(--border-primary)]',
        'shadow-[var(--shadow-sm)]',
        hover && 'cursor-pointer hover:shadow-[var(--shadow-md)] hover:border-primary-200 dark:hover:border-primary-800 transition-all duration-200',
        onClick && 'cursor-pointer',
        className
      )}
    >
      {children}
    </div>
  )
}

export function CardHeader({ children, className, title, description, action }: { children?: ReactNode; className?: string; title?: string; description?: string; action?: ReactNode }) {
  return (
    <div className={cn('px-5 py-4 border-b border-[var(--border-secondary)]', className)}>
      {title ? (
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">{title}</h3>
            {description && <p className="text-xs text-[var(--text-tertiary)] mt-0.5">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      ) : children}
    </div>
  )
}

export function CardContent({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('px-5 py-4', className)}>{children}</div>
}
