export type Interval = 'month' | 'year'
export type ProductCode = 'collect' | 'sign'
export type Metric = 'requests' | 'envelopes'

export interface PlanLimits { requests: number; envelopes: number; storageGb: number; seats: number }
export interface Plan {
  code: string
  family: 'collect' | 'sign' | 'suite'
  tier: 'starter' | 'pro'
  products: ProductCode[]
  monthly: number
  highlight?: boolean
  limits: PlanLimits
}
export interface Addon { code: string; kind: 'recurring'; monthly: number; grants: Partial<Record<'storageGb' | 'seats', number>>; max: number }
export interface Pack { code: string; price: number; grants: Partial<Record<Metric, number>>; requiresProduct: ProductCode }
export interface Catalog {
  version: string
  provisional: boolean
  currency: string
  vatRate: number
  pricesIncludeVat: boolean
  yearlyMonthsCharged: number
  trial: { days: number; requiresCard: boolean; products: ProductCode[]; limits: PlanLimits }
  grace: { pastDueDays: number; retryDays: number[] }
  portalStorageBuffer: number
  plans: Plan[]
  addons: Addon[]
  packs: Pack[]
}
export interface QuoteLine { code: string; kind: 'plan' | 'addon' | 'pack' | 'proration'; qty: number; unit: number; total: number }
export interface Quote { lines: QuoteLine[]; subtotal: number; vat: number; total: number; currency: string; catalogVersion: string; interval: Interval | null }

export const catalog: Catalog
export const INTERVALS: readonly Interval[]
export const METRICS: readonly Metric[]
export class PricingError extends Error { code: string }
export function findPlan(code: string, cat?: Catalog): Plan | null
export function findAddon(code: string, cat?: Catalog): Addon | null
export function findPack(code: string, cat?: Catalog): Pack | null
export function intervalPrice(monthly: number, interval: Interval, cat?: Catalog): number
export function vatOf(amountExVat: number, cat?: Catalog): number
export function withVat(amountExVat: number, cat?: Catalog): number
export function normalizeAddons(addons?: Record<string, number>, cat?: Catalog): { code: string; qty: number }[]
export function quoteSubscription(sel: { planCode: string; interval: Interval; addons?: Record<string, number> }, cat?: Catalog): Quote
export function quotePack(code: string, cat?: Catalog): Quote
export function prorate(p: { fromSubtotal: number; toSubtotal: number; periodStart: string | Date; periodEnd: string | Date; now?: Date }): number
export function addInterval(date: string | Date, interval: Interval, count?: number): Date
export function effectiveLimits(p: { base: PlanLimits | null; addons?: { code: string; qty: number }[]; credits?: Partial<Record<Metric, number>> }, cat?: Catalog): { requests: number | null; envelopes: number | null; storageBytes: number | null; seats: number | null }
export function suiteSavings(cat?: Catalog): Record<string, number>
export function planRank(code: string, cat?: Catalog): number
export function formatMoney(minor: number, opts?: { currency?: string; locale?: string; decimals?: number }): string
