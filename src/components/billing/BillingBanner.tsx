import { Link, useLocation } from 'react-router-dom'
import { AlertTriangle, Clock, CreditCard, Info, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/contexts/I18nContext'
import { useAuth } from '@/contexts/AuthContext'
import { daysUntil } from '@/lib/billing'

type Tone = 'brand' | 'warning' | 'danger' | 'info'
const toneCls: Record<Tone, string> = {
  brand: 'border-brand-200 bg-brand-soft text-brand-800',
  info: 'border-info/20 bg-info-soft text-info-fg',
  warning: 'border-warning/25 bg-warning-soft text-warning-fg',
  danger: 'border-danger/25 bg-danger-soft text-danger-fg',
}

/**
 * Subscription state at the top of every dashboard page. Quiet for active and
 * legacy workspaces; informative during a trial; insistent only when access
 * is at risk. The server enforces the limits — this only explains them.
 */
export function BillingBanner() {
  const { billing, can } = useAuth()
  const { t, fmt } = useI18n()
  const { pathname } = useLocation()
  if (!billing || pathname.startsWith('/app/billing')) return null
  const owner = can('owner')
  const days = daysUntil(billing.trialEndsAt)

  let tone: Tone = 'brand'
  let icon = <Sparkles className="size-4" />
  let text = ''
  let cta: { label: string; to: string } | null = { label: t('billing.banner.choosePlan'), to: '/app/billing' }

  switch (billing.status) {
    case 'trialing':
      if (days > 7) {
        tone = 'brand'
        text = `${t('billing.banner.trial', { count: days })} · ${t('billing.banner.trialNoCard')}`
      } else {
        tone = 'warning'
        icon = <Clock className="size-4" />
        text = days <= 0 ? t('billing.banner.trialEndsToday') : t('billing.banner.trial', { count: days })
      }
      cta = { label: t('billing.banner.trialCta'), to: '/app/billing' }
      break
    case 'expired':
      tone = 'danger'; icon = <AlertTriangle className="size-4" />; text = t('billing.banner.expired')
      break
    case 'past_due':
      tone = 'warning'; icon = <CreditCard className="size-4" />
      text = t('billing.banner.pastDue', { date: fmt.date(billing.graceEndsAt) })
      cta = { label: t('billing.banner.updateCard'), to: '/app/billing#payment' }
      break
    case 'suspended':
      tone = 'danger'; icon = <AlertTriangle className="size-4" />; text = t('billing.banner.suspended')
      cta = { label: t('billing.banner.updateCard'), to: '/app/billing#payment' }
      break
    case 'canceled':
      tone = 'danger'; icon = <AlertTriangle className="size-4" />; text = t('billing.banner.canceled')
      break
    case 'active':
      if (!billing.cancelAtPeriodEnd) return null
      tone = 'info'; icon = <Info className="size-4" />
      text = t('billing.banner.canceling', { date: fmt.date(billing.currentPeriodEnd) })
      cta = { label: t('billing.banner.resume'), to: '/app/billing#cancel' }
      break
    case 'legacy':
      if (!billing.legacyUntil) return null
      tone = 'info'; icon = <Info className="size-4" />
      text = t('billing.banner.legacyUntil', { date: fmt.date(billing.legacyUntil) })
      break
    default:
      return null
  }

  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('border-b px-4 py-2 sm:px-6 lg:px-8', toneCls[tone])}>
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0" aria-hidden>{icon}</span>
          <span className="min-w-0">{text}</span>
        </span>
        {owner && cta
          ? <Link to={cta.to} className="shrink-0 rounded-md font-semibold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]">{cta.label}</Link>
          : !owner && billing.readOnly && <span className="shrink-0 text-xs opacity-80">{t('billing.banner.ownerOnly')}</span>}
      </div>
    </div>
  )
}
