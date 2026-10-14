import { useState } from 'react'
import { Check, FileSignature, FolderInput, Layers, Minus } from 'lucide-react'
import type { Interval, Plan } from '@shared/billing/pricing.mjs'
import { cn } from '@/lib/utils'
import { useI18n } from '@/contexts/I18nContext'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Segmented } from '@/components/ui/Field'
import { displayMonthly, FAMILIES, money, planFor, type ChangeKind, type Family } from '@/lib/billing'
import { suiteSavings, intervalPrice } from '@shared/billing/pricing.mjs'

const ICONS: Record<Family, typeof Layers> = { collect: FolderInput, sign: FileSignature, suite: Layers }

interface PlanPickerProps {
  interval: Interval
  onIntervalChange: (i: Interval) => void
  tier: Plan['tier']
  onTierChange: (t: Plan['tier']) => void
  recommended?: Family
  highlightPlan?: string
  /** What choosing each plan would do; null = read-only (no buttons). */
  kindOf: ((plan: Plan) => ChangeKind) | null
  onChoose: (plan: Plan) => void
  busyPlan?: string | null
}

export function PlanPicker({ interval, onIntervalChange, tier, onTierChange, recommended = 'suite', highlightPlan, kindOf, onChoose, busyPlan }: PlanPickerProps) {
  const { t, language } = useI18n()
  const savings = suiteSavings()
  const buttonLabel = (k: ChangeKind) => ({ current: t('billing.action.current'), subscribe: t('billing.action.subscribe'), upgrade: t('billing.action.upgrade'), schedule: t('billing.action.switchAtRenewal') }[k])

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Segmented<Plan['tier']>
          label={t('billing.plans.title')}
          value={tier}
          onChange={onTierChange}
          options={[{ value: 'starter', label: t('billing.tier.starter') }, { value: 'pro', label: t('billing.tier.pro') }]}
        />
        <div className="flex items-center gap-2">
          <Segmented<Interval>
            label={t('billing.interval.month')}
            value={interval}
            onChange={onIntervalChange}
            options={[{ value: 'month', label: t('billing.interval.month') }, { value: 'year', label: t('billing.interval.year') }]}
          />
          <Badge tone="success">{t('billing.yearlySave')}</Badge>
        </div>
      </div>
      <ul className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {FAMILIES.map((family) => {
          const plan = planFor(family, tier)
          const Icon = ICONS[family]
          const kind = kindOf ? kindOf(plan) : null
          const featured = family === recommended
          const highlighted = highlightPlan === plan.code
          return (
            <li
              key={family}
              className={cn(
                'relative flex flex-col rounded-xl border bg-surface p-5 shadow-xs',
                featured || highlighted ? 'border-brand-500 ring-1 ring-brand-500' : 'border-line',
              )}
            >
              {featured && (
                <span className="absolute -top-2.5 start-4">
                  <Badge tone="brand" size="md">{family === 'suite' && recommended === 'suite' ? t('billing.mostPopular') : t('billing.recommended')}</Badge>
                </span>
              )}
              <div className="flex items-center gap-2.5">
                <span className="flex size-9 items-center justify-center rounded-lg bg-brand-soft text-brand-600"><Icon className="size-5" /></span>
                <div>
                  <h3 className="text-md font-semibold text-fg">{t(`billing.family.${family}`)}</h3>
                  <p className="text-xs text-fg-3">{t(`billing.tier.${tier}`)}</p>
                </div>
              </div>
              <p className="mt-3 min-h-10 text-sm text-fg-3">{t(`billing.familyDesc.${family}`)}</p>
              <div className="mt-4 flex items-baseline gap-1.5">
                <span className="text-3xl font-semibold tracking-tight text-fg tabular">{money(displayMonthly(plan, interval), language)}</span>
                <span className="text-sm text-fg-3">{t('billing.perMonth')} {t('billing.plusVat')}</span>
              </div>
              <p className="mt-1 min-h-5 text-xs text-fg-3">
                {interval === 'year' ? t('billing.billedYearly', { amount: money(intervalPrice(plan.monthly, 'year'), language) }) : family === 'suite' && savings[plan.code] ? t('billing.save', { amount: money(savings[plan.code], language) }) : ''}
              </p>
              <ul className="mt-4 flex-1 space-y-2 text-sm">
                <Limit ok={plan.limits.requests > 0}>{plan.limits.requests > 0 ? t('billing.limits.requests', { count: plan.limits.requests }) : t('billing.limits.noRequests')}</Limit>
                <Limit ok={plan.limits.envelopes > 0}>{plan.limits.envelopes > 0 ? t('billing.limits.envelopes', { count: plan.limits.envelopes }) : t('billing.limits.noEnvelopes')}</Limit>
                <Limit ok>{t('billing.limits.storage', { count: plan.limits.storageGb })}</Limit>
                <Limit ok>{t('billing.limits.seats', { count: plan.limits.seats })}</Limit>
              </ul>
              {kind && (
                <Button
                  className="mt-5"
                  fullWidth
                  variant={kind === 'current' ? 'secondary' : featured || highlighted ? 'primary' : 'secondary'}
                  disabled={kind === 'current'}
                  loading={busyPlan === plan.code}
                  onClick={() => onChoose(plan)}
                >
                  {buttonLabel(kind)}
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      <p className="mt-3 text-xs text-fg-4">{t('billing.plans.provisional')}</p>
    </div>
  )
}

function Limit({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className={cn('flex items-start gap-2', ok ? 'text-fg-2' : 'text-fg-4')}>
      {ok ? <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : <Minus className="mt-0.5 size-4 shrink-0" aria-hidden />}
      <span>{children}</span>
    </li>
  )
}
