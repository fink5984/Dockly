import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Check, ChevronRight, Copy } from 'lucide-react'
import { cn, initials, avatarTone, copyText } from '@/lib/utils'
import { useI18n } from '@/contexts/I18nContext'
import { useApp } from '@/contexts/AppContext'
import { Tooltip } from './Tooltip'

export function Avatar({ name, size = 'md', className }: { name: string; size?: 'xs' | 'sm' | 'md' | 'lg'; className?: string }) {
  const s = { xs: 'size-6 text-2xs', sm: 'size-7 text-2xs', md: 'size-8 text-xs', lg: 'size-11 text-sm' }[size]
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-semibold', s, avatarTone(name || '?'), className)} aria-hidden>
      {initials(name)}
    </span>
  )
}

export interface Crumb { label: string; to?: string }

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const { t } = useI18n()
  return (
    <nav aria-label={t('common.breadcrumbs')} className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-sm text-fg-3">
        {items.map((c, i) => (
          <li key={i} className="flex min-w-0 items-center gap-1">
            {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-fg-4 rtl-flip" aria-hidden />}
            {c.to && i < items.length - 1 ? (
              <Link to={c.to} className="truncate hover:text-fg-2 rounded focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]">{c.label}</Link>
            ) : (
              <span className={cn('truncate', i === items.length - 1 && 'text-fg-2')} aria-current={i === items.length - 1 ? 'page' : undefined}>{c.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}

interface PageHeaderProps {
  title: ReactNode
  description?: ReactNode
  breadcrumbs?: Crumb[]
  actions?: ReactNode
  meta?: ReactNode
  className?: string
}

export function PageHeader({ title, description, breadcrumbs, actions, meta, className }: PageHeaderProps) {
  return (
    <header className={cn('mb-6', className)}>
      {breadcrumbs && breadcrumbs.length > 0 && <div className="mb-2"><Breadcrumbs items={breadcrumbs} /></div>}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
          {description && <p className="mt-1 text-sm text-fg-3">{description}</p>}
          {meta && <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-fg-3">{meta}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  )
}

export function CopyButton({ value, label, className, children }: { value: string; label?: string; className?: string; children?: ReactNode }) {
  const [copied, setCopied] = useState(false)
  const { t } = useI18n()
  const { toast } = useApp()
  const onClick = async () => {
    const ok = await copyText(value)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } else {
      toast({ tone: 'error', title: t('common.copyFailed') })
    }
  }
  const text = label || t('common.copy')
  return (
    <Tooltip content={copied ? t('common.copied') : text}>
      <button
        type="button"
        onClick={onClick}
        aria-label={text}
        className={cn('inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-fg-2 hover:text-fg focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]', className)}
      >
        {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
        {children}
      </button>
    </Tooltip>
  )
}

interface Step { id: string; label: string }

export function Stepper({ steps, current, onStepClick }: { steps: Step[]; current: number; onStepClick?: (index: number) => void }) {
  const { t } = useI18n()
  return (
    <ol className="flex items-center gap-2" aria-label={t('common.progress')}>
      {steps.map((s, i) => {
        const done = i < current
        const active = i === current
        const clickable = onStepClick && i < current
        return (
          <li key={s.id} className="flex min-w-0 flex-1 items-center gap-2">
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onStepClick?.(i)}
              aria-current={active ? 'step' : undefined}
              className={cn('flex min-w-0 items-center gap-2 rounded-md text-start', clickable && 'hover:text-fg')}
            >
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular transition-colors',
                  done ? 'bg-brand-600 text-brand-fg' : active ? 'border-2 border-brand-600 text-brand-700' : 'border border-line-2 text-fg-4',
                )}
              >
                {done ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span className={cn('hidden truncate text-sm md:block', active ? 'font-semibold text-fg' : done ? 'text-fg-2' : 'text-fg-4')}>{s.label}</span>
            </button>
            {i < steps.length - 1 && <span className={cn('h-px flex-1', done ? 'bg-brand-600' : 'bg-line')} aria-hidden />}
          </li>
        )
      })}
    </ol>
  )
}

/** Metric tile for dashboards. */
export function Stat({ label, value, hint, icon, tone = 'neutral', to, className }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: 'neutral' | 'warning' | 'danger' | 'success' | 'brand'; to?: string; className?: string }) {
  const toneCls = { neutral: 'text-fg-3 bg-surface-3', warning: 'text-warning bg-warning-soft', danger: 'text-danger bg-danger-soft', success: 'text-success bg-success-soft', brand: 'text-brand-600 bg-brand-soft' }[tone]
  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-sm font-medium leading-snug text-fg-3">{label}</p>
        {icon && <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-md [&>svg]:size-4', toneCls)}>{icon}</span>}
      </div>
      {/* Pinned to the bottom when the tile is taller than its content (square tiles on phones). */}
      <div className="mt-auto pt-2">
        <p className="text-2xl font-semibold tabular tracking-tight text-fg">{value}</p>
        {hint && <p className="mt-0.5 text-xs text-fg-3">{hint}</p>}
      </div>
    </>
  )
  const cls = cn('flex flex-col rounded-xl border border-line bg-surface p-4 shadow-xs', className)
  return to ? (
    <Link to={to} className={cn(cls, 'transition-[border-color,box-shadow] hover:border-line-2 hover:shadow-sm focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]')}>{inner}</Link>
  ) : <div className={cls}>{inner}</div>
}
