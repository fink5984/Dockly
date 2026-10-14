/**
 * Display helpers for billing. Amounts shown here are previews computed with
 * the same shared pricing module the server uses; the server recomputes every
 * charge and never accepts an amount from the browser.
 */
import {
  catalog, findPlan, prorate, quoteSubscription, formatMoney, intervalPrice, type Interval, type Plan,
} from '@shared/billing/pricing.mjs'
import type { Language } from '@/types'
import type { BillingState, SubscriptionStatus } from '@/types/billing'
import type { Tone } from '@/components/ui/Badge'

export { catalog, findPlan }

export const money = (minor: number, lang: Language) => formatMoney(minor, { locale: lang === 'he' ? 'he-IL' : 'en-IL', currency: catalog.currency })

export const statusTone: Record<SubscriptionStatus, Tone> = {
  legacy: 'neutral', comped: 'success', trialing: 'brand', expired: 'danger', active: 'success', past_due: 'warning', suspended: 'danger', canceled: 'neutral',
}

export function daysUntil(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return 0
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 86_400_000))
}

export const FAMILIES = ['collect', 'sign', 'suite'] as const
export type Family = (typeof FAMILIES)[number]

export function planFor(family: Family, tier: Plan['tier']) {
  return catalog.plans.find((p) => p.family === family && p.tier === tier)!
}

export type ChangeKind = 'current' | 'subscribe' | 'upgrade' | 'schedule'

/** What choosing `planCode`/`interval` would do for this workspace (mirrors server/billing/service.mjs changePlan). */
export function changeKind(state: BillingState, planCode: string, interval: Interval, addons: Record<string, number> = currentAddons(state)): ChangeKind {
  const s = state.subscription
  const paid = s.status === 'active' || s.status === 'past_due'
  if (!paid) return 'subscribe'
  const next = quoteSubscription({ planCode, interval, addons })
  const same = s.planCode === planCode && s.interval === interval && JSON.stringify(addonsKey(currentAddons(state))) === JSON.stringify(addonsKey(addons))
  if (same) return 'current'
  if (interval !== s.interval || next.subtotal < (s.periodSubtotal ?? 0)) return 'schedule'
  return 'upgrade'
}

const addonsKey = (a: Record<string, number>) => Object.entries(a).filter(([, q]) => q > 0).sort()

export function currentAddons(state: BillingState): Record<string, number> {
  return Object.fromEntries(state.subscription.addons.map((a) => [a.code, a.qty]))
}

/** Preview of what will be charged today for a selection. */
export function previewCharge(state: BillingState, planCode: string, interval: Interval, addons: Record<string, number>) {
  const kind = changeKind(state, planCode, interval, addons)
  const full = quoteSubscription({ planCode, interval, addons })
  if (kind === 'subscribe') return { kind, subtotal: full.subtotal, vat: full.vat, total: full.total, full }
  if (kind !== 'upgrade') return { kind, subtotal: 0, vat: 0, total: 0, full }
  const s = state.subscription
  const subtotal = prorate({ fromSubtotal: s.periodSubtotal ?? 0, toSubtotal: full.subtotal, periodStart: s.currentPeriodStart!, periodEnd: s.currentPeriodEnd! })
  const vat = Math.round(subtotal * catalog.vatRate)
  return { kind, subtotal, vat, total: subtotal + vat, full }
}

/** Price per month to display for a plan at an interval (yearly shown as its monthly equivalent). */
export function displayMonthly(plan: Plan, interval: Interval) {
  return interval === 'year' ? Math.round(intervalPrice(plan.monthly, 'year') / 12) : plan.monthly
}

export function recommendedFamily(interest: BillingState['subscription']['interest']): Family {
  return interest === 'collect' ? 'collect' : interest === 'sign' ? 'sign' : 'suite'
}

/** Plan picked on the pricing page before signing up (kept for the session only). */
export function readPlanIntent(): { plan?: string; interval?: Interval } {
  try {
    const raw = sessionStorage.getItem('dockly-intent')
    if (!raw) return {}
    const v = JSON.parse(raw)
    return { plan: findPlan(v.plan) ? v.plan : undefined, interval: v.interval === 'year' ? 'year' : v.interval === 'month' ? 'month' : undefined }
  } catch {
    return {}
  }
}
