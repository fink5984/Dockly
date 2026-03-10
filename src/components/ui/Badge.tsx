import { cn } from '@/lib/utils'
import { getStatusColor } from '@/lib/utils'

interface BadgeProps {
  children: React.ReactNode
  variant?: 'default' | 'status'
  status?: string
  size?: 'sm' | 'md'
  className?: string
}

export function Badge({ children, variant = 'default', status, size = 'sm', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center font-medium rounded-full whitespace-nowrap',
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
        variant === 'status' && status ? getStatusColor(status) : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]',
        className
      )}
    >
      {children}
    </span>
  )
}
