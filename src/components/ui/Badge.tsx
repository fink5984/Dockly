import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/contexts/I18nContext'
import type { DocStatus, RequestStatus, SignatureStatus } from '@/types'

export type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info'

const tones: Record<Tone, string> = {
  neutral: 'bg-neutral-soft text-neutral-fg',
  brand: 'bg-brand-soft text-brand-700',
  success: 'bg-success-soft text-success-fg',
  warning: 'bg-warning-soft text-warning-fg',
  danger: 'bg-danger-soft text-danger-fg',
  info: 'bg-info-soft text-info-fg',
}

const dots: Record<Tone, string> = {
  neutral: 'bg-fg-4',
  brand: 'bg-brand-500',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
}

interface BadgeProps {
  tone?: Tone
  children: ReactNode
  dot?: boolean
  icon?: ReactNode
  size?: 'sm' | 'md'
  className?: string
}

export function Badge({ tone = 'neutral', children, dot, icon, size = 'sm', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-medium',
        size === 'sm' ? 'h-5 px-2 text-2xs' : 'h-6 px-2.5 text-xs',
        tones[tone],
        className,
      )}
    >
      {dot && <span className={cn('size-1.5 rounded-full', dots[tone])} aria-hidden />}
      {icon}
      {children}
    </span>
  )
}

export function StatusDot({ tone, className }: { tone: Tone; className?: string }) {
  return <span className={cn('inline-block size-2 rounded-full', dots[tone], className)} aria-hidden />
}

export const requestTone: Record<RequestStatus, Tone> = {
  new: 'neutral',
  'waiting-for-client': 'info',
  'partial-submission': 'warning',
  completed: 'success',
  closed: 'neutral',
}

export const docTone: Record<DocStatus, Tone> = {
  missing: 'neutral',
  uploaded: 'info',
  approved: 'success',
  rejected: 'danger',
}

export const signatureTone: Record<SignatureStatus, Tone> = {
  draft: 'neutral',
  pending: 'info',
  viewed: 'brand',
  signed: 'success',
  declined: 'danger',
  expired: 'warning',
  cancelled: 'neutral',
}

export function RequestStatusBadge({ status, overdue, size }: { status: RequestStatus; overdue?: boolean; size?: 'sm' | 'md' }) {
  const { t } = useI18n()
  if (overdue && status !== 'completed' && status !== 'closed') {
    return <Badge tone="danger" dot size={size}>{t('status.request.overdue')}</Badge>
  }
  return <Badge tone={requestTone[status] || 'neutral'} dot size={size}>{t(`status.request.${status}`)}</Badge>
}

export function DocStatusBadge({ status, size }: { status: DocStatus; size?: 'sm' | 'md' }) {
  const { t } = useI18n()
  return <Badge tone={docTone[status] || 'neutral'} dot size={size}>{t(`status.doc.${status}`)}</Badge>
}

export function SignatureStatusBadge({ status, size }: { status: SignatureStatus; size?: 'sm' | 'md' }) {
  const { t } = useI18n()
  return <Badge tone={signatureTone[status] || 'neutral'} dot size={size}>{t(`status.signature.${status}`)}</Badge>
}
