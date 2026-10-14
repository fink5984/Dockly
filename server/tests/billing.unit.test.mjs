import { describe, it, expect, afterEach } from 'vitest'
import {
  catalog, quoteSubscription, quotePack, prorate, addInterval, effectiveLimits, suiteSavings, normalizeAddons, withVat, formatMoney,
} from '../../shared/billing/pricing.mjs'
import { effectiveStatus, usageWindow } from '../billing/access.mjs'
import { documentLines } from '../billing/providers/util.mjs'
import { encryptSecret, decryptSecret } from '../billing/secrets.mjs'

describe('catalog', () => {
  it('is internally consistent', () => {
    const codes = new Set()
    for (const p of catalog.plans) {
      expect(codes.has(p.code)).toBe(false)
      codes.add(p.code)
      expect(Number.isInteger(p.monthly) && p.monthly > 0).toBe(true)
      expect(p.products.length).toBeGreaterThan(0)
      // A plan grants quota only for the products it includes.
      expect(p.limits.requests > 0).toBe(p.products.includes('collect'))
      expect(p.limits.envelopes > 0).toBe(p.products.includes('sign'))
    }
    for (const pack of catalog.packs) expect(Object.keys(pack.grants)).toHaveLength(1)
    expect(catalog.trial.days).toBe(30)
    expect(catalog.trial.requiresCard).toBe(false)
    expect(catalog.provisional).toBe(true)
  })

  it('makes the combined plan cheaper than buying both products', () => {
    for (const saving of Object.values(suiteSavings())) expect(saving).toBeGreaterThan(0)
  })

  it('makes every tier upgrade raise every quota (no surprise downgrades)', () => {
    for (const family of ['collect', 'sign', 'suite']) {
      const s = catalog.plans.find((p) => p.family === family && p.tier === 'starter')
      const p = catalog.plans.find((x) => x.family === family && x.tier === 'pro')
      for (const k of ['requests', 'envelopes', 'storageGb', 'seats']) expect(p.limits[k]).toBeGreaterThanOrEqual(s.limits[k])
      expect(p.monthly).toBeGreaterThan(s.monthly)
    }
  })

  it('never promises unlimited usage', () => {
    for (const p of [...catalog.plans, { limits: catalog.trial.limits }]) {
      for (const v of Object.values(p.limits)) expect(Number.isFinite(v)).toBe(true)
    }
    for (const a of catalog.addons) expect(a.max).toBeGreaterThan(0)
  })
})

describe('pricing', () => {
  it('quotes monthly and yearly with VAT on the subtotal', () => {
    const m = quoteSubscription({ planCode: 'collect_starter', interval: 'month' })
    expect(m).toMatchObject({ subtotal: 8900, vat: 1602, total: 10502, currency: 'ILS' })
    const y = quoteSubscription({ planCode: 'collect_starter', interval: 'year' })
    expect(y.subtotal).toBe(8900 * catalog.yearlyMonthsCharged)
  })

  it('adds recurring add-ons and validates them', () => {
    const q = quoteSubscription({ planCode: 'suite_pro', interval: 'month', addons: { extra_seat: 2, storage_10gb: 1 } })
    expect(q.lines.map((l) => [l.code, l.total])).toEqual([['suite_pro', 33900], ['extra_seat', 5800], ['storage_10gb', 1900]])
    expect(() => normalizeAddons({ storage_10gb: 999 })).toThrow()
    expect(() => normalizeAddons({ storage_10gb: 1.5 })).toThrow()
    expect(() => normalizeAddons({ unlimited: 1 })).toThrow()
    expect(normalizeAddons({ storage_10gb: 0 })).toEqual([])
  })

  it('quotes packs', () => {
    expect(quotePack('requests_25')).toMatchObject({ subtotal: 4900, total: withVat(4900) })
    expect(() => quotePack('nope')).toThrow()
  })

  it('rounds VAT to the agora', () => {
    expect(withVat(1)).toBe(1)
    expect(withVat(3)).toBe(4) // 0.54 → 1
    expect(withVat(12345)).toBe(14567) // 2222.1 → 2222
  })

  it('prorates upgrades over the remaining period and never refunds', () => {
    const periodStart = '2026-01-01T00:00:00Z'
    const periodEnd = '2026-01-31T00:00:00Z'
    expect(prorate({ fromSubtotal: 10000, toSubtotal: 20000, periodStart, periodEnd, now: new Date('2026-01-16T00:00:00Z') })).toBe(5000)
    expect(prorate({ fromSubtotal: 20000, toSubtotal: 10000, periodStart, periodEnd, now: new Date('2026-01-16T00:00:00Z') })).toBe(0)
    expect(prorate({ fromSubtotal: 10000, toSubtotal: 20000, periodStart, periodEnd, now: new Date('2026-02-02T00:00:00Z') })).toBe(0)
    expect(prorate({ fromSubtotal: 10000, toSubtotal: 20000, periodStart, periodEnd, now: new Date('2025-12-01T00:00:00Z') })).toBe(10000)
  })

  it('adds months without skipping short months', () => {
    expect(addInterval('2026-01-31T10:00:00Z', 'month').toISOString()).toBe('2026-02-28T10:00:00.000Z')
    expect(addInterval('2028-01-31T10:00:00Z', 'month').toISOString()).toBe('2028-02-29T10:00:00.000Z')
    expect(addInterval('2026-03-15T00:00:00Z', 'year').toISOString()).toBe('2027-03-15T00:00:00.000Z')
    expect(addInterval('2026-01-31T00:00:00Z', 'month', 2).toISOString()).toBe('2026-03-31T00:00:00.000Z')
  })

  it('combines plan limits, add-ons and pack credits', () => {
    const l = effectiveLimits({ base: { requests: 40, envelopes: 0, storageGb: 10, seats: 3 }, addons: [{ code: 'storage_10gb', qty: 2 }, { code: 'extra_seat', qty: 1 }], credits: { requests: 25 } })
    expect(l).toEqual({ requests: 65, envelopes: 0, storageBytes: 30 * 1024 ** 3, seats: 4 })
    expect(effectiveLimits({ base: null })).toEqual({ requests: null, envelopes: null, storageBytes: null, seats: null })
  })

  it('formats money for both languages', () => {
    expect(formatMoney(12900, { locale: 'en-IL' })).toMatch(/129/)
    expect(formatMoney(10502, { locale: 'he-IL' })).toMatch(/105\.02/)
  })
})

describe('subscription status', () => {
  const now = new Date('2026-06-15T12:00:00Z')
  const past = '2026-06-15T11:00:00Z'
  const future = '2026-06-20T00:00:00Z'
  it('derives the effective status from timestamps', () => {
    expect(effectiveStatus({ status: 'trialing', trial_ends_at: future }, now)).toBe('trialing')
    expect(effectiveStatus({ status: 'trialing', trial_ends_at: past }, now)).toBe('expired')
    expect(effectiveStatus({ status: 'active', cancel_at_period_end: true, current_period_end: past }, now)).toBe('canceled')
    expect(effectiveStatus({ status: 'active', cancel_at_period_end: false, current_period_end: past }, now)).toBe('active')
    expect(effectiveStatus({ status: 'past_due', grace_ends_at: future }, now)).toBe('past_due')
    expect(effectiveStatus({ status: 'past_due', grace_ends_at: past }, now)).toBe('suspended')
    expect(effectiveStatus({ status: 'legacy', legacy_until: null }, now)).toBe('legacy')
    expect(effectiveStatus({ status: 'legacy', legacy_until: past }, now)).toBe('expired')
  })

  it('counts yearly plans in monthly windows', () => {
    const row = { plan_code: 'collect_pro', current_period_start: '2026-01-31T00:00:00Z' }
    const w = usageWindow(row, 'active', now)
    expect(w.start.toISOString()).toBe('2026-05-31T00:00:00.000Z')
    expect(w.end.toISOString()).toBe('2026-06-30T00:00:00.000Z')
  })

  it('counts a trial as one window', () => {
    const w = usageWindow({ trial_started_at: '2026-06-01T00:00:00Z', trial_ends_at: '2026-07-01T00:00:00Z' }, 'trialing', now)
    expect(w.start.toISOString()).toBe('2026-06-01T00:00:00.000Z')
  })
})

describe('payment token encryption', () => {
  it('round-trips and never contains the plaintext', () => {
    const blob = encryptSecret('84cc1f4f-c089-410b-9f93-6437ac9abba6')
    expect(blob).not.toContain('84cc1f4f')
    expect(decryptSecret(blob)).toBe('84cc1f4f-c089-410b-9f93-6437ac9abba6')
    expect(encryptSecret('x')).not.toBe(encryptSecret('x')) // random IV
  })
  it('detects tampering', () => {
    const blob = encryptSecret('token')
    const parts = blob.split('.')
    parts[3] = Buffer.from('tampered').toString('base64url')
    expect(() => decryptSecret(parts.join('.'))).toThrow()
  })
})

describe('provider document lines', () => {
  it('always sum exactly to the charged total', () => {
    const q = quoteSubscription({ planCode: 'suite_pro', interval: 'year', addons: { extra_seat: 3, storage_10gb: 2 } })
    const lines = documentLines(q.lines, q.total)
    expect(lines.reduce((s, l) => s + l.gross, 0)).toBe(q.total)
  })
})

describe('Cardcom adapter (recorded response shapes)', async () => {
  const { config } = await import('../config.mjs')
  const { cardcomProvider, __setCardcomTransport } = await import('../billing/providers/cardcom.mjs')
  const original = { ...config.billing.cardcom }
  const calls = []
  const use = (handler) => {
    Object.assign(config.billing.cardcom, { terminalNumber: 1000, apiName: 'test-api', apiPassword: 'pw' })
    __setCardcomTransport(async (path, body) => { calls.push({ path, body }); return handler(path, body) })
  }
  afterEach(() => { __setCardcomTransport(null); Object.assign(config.billing.cardcom, original); calls.length = 0 })

  // config is frozen at the top level but nested objects are plain; skip if not writable.
  const writable = Object.isFrozen(config.billing.cardcom) ? it.skip : it

  writable('creates a hosted page in major units with documents that sum to the amount', async () => {
    use(() => ({ ResponseCode: 0, Description: 'OK', LowProfileId: 'lp-1', Url: 'https://secure.cardcom.solutions/e/xyz' }))
    const q = quoteSubscription({ planCode: 'suite_starter', interval: 'month' })
    const r = await cardcomProvider.createCheckout({
      session: { id: 'sess-1', amount_total: q.total, currency: 'ILS' },
      customer: { name: 'Office Ltd', email: 'billing@example.test', taxId: '514000000' },
      lines: q.lines, interval: 'month', language: 'he', operation: 'ChargeAndCreateToken',
      urls: { success: 'https://app/s', failed: 'https://app/f', cancel: 'https://app/c', webhook: 'https://app/w' },
    })
    expect(r).toEqual({ ref: 'lp-1', redirectUrl: 'https://secure.cardcom.solutions/e/xyz' })
    const { path, body } = calls[0]
    expect(path).toBe('LowProfile/Create')
    expect(body).toMatchObject({ TerminalNumber: 1000, ApiName: 'test-api', Operation: 'ChargeAndCreateToken', ReturnValue: 'sess-1', Amount: 152.22, ISOCoinId: 1, Language: 'he', WebHookUrl: 'https://app/w' })
    const sum = body.Document.Products.reduce((s, p) => s + Math.round(p.TotalLineCost * 100), 0)
    expect(sum).toBe(q.total)
    expect(body.Document).toMatchObject({ TaxId: '514000000', Email: 'billing@example.test', DocumentTypeToCreate: 'TaxInvoiceAndReceipt' })
    expect(JSON.stringify(body)).not.toMatch(/CardNumber|CVV/)
  })

  writable('maps an approved GetLpResult, including the token and card display data', async () => {
    use(() => ({
      ResponseCode: 0, Description: 'OK', TerminalNumber: 1000, LowProfileId: 'lp-1', TranzactionId: 99887766, ReturnValue: 'sess-1', Operation: 'ChargeAndCreateToken',
      TokenInfo: { Token: 'tok-abc', TokenExDate: '20290101', CardYear: 2029, CardMonth: 4, TokenApprovalNumber: '123' },
      TranzactionInfo: { ResponseCode: 0, TranzactionId: 99887766, Amount: 152.22, CoinId: 1, Last4CardDigitsString: '1234', CardMonth: 4, CardYear: 29, Brand: 'Visa', DocumentNumber: 5001, DocumentUrl: 'https://doc' },
      DocumentInfo: { ResponseCode: 0, DocumentNumber: 5001, DocumentUrl: 'https://doc' },
    }))
    const r = await cardcomProvider.getCheckoutResult('lp-1')
    expect(r).toMatchObject({ status: 'approved', amount: 15222, currency: 'ILS', transactionId: '99887766', token: 'tok-abc', returnValue: 'sess-1', documentNumber: '5001' })
    expect(r.card).toEqual({ last4: '1234', expMonth: 4, expYear: 2029, brand: 'Visa' })
    expect(JSON.stringify(r.summary)).not.toContain('tok-abc')
  })

  writable('treats a declined transaction and a foreign terminal as not approved', async () => {
    use(() => ({ ResponseCode: 0, TerminalNumber: 1000, LowProfileId: 'lp-2', Operation: 'ChargeAndCreateToken', TranzactionInfo: { ResponseCode: 51, Amount: 10 } }))
    expect((await cardcomProvider.getCheckoutResult('lp-2')).status).toBe('declined')
    use(() => ({ ResponseCode: 0, TerminalNumber: 2000, LowProfileId: 'lp-3', TranzactionId: 1, Operation: 'ChargeAndCreateToken', TranzactionInfo: { ResponseCode: 0, TranzactionId: 1, Amount: 10, CoinId: 1 } }))
    const foreign = await cardcomProvider.getCheckoutResult('lp-3')
    expect(foreign.status).toBe('pending')
    expect(foreign.terminalMismatch).toBe(true)
  })

  writable('charges a token with an idempotency key and resolves duplicates by lookup', async () => {
    use((path) => (path === 'Transactions/Transaction'
      ? { ResponseCode: 6, Description: 'Duplicate ExternalUniqTranId' }
      : { ResponseCode: 0, TranzactionId: 555, Amount: 105.02, CoinId: 1, DocumentNumber: 7 }))
    const r = await cardcomProvider.chargeToken({ token: 'tok', card: { expMonth: 4, expYear: 2029 }, amount: 10502, currency: 'ILS', idempotencyKey: 'dk-DK-1001-1', customer: { name: 'A', email: '' }, lines: [{ code: 'collect_starter', kind: 'plan', qty: 1, total: 8900 }], language: 'he', interval: 'month' })
    expect(calls[0].body).toMatchObject({ Token: 'tok', CardExpirationMMYY: '0429', ExternalUniqTranId: 'dk-DK-1001-1', Amount: 105.02 })
    expect(calls[1].path).toBe('Transactions/GetTransactionByExternalUniqTran')
    expect(r).toMatchObject({ status: 'approved', transactionId: '555', amount: 10502 })
  })

  writable('reports an unknown outcome when Cardcom is unreachable', async () => {
    use(() => { throw Object.assign(new Error('x'), {}) })
    __setCardcomTransport(null)
    Object.assign(config.billing.cardcom, { baseUrl: 'http://127.0.0.1:9/api/v11', timeoutMs: 500 })
    const r = await cardcomProvider.chargeToken({ token: 't', card: { expMonth: 1, expYear: 2030 }, amount: 100, currency: 'ILS', idempotencyKey: 'k', customer: {}, lines: [{ code: 'x', kind: 'plan', qty: 1, total: 100 }] })
    expect(r.status).toBe('error')
  })
})
