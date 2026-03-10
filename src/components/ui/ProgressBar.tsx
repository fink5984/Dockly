import { cn } from '@/lib/utils'

interface ProgressBarProps {
  value: number
  max?: number
  size?: 'sm' | 'md' | 'lg'
  className?: string
  showLabel?: boolean
}

export function ProgressBar({ value, max = 100, size = 'sm', className, showLabel }: ProgressBarProps) {
  const percent = Math.min(Math.round((value / max) * 100), 100)
  const color = percent === 100 ? 'bg-success' : percent >= 60 ? 'bg-primary-500' : percent >= 30 ? 'bg-warning' : 'bg-danger'
  const sizeClass = size === 'sm' ? 'h-1.5' : size === 'md' ? 'h-2.5' : 'h-3.5'

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className={cn('flex-1 rounded-full bg-[var(--bg-tertiary)] overflow-hidden', sizeClass)}>
        <div
          className={cn('h-full rounded-full transition-all duration-500', color)}
          style={{ width: `${percent}%` }}
        />
      </div>
      {showLabel && (
        <span className="text-xs font-medium text-[var(--text-secondary)] tabular-nums min-w-[32px] text-end">
          {percent}%
        </span>
      )}
    </div>
  )
}
