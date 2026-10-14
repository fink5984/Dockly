/**
 * Pure pricing math shared by the server (authoritative) and the UI/marketing
 * build (display only). Money is always integer minor units (agorot); VAT is
 * applied once, on the subtotal, and rounded half-up to the agora.
 *
 * No I/O here — everything takes the catalog as an argument so tests can
 * exercise alternative catalogs.
 */
import defaultCatalog from './catalog.json' with { type: 'json' }

export const catalog = defaultCatalog

export const INTERVALS = /** @type {const} */ (['month', 'year'])
export const METRICS = /** @type {const} */ (['requests', 'envelopes'])
const GB = 1024 ** 3

export function findPlan(code, cat = catalog) {
  return cat.plans.find((p) => p.code === code) || null
}
export function findAddon(code, cat = catalog) {
  return cat.addons.find((a) => a.code === code) || null
}
export function findPack(code, cat = catalog) {
  return cat.packs.find((p) => p.code === code) || null
}

/** Price of one billing period, excluding VAT. */
export function intervalPrice(monthly, interval, cat = catalog) {
  if (interval === 'year') return monthly * cat.yearlyMonthsCharged
  if (interval === 'month') return monthly
  throw new Error(`Unknown interval ${interval}`)
}

export function vatOf(amountExVat, cat = catalog) {
  return Math.round(amountExVat * cat.vatRate)
}

/** Add VAT to an ex-VAT amount (minor units). */
export function withVat(amountExVat, cat = catalog) {
  return amountExVat + vatOf(amountExVat, cat)
}

/**
 * Validate and normalise an add-on selection: { storage_10gb: 2 } → [{ code, qty }].
 * Throws on unknown codes or quantities out of range.
 */
export function normalizeAddons(addons = {}, cat = catalog) {
  const out = []
  for (const [code, rawQty] of Object.entries(addons || {})) {
    const addon = findAddon(code, cat)
    if (!addon) throw new PricingError('unknown_addon', `Unknown add-on ${code}`)
    const qty = Number(rawQty)
    if (!Number.isInteger(qty) || qty < 0 || qty > addon.max) throw new PricingError('invalid_quantity', `Invalid quantity for ${code}`)
    if (qty > 0) out.push({ code, qty })
  }
  return out.sort((a, b) => a.code.localeCompare(b.code))
}

export class PricingError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

/**
 * Full quote for a subscription period. This is the ONLY function that turns
 * a selection into an amount; checkout and renewals both use it.
 * @returns {{ lines: {code:string, kind:string, qty:number, unit:number, total:number}[], subtotal:number, vat:number, total:number, currency:string, catalogVersion:string, interval:string }}
 */
export function quoteSubscription({ planCode, interval, addons = {} }, cat = catalog) {
  const plan = findPlan(planCode, cat)
  if (!plan) throw new PricingError('unknown_plan', `Unknown plan ${planCode}`)
  if (!INTERVALS.includes(interval)) throw new PricingError('invalid_interval', 'Invalid billing interval')
  const lines = [{ code: plan.code, kind: 'plan', qty: 1, unit: intervalPrice(plan.monthly, interval, cat), total: intervalPrice(plan.monthly, interval, cat) }]
  for (const { code, qty } of normalizeAddons(addons, cat)) {
    const unit = intervalPrice(findAddon(code, cat).monthly, interval, cat)
    lines.push({ code, kind: 'addon', qty, unit, total: unit * qty })
  }
  return finalize(lines, cat, interval)
}

export function quotePack(packCode, cat = catalog) {
  const pack = findPack(packCode, cat)
  if (!pack) throw new PricingError('unknown_pack', `Unknown pack ${packCode}`)
  return finalize([{ code: pack.code, kind: 'pack', qty: 1, unit: pack.price, total: pack.price }], cat, null)
}

function finalize(lines, cat, interval) {
  const subtotal = lines.reduce((s, l) => s + l.total, 0)
  const vat = vatOf(subtotal, cat)
  return { lines, subtotal, vat, total: subtotal + vat, currency: cat.currency, catalogVersion: cat.version, interval }
}

/**
 * Prorated charge (ex VAT) for moving from `fromSubtotal` to `toSubtotal`
 * for the remainder of the current period. Never negative: downgrades are
 * scheduled for the period end instead of refunded.
 */
export function prorate({ fromSubtotal, toSubtotal, periodStart, periodEnd, now = new Date() }) {
  const start = new Date(periodStart).getTime()
  const end = new Date(periodEnd).getTime()
  const t = new Date(now).getTime()
  if (!(end > start) || t >= end) return 0
  const remaining = Math.min(1, Math.max(0, (end - t) / (end - start)))
  return Math.max(0, Math.round((toSubtotal - fromSubtotal) * remaining))
}

/** Add one calendar month/year, clamping to the last day (Jan 31 → Feb 28/29). */
export function addInterval(date, interval, count = 1) {
  const d = new Date(date)
  const day = d.getUTCDate()
  const months = interval === 'year' ? 12 * count : count
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(day, lastDay))
  return target
}

/**
 * Effective limits: plan (or trial) limits + recurring add-ons + pack credits.
 * `null` means "not enforced" (legacy/comped workspaces).
 * @returns {{ requests:number|null, envelopes:number|null, storageBytes:number|null, seats:number|null }}
 */
export function effectiveLimits({ base, addons = [], credits = {} }, cat = catalog) {
  if (!base) return { requests: null, envelopes: null, storageBytes: null, seats: null }
  let storageGb = base.storageGb
  let seats = base.seats
  for (const { code, qty } of addons) {
    const a = findAddon(code, cat)
    if (!a) continue
    storageGb += (a.grants.storageGb || 0) * qty
    seats += (a.grants.seats || 0) * qty
  }
  return {
    requests: base.requests + (credits.requests || 0),
    envelopes: base.envelopes + (credits.envelopes || 0),
    storageBytes: storageGb * GB,
    seats,
  }
}

/** Monthly saving of each Suite plan vs buying both products at the same tier. */
export function suiteSavings(cat = catalog) {
  const out = {}
  for (const suite of cat.plans.filter((p) => p.family === 'suite')) {
    const c = cat.plans.find((p) => p.family === 'collect' && p.tier === suite.tier)
    const s = cat.plans.find((p) => p.family === 'sign' && p.tier === suite.tier)
    if (c && s) out[suite.code] = c.monthly + s.monthly - suite.monthly
  }
  return out
}

/** Rank used to tell upgrades from downgrades (higher monthly price = higher rank). */
export function planRank(code, cat = catalog) {
  return findPlan(code, cat)?.monthly ?? -1
}

export function formatMoney(minor, { currency = catalog.currency, locale = 'he-IL', decimals } = {}) {
  const whole = minor % 100 === 0
  return new Intl.NumberFormat(locale, {
    style: 'currency', currency,
    minimumFractionDigits: decimals ?? (whole ? 0 : 2), maximumFractionDigits: decimals ?? (whole ? 0 : 2),
  }).format(minor / 100)
}
