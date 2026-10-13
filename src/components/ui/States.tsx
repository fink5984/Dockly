import type { ReactNode } from 'react'
import { AlertCircle, RotateCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/contexts/I18nContext'
import { Button } from './Button'

interface EmptyStateProps {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  secondaryAction?: ReactNode
  className?: string
  compact?: boolean
}

export function EmptyState({ icon, title, description, action, secondaryAction, className, compact }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'px-4 py-8' : 'px-6 py-14', className)}>
      {icon && (
        <div className="mb-4 flex size-11 items-center justify-center rounded-xl border border-line bg-surface-2 text-fg-3 shadow-xs [&>svg]:size-5">
          {icon}
        </div>
      )}
      <h3 className="text-md font-semibold text-fg">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-fg-3">{description}</p>}
      {(action || secondaryAction) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  )
}

export function ErrorState({ title, description, onRetry, className }: { title?: string; description?: string; onRetry?: () => void; className?: string }) {
  const { t } = useI18n()
  return (
    <div role="alert" className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-danger-soft text-danger">
        <AlertCircle className="size-5" />
      </div>
      <h3 className="text-md font-semibold text-fg">{title || t('common.loadFailed')}</h3>
      <p className="mt-1 max-w-sm text-sm text-fg-3">{description || t('common.loadFailedHint')}</p>
      {onRetry && (
        <Button className="mt-4" size="sm" icon={<RotateCw className="size-3.5" />} onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden />
}

/** Placeholder rows for tables/lists while loading. */
export function ListSkeleton({ rows = 5, className }: { rows?: number; className?: string }) {
  const { t } = useI18n()
  return (
    <div className={cn('divide-y divide-line', className)} role="status" aria-label={t('common.loading')}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-3.5">
          <Skeleton className="size-8 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/5" />
          </div>
          <Skeleton className="hidden h-5 w-20 rounded-full sm:block" />
        </div>
      ))}
    </div>
  )
}

export function ProgressBar({ value, tone, className, label, size = 'sm' }: { value: number; tone?: 'brand' | 'success' | 'warning'; className?: string; label?: string; size?: 'xs' | 'sm' | 'md' }) {
  const v = Math.max(0, Math.min(100, Math.round(value)))
  const color = tone === 'success' || (tone === undefined && v === 100) ? 'bg-success' : tone === 'warning' ? 'bg-warning' : 'bg-brand-600'
  return (
    <div
      role="progressbar"
      aria-valuenow={v}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn('w-full overflow-hidden rounded-full bg-surface-3', size === 'xs' ? 'h-1' : size === 'md' ? 'h-2.5' : 'h-1.5', className)}
    >
      <div className={cn('h-full rounded-full transition-[width] duration-500 ease-out', color)} style={{ width: `${v}%` }} />
    </div>
  )
}

export function ProgressRing({ value, size = 40, stroke = 4, className, children }: { value: number; size?: number; stroke?: number; className?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(100, value))
  return (
    <div className={cn('relative inline-flex items-center justify-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-surface-3" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c - (v / 100) * c}
          className={cn('transition-[stroke-dashoffset] duration-700 ease-out', v === 100 ? 'stroke-success' : 'stroke-brand-600')}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-2xs font-semibold tabular text-fg">{children ?? `${Math.round(v)}%`}</span>
    </div>
  )
}

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span role="status" aria-label={label} className={cn('inline-block size-4 animate-spin rounded-full border-2 border-line-2 border-t-brand-600', className)} />
  )
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-2 bg-surface px-1 font-sans text-2xs font-medium text-fg-3', className)}>{children}</kbd>
}
