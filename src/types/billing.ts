/* Billing types — mirror server/routes/billing.mjs and server/billing/*. */
import type { Interval, ProductCode, QuoteLine } from '@shared/billing/pricing.mjs'

export type SubscriptionStatus = 'legacy' | 'comped' | 'trialing' | 'expired' | 'active' | 'past_due' | 'suspended' | 'canceled'

/** Compact summary returned with /api/auth/me (drives banners and gating). */
export interface BillingSummary {
  status: SubscriptionStatus
  readOnly: boolean
  planCode: string | null
  interval: Interval | null
  products: ProductCode[]
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  graceEndsAt: string | null
  legacyUntil: string | null
}

export interface Limits { requests: number | null; envelopes: number | null; storageBytes: number | null; seats: number | null }

export interface Invoice {
  id: string
  number: string
  kind: 'subscription' | 'renewal' | 'proration' | 'pack'
  status: 'pending' | 'paid' | 'failed' | 'void' | 'refunded'
  periodStart: string | null
  periodEnd: string | null
  lines: QuoteLine[]
  subtotal: number
  vat: number
  total: number
  currency: string
  documentNumber: string | null
  documentUrl: string | null
  paidAt: string | null
  createdAt: string
  attemptCount: number
}

export interface BillingState {
  subscription: {
    status: SubscriptionStatus
    readOnly: boolean
    planCode: string | null
    interval: Interval | null
    addons: { code: string; qty: number }[]
    periodSubtotal: number | null
    currency: string
    trialStartedAt: string | null
    trialEndsAt: string | null
    currentPeriodStart: string | null
    currentPeriodEnd: string | null
    cancelAtPeriodEnd: boolean
    pending: { planCode: string; interval: Interval; addons: { code: string; qty: number }[] } | null
    pastDueSince: string | null
    graceEndsAt: string | null
    nextRetryAt: string | null
    legacyUntil: string | null
    interest: 'collect' | 'sign' | 'both' | null
    paymentMethod: { brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null } | null
    billingDetails: { name: string; email: string; taxId: string }
  }
  entitlements: { products: ProductCode[]; limits: Limits; credits: Record<string, number> }
  usage: { requests: number; envelopes: number; storageBytes: number; seats: number; windowStart: string; windowEnd: string }
  invoices: Invoice[]
  provider: { name: 'cardcom' | 'sandbox' | 'disabled'; live: boolean; available: boolean; salesEmail: string | null }
}

export interface CheckoutSession {
  id: string
  kind: 'subscribe' | 'change' | 'pack' | 'payment_method'
  status: 'open' | 'completed' | 'failed' | 'expired' | 'canceled'
  amount: number
  currency: string
  failureCode: string | null
  completedAt: string | null
  selection: { planCode?: string; interval?: Interval; packCode?: string }
}

export type ChangeResult =
  | { action: 'checkout'; sessionId: string; redirectUrl: string }
  | { action: 'applied' | 'processing'; invoiceId?: string }
  | { action: 'scheduled'; effectiveAt: string }
  | { action: 'none' }
