/**
 * Billing: trials, entitlements, quotas, checkout, webhooks, renewals, dunning.
 * Runs against the sandbox provider (the test environment never has a live one).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { startApp, stopApp, newOwner, samplePdf, documentTypeId, skipIntegration, Client } from './helpers.mjs'

let query, queryOne, runBillingTick, sandboxControls, __setProvider

const wsOf = (c) => c.me.user.workspaceId
const sub = (c) => queryOne('SELECT * FROM workspace_subscriptions WHERE workspace_id = $1', [wsOf(c)])

async function mkRequest(c, typeId, title = 'Pack') {
  return c.post('/api/requests', { newClient: { name: 'Client A', phone: '050-765-4321' }, title, items: [{ documentTypeId: typeId, required: true }] })
}

async function mkEnvelope(c) {
  const client = (await c.post('/api/clients', { name: 'Signer', email: 'signer@example.test' })).data
  const up = await c.upload('/api/signatures/uploads', await samplePdf(1), 'a.pdf', 'application/pdf')
  if (up.status !== 201) return up
  return c.post('/api/signatures', { clientId: client.id, title: 'Agreement', document: up.data, canvasWidth: 750, fields: [{ type: 'name', page: 1, x: 1, y: 1, width: 100, height: 20 }] })
}

/** Run a hosted checkout through the sandbox page the way a browser would. */
async function payWithSandbox(base, startResponse, card = 'success') {
  expect(startResponse.status, JSON.stringify(startResponse.data)).toBeLessThan(300)
  const ref = new URL(startResponse.data.redirectUrl).pathname.split('/').pop()
  const page = await new Client(base).get(`/api/public/billing/sandbox/${ref}`)
  expect(page.status).toBe(200)
  const done = await new Client(base).post(`/api/public/billing/sandbox/${ref}/complete`, { card })
  expect(done.status).toBe(200)
  return { ref, sessionId: startResponse.data.sessionId }
}

async function subscribe(base, c, planCode = 'suite_starter', interval = 'month', card = 'success', addons = {}) {
  const r = await c.post('/api/billing/checkout', { planCode, interval, addons })
  return payWithSandbox(base, r, card)
}

describe.skipIf(skipIntegration())('billing', () => {
  let base, anon
  beforeAll(async () => {
    base = await startApp()
    anon = new Client(base)
    ;({ query, queryOne } = await import('../db/pool.mjs'))
    ;({ runBillingTick } = await import('../billing/service.mjs'))
    ;({ sandboxControls } = await import('../billing/providers/sandbox.mjs'))
    ;({ __setProvider } = await import('../billing/providers/index.mjs'))
  })
  afterAll(stopApp)
  beforeEach(() => { __setProvider(null) })

  describe('trials', () => {
    it('starts every new workspace on a 30-day trial with no card', async () => {
      const c = await newOwner(base)
      const me = await c.get('/api/auth/me')
      expect(me.data.billing.status).toBe('trialing')
      expect(me.data.billing.products).toEqual(['collect', 'sign'])
      const days = (new Date(me.data.billing.trialEndsAt) - Date.now()) / 86_400_000
      expect(days).toBeGreaterThan(29.9)
      expect(days).toBeLessThanOrEqual(30.1)
      const b = await c.get('/api/billing')
      expect(b.status).toBe(200)
      expect(b.data.subscription.paymentMethod).toBeNull()
      expect(b.data.entitlements.limits.requests).toBe(25)
      expect(b.data.provider.name).toBe('sandbox')
      expect(b.data.provider.live).toBe(false)
    })

    it('enforces the trial request quota atomically and gives units back on failure', async () => {
      const c = await newOwner(base)
      const t = await documentTypeId(c)
      expect((await mkRequest(c, t)).status).toBe(201)
      // A create that fails validation after the quota check must not consume a unit.
      const bad = await c.post('/api/requests', { clientId: '00000000-0000-4000-8000-000000000000', title: 'x', items: [{ documentTypeId: t, required: true }] })
      expect(bad.status).toBe(404)
      const used = await queryOne(`SELECT used FROM usage_counters WHERE workspace_id = $1 AND metric = 'requests'`, [wsOf(c)])
      expect(used.used).toBe(1)
      await query(`UPDATE usage_counters SET used = 25 WHERE workspace_id = $1 AND metric = 'requests'`, [wsOf(c)])
      const over = await mkRequest(c, t)
      expect(over.status).toBe(402)
      expect(over.data.error.code).toBe('quota_exceeded')
      expect(over.data.error.details).toMatchObject({ metric: 'requests', limit: 25, upgrade: true })
      // Concurrent creates at the boundary can't overshoot.
      await query(`UPDATE usage_counters SET used = 24 WHERE workspace_id = $1 AND metric = 'requests'`, [wsOf(c)])
      const results = await Promise.all([mkRequest(c, t), mkRequest(c, t), mkRequest(c, t)])
      expect(results.filter((r) => r.status === 201)).toHaveLength(1)
      expect(results.filter((r) => r.status === 402)).toHaveLength(2)
    })

    it('makes an expired trial read-only without losing data or breaking client links', async () => {
      const c = await newOwner(base)
      const t = await documentTypeId(c)
      const req = (await mkRequest(c, t)).data.request
      await query(`UPDATE workspace_subscriptions SET trial_ends_at = now() - interval '1 minute' WHERE workspace_id = $1`, [wsOf(c)])
      // Enforcement doesn't wait for the scheduler.
      expect((await c.get('/api/auth/me')).data.billing).toMatchObject({ status: 'expired', readOnly: true })
      const blocked = await mkRequest(c, t)
      expect(blocked.status).toBe(402)
      expect(blocked.data.error.code).toBe('subscription_inactive')
      expect((await c.post(`/api/requests/${req.id}/send`, { channel: 'whatsapp', kind: 'initial' })).data.error.code).toBe('subscription_inactive')
      // Reading still works …
      expect((await c.get(`/api/requests/${req.id}`)).status).toBe(200)
      expect((await c.get('/api/requests')).status).toBe(200)
      // … and the client can still upload to a link they already have.
      const up = await anon.upload(`/api/public/portal/${req.publicToken}/documents/${req.requiredDocuments[0].id}`, await samplePdf(1), 'id.pdf', 'application/pdf')
      expect(up.status).toBe(201)
      // The scheduler records the expiry and notifies.
      const stats = await runBillingTick()
      expect(stats.trialsExpired).toBeGreaterThanOrEqual(1)
      expect((await sub(c)).status).toBe('expired')
      const n = await c.get('/api/notifications')
      expect(n.data.some((x) => /trial/i.test(x.title))).toBe(true)
    })

    it('sends trial reminders once per milestone', async () => {
      const c = await newOwner(base)
      await query(`UPDATE workspace_subscriptions SET trial_ends_at = now() + interval '2 days 1 hour' WHERE workspace_id = $1`, [wsOf(c)])
      await runBillingTick()
      await runBillingTick()
      const n = (await c.get('/api/notifications')).data.filter((x) => /trial ends/i.test(x.title))
      expect(n).toHaveLength(1)
      expect((await sub(c)).trial_reminders_sent).toEqual(expect.arrayContaining([3, 7]))
    })
  })

  describe('existing (legacy) workspaces', () => {
    it('are never limited, billed or locked out', async () => {
      const c = await newOwner(base)
      await query(`UPDATE workspace_subscriptions SET status = 'legacy', trial_started_at = NULL, trial_ends_at = NULL WHERE workspace_id = $1`, [wsOf(c)])
      const t = await documentTypeId(c)
      await query(`INSERT INTO usage_counters (workspace_id, metric, period_start, used) VALUES ($1, 'requests', date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC', 10000)`, [wsOf(c)])
      expect((await mkRequest(c, t)).status).toBe(201)
      expect((await mkEnvelope(c)).status).toBe(201)
      const b = (await c.get('/api/billing')).data
      expect(b.subscription.status).toBe('legacy')
      expect(b.entitlements.limits.requests).toBeNull()
      expect(b.usage.requests).toBe(10001)
      await runBillingTick()
      expect((await sub(c)).status).toBe('legacy')
      expect((await queryOne('SELECT count(*)::int AS n FROM billing_invoices WHERE workspace_id = $1', [wsOf(c)])).n).toBe(0)
    })
  })

  describe('checkout', () => {
    it('activates only after the provider confirms, adds remaining trial days, and records the conversion', async () => {
      const c = await newOwner(base)
      const start = await c.post('/api/billing/checkout', { planCode: 'suite_starter', interval: 'month' })
      expect(start.status).toBe(201)
      // The return page (redirect) alone changes nothing.
      const early = await c.post(`/api/billing/checkout/${start.data.sessionId}/sync`)
      expect(early.data.status).toBe('open')
      expect((await sub(c)).status).toBe('trialing')

      await payWithSandbox(base, start)
      const s = await sub(c)
      expect(s.status).toBe('active')
      expect(s.plan_code).toBe('suite_starter')
      expect(s.payment_token_enc).toMatch(/^v1\./)
      expect(s.payment_token_enc).not.toContain('sbx_')
      expect(s.card_last4).toBe('4242')
      // ~30 trial days kept + one month.
      const days = (new Date(s.current_period_end) - Date.now()) / 86_400_000
      expect(days).toBeGreaterThan(57)
      const inv = await queryOne('SELECT * FROM billing_invoices WHERE workspace_id = $1', [wsOf(c)])
      expect(inv).toMatchObject({ kind: 'subscription', status: 'paid', subtotal: 12900, vat: 2322, total: 15222 })
      const f = await queryOne(`SELECT props FROM funnel_events WHERE workspace_id = $1 AND event = 'trial_to_paid'`, [wsOf(c)])
      expect(f.props).toMatchObject({ plan: 'suite_starter', interval: 'month', from: 'trialing' })
      // Card details never leave the server.
      const b = await c.get('/api/billing')
      expect(JSON.stringify(b.data)).not.toMatch(/sbx_|payment_token/)
      expect(b.data.subscription.paymentMethod).toMatchObject({ last4: '4242' })
    })

    it('reuses the session for a retried click (Idempotency-Key)', async () => {
      const c = await newOwner(base)
      const headers = { 'idempotency-key': 'click-1234567890' }
      const a = await c.post('/api/billing/checkout', { planCode: 'collect_starter', interval: 'month' }, { headers })
      const b = await c.post('/api/billing/checkout', { planCode: 'collect_starter', interval: 'month' }, { headers })
      expect(b.data.sessionId).toBe(a.data.sessionId)
      expect(b.data.redirectUrl).toBe(a.data.redirectUrl)
    })

    it('rejects unknown plans and never takes a price from the client', async () => {
      const c = await newOwner(base)
      expect((await c.post('/api/billing/checkout', { planCode: 'free_forever', interval: 'month' })).data.error.code).toBe('unknown_plan')
      const r = await c.post('/api/billing/checkout', { planCode: 'collect_starter', interval: 'month', amount: 1, total: 1 })
      const s = await queryOne('SELECT amount_total FROM checkout_sessions WHERE id = $1', [r.data.sessionId])
      expect(s.amount_total).toBe(10502) // 89.00 + 18% VAT
    })

    it('refuses a provider result whose amount differs from the quote', async () => {
      const c = await newOwner(base)
      const start = await c.post('/api/billing/checkout', { planCode: 'suite_pro', interval: 'year' })
      const ref = new URL(start.data.redirectUrl).pathname.split('/').pop()
      const { completeSandboxSession } = await import('../billing/providers/sandbox.mjs')
      completeSandboxSession(ref, 'success')
      sandboxControls.tamper(ref, { amount: 100 })
      const synced = await c.post(`/api/billing/checkout/${start.data.sessionId}/sync`)
      expect(synced.data).toMatchObject({ status: 'failed', failureCode: 'amount_mismatch' })
      expect((await sub(c)).status).toBe('trialing')
      expect((await queryOne(`SELECT count(*)::int AS n FROM billing_events WHERE workspace_id = $1 AND type = 'payment_mismatch'`, [wsOf(c)])).n).toBe(1)
    })

    it('handles a declined card', async () => {
      const c = await newOwner(base)
      const { sessionId } = await subscribe(base, c, 'collect_starter', 'month', 'decline')
      expect((await c.get(`/api/billing/checkout/${sessionId}`)).data.status).toBe('failed')
      expect((await sub(c)).status).toBe('trialing')
    })

    it('ignores forged and replayed callbacks', async () => {
      const c = await newOwner(base)
      const start = await c.post('/api/billing/checkout', { planCode: 'collect_starter', interval: 'month' })
      const ref = new URL(start.data.redirectUrl).pathname.split('/').pop()
      // Forged: wrong signature, and a body claiming success.
      const forged = await anon.post(`/api/public/billing/webhook/sandbox?sid=${start.data.sessionId}&sig=bogus`, { ref, status: 'approved', amount: 10502 })
      expect(forged.status).toBe(200)
      expect((await sub(c)).status).toBe('trialing')
      // Correct signature but the payment never happened: the provider says pending.
      const { webhookQuery } = await import('../billing/service.mjs')
      const q = new URLSearchParams(webhookQuery(start.data.sessionId)).toString()
      await anon.post(`/api/public/billing/webhook/sandbox?${q}`, { ref, status: 'approved' })
      expect((await sub(c)).status).toBe('trialing')
      // Real payment, then the same callback delivered 3 more times.
      await payWithSandbox(base, start)
      for (let i = 0; i < 3; i++) expect((await anon.post(`/api/public/billing/webhook/sandbox?${q}`, { ref })).status).toBe(200)
      expect((await queryOne('SELECT count(*)::int AS n FROM billing_invoices WHERE workspace_id = $1', [wsOf(c)])).n).toBe(1)
      expect((await queryOne(`SELECT count(*)::int AS n FROM payment_events WHERE checkout_session_id = $1`, [start.data.sessionId])).n).toBe(1)
      // A reference from another session is rejected.
      const other = await (await newOwner(base)).post('/api/billing/checkout', { planCode: 'collect_starter', interval: 'month' })
      const otherRef = new URL(other.data.redirectUrl).pathname.split('/').pop()
      await anon.post(`/api/public/billing/webhook/sandbox?${q}`, { ref: otherRef })
      expect((await queryOne('SELECT status FROM checkout_sessions WHERE id = $1', [other.data.sessionId])).status).toBe('open')
    })

    it('recovers a lost callback through reconciliation', async () => {
      const c = await newOwner(base)
      const start = await c.post('/api/billing/checkout', { planCode: 'sign_starter', interval: 'month' })
      const ref = new URL(start.data.redirectUrl).pathname.split('/').pop()
      const { completeSandboxSession } = await import('../billing/providers/sandbox.mjs')
      completeSandboxSession(ref, 'success') // paid, but no callback arrives
      await query(`UPDATE checkout_sessions SET created_at = now() - interval '5 minutes' WHERE id = $1`, [start.data.sessionId])
      const stats = await runBillingTick()
      expect(stats.reconciled).toBeGreaterThanOrEqual(1)
      expect((await sub(c)).status).toBe('active')
    })

    it('says so when online payment is not available', async () => {
      const c = await newOwner(base)
      __setProvider('disabled')
      const r = await c.post('/api/billing/checkout', { planCode: 'collect_starter', interval: 'month' })
      expect(r.status).toBe(503)
      expect(r.data.error.code).toBe('billing_unavailable')
      expect((await c.get('/api/billing')).data.provider).toMatchObject({ name: 'disabled', available: false })
    })
  })

  describe('entitlements', () => {
    it('limits a single-product plan to that product', async () => {
      const c = await newOwner(base)
      await subscribe(base, c, 'collect_starter')
      const env = await mkEnvelope(c)
      expect(env.status).toBe(402)
      expect(env.data.error.code).toBe('plan_required')
      expect((await mkRequest(c, await documentTypeId(c))).status).toBe(201)
    })

    it('limits seats (members + open invitations)', async () => {
      const c = await newOwner(base)
      expect((await c.post('/api/team/invites', { email: `a${Date.now()}@example.test`, role: 'member' })).status).toBe(201)
      expect((await c.post('/api/team/invites', { email: `b${Date.now()}@example.test`, role: 'member' })).status).toBe(201)
      const third = await c.post('/api/team/invites', { email: `c${Date.now()}@example.test`, role: 'member' })
      expect(third.status).toBe(402)
      expect(third.data.error.code).toBe('seat_limit_reached')
    })

    it('limits storage, with a small buffer for client uploads', async () => {
      const c = await newOwner(base)
      const t = await documentTypeId(c)
      const req = (await mkRequest(c, t)).data.request
      const doc = req.requiredDocuments[0]
      // Simulate a full workspace (2 GB trial limit).
      await query(
        `INSERT INTO case_document_files (workspace_id, case_id, case_document_id, storage_key, file_name, mime_type, size_bytes)
         VALUES ($1,$2,$3,'x','big.pdf','application/pdf', 2147483648)`, [wsOf(c), req.id, doc.id],
      )
      const staff = await c.upload(`/api/requests/${req.id}/documents/${doc.id}/upload`, await samplePdf(1), 'a.pdf', 'application/pdf')
      expect(staff.status).toBe(402)
      expect(staff.data.error.code).toBe('storage_limit_reached')
      const portal = await anon.upload(`/api/public/portal/${req.publicToken}/documents/${doc.id}`, await samplePdf(1), 'a.pdf', 'application/pdf')
      expect(portal.status).toBe(201)
      expect((await c.get('/api/billing')).data.usage.storageBytes).toBeGreaterThan(2147483648)
    })

    it('lets owners manage billing, admins view it, and nobody else', async () => {
      const c = await newOwner(base)
      const inv = await c.post('/api/team/invites', { email: `adm${Date.now()}@example.test`, role: 'admin' })
      const admin = new Client(base)
      await admin.post(`/api/auth/invite/${inv.data.link.split('/').pop()}/accept`, { name: 'Admin', password: 'correct horse battery' })
      expect((await admin.get('/api/billing')).status).toBe(200)
      expect((await admin.post('/api/billing/checkout', { planCode: 'collect_starter', interval: 'month' })).status).toBe(403)
      expect((await admin.post('/api/billing/cancel')).status).toBe(403)
      expect((await anon.get('/api/billing')).status).toBe(401)
    })
  })

  describe('lifecycle', () => {
    it('renews once per period at the snapshot price', async () => {
      const c = await newOwner(base)
      await subscribe(base, c, 'collect_starter')
      await query(`UPDATE workspace_subscriptions SET current_period_end = now() - interval '1 minute' WHERE workspace_id = $1`, [wsOf(c)])
      const before = await sub(c)
      await runBillingTick()
      await runBillingTick()
      const renewals = await query(`SELECT * FROM billing_invoices WHERE workspace_id = $1 AND kind = 'renewal'`, [wsOf(c)])
      expect(renewals).toHaveLength(1)
      expect(renewals[0]).toMatchObject({ status: 'paid', total: 10502 })
      const after = await sub(c)
      expect(after.status).toBe('active')
      expect(new Date(after.current_period_start).getTime()).toBe(new Date(before.current_period_end).getTime())
      expect(new Date(after.current_period_end) > new Date()).toBe(true)
    })

    it('retries a declined renewal, keeps access during grace, then suspends, and recovers on a new card', async () => {
      const c = await newOwner(base)
      await subscribe(base, c, 'collect_starter', 'month', 'renewal_decline')
      await query(`UPDATE workspace_subscriptions SET current_period_end = now() - interval '1 minute' WHERE workspace_id = $1`, [wsOf(c)])
      await runBillingTick()
      let s = await sub(c)
      expect(s.status).toBe('past_due')
      expect(new Date(s.grace_ends_at) - Date.now()).toBeGreaterThan(6.9 * 86_400_000)
      expect(s.next_retry_at).not.toBeNull()
      // Still fully usable during grace.
      expect((await mkRequest(c, await documentTypeId(c))).status).toBe(201)
      // A due retry fails again and moves to the next retry slot.
      await query(`UPDATE workspace_subscriptions SET next_retry_at = now() - interval '1 minute' WHERE workspace_id = $1`, [wsOf(c)])
      await runBillingTick()
      s = await sub(c)
      expect(s.retry_count).toBe(1)
      // Grace runs out → suspended (read-only).
      await query(`UPDATE workspace_subscriptions SET grace_ends_at = now() - interval '1 minute' WHERE workspace_id = $1`, [wsOf(c)])
      await runBillingTick()
      expect((await sub(c)).status).toBe('suspended')
      expect((await mkRequest(c, await documentTypeId(c, 'Other'))).data.error.code).toBe('subscription_inactive')
      // The owner adds a working card → the outstanding invoice is collected immediately.
      const pm = await c.post('/api/billing/payment-method')
      await payWithSandbox(base, pm, 'success')
      s = await sub(c)
      expect(s.status).toBe('active')
      expect(s.card_last4).toBe('4242')
      const inv = await queryOne(`SELECT * FROM billing_invoices WHERE workspace_id = $1 AND kind = 'renewal'`, [wsOf(c)])
      expect(inv.status).toBe('paid')
      expect(new Date(s.current_period_end) > new Date()).toBe(true)
    })

    it('never double-charges when a charge response is lost', async () => {
      const c = await newOwner(base)
      await subscribe(base, c, 'collect_starter')
      await query(`UPDATE workspace_subscriptions SET current_period_end = now() - interval '1 minute' WHERE workspace_id = $1`, [wsOf(c)])
      sandboxControls.failNextCharge('timeout') // charged at the provider, response lost
      const stats = await runBillingTick()
      expect(stats.unknown).toBe(1)
      let inv = await queryOne(`SELECT * FROM billing_invoices WHERE workspace_id = $1 AND kind = 'renewal'`, [wsOf(c)])
      expect(inv).toMatchObject({ status: 'pending', last_error: 'unknown_outcome', attempt_count: 1 })
      await query(`UPDATE billing_invoices SET updated_at = now() - interval '5 minutes' WHERE id = $1`, [inv.id])
      await runBillingTick()
      inv = await queryOne('SELECT * FROM billing_invoices WHERE id = $1', [inv.id])
      expect(inv).toMatchObject({ status: 'paid', attempt_count: 1 })
      expect((await sub(c)).status).toBe('active')
    })

    it('prorates upgrades immediately and schedules downgrades for renewal', async () => {
      const c = await newOwner(base)
      await subscribe(base, c, 'suite_starter')
      const up = await c.post('/api/billing/change', { planCode: 'suite_pro', interval: 'month' })
      expect(up.data.action).toBe('applied')
      let s = await sub(c)
      expect(s.plan_code).toBe('suite_pro')
      expect(s.period_subtotal).toBe(33900)
      const pr = await queryOne(`SELECT * FROM billing_invoices WHERE workspace_id = $1 AND kind = 'proration'`, [wsOf(c)])
      expect(pr.status).toBe('paid')
      // Full remaining period (≈ trial + month) ≈ the full price difference, never more.
      expect(pr.subtotal).toBeGreaterThan(0)
      expect(pr.subtotal).toBeLessThanOrEqual(33900 - 12900)
      expect((await c.get('/api/billing')).data.entitlements.limits.requests).toBe(200)

      const down = await c.post('/api/billing/change', { planCode: 'collect_starter', interval: 'month' })
      expect(down.data.action).toBe('scheduled')
      s = await sub(c)
      expect(s.plan_code).toBe('suite_pro')
      expect(s.pending_plan_code).toBe('collect_starter')
      await query(`UPDATE workspace_subscriptions SET current_period_end = now() - interval '1 minute' WHERE workspace_id = $1`, [wsOf(c)])
      await runBillingTick()
      s = await sub(c)
      expect(s).toMatchObject({ plan_code: 'collect_starter', pending_plan_code: null, period_subtotal: 8900 })
      const renewal = await queryOne(`SELECT total FROM billing_invoices WHERE workspace_id = $1 AND kind = 'renewal'`, [wsOf(c)])
      expect(renewal.total).toBe(10502)
    })

    it('adds a pack to this period’s quota', async () => {
      const c = await newOwner(base)
      await subscribe(base, c, 'collect_starter')
      expect((await c.get('/api/billing')).data.entitlements.limits.requests).toBe(40)
      const r = await c.post('/api/billing/packs', { packCode: 'requests_25' })
      expect(r.data.action).toBe('applied')
      expect((await c.get('/api/billing')).data.entitlements.limits.requests).toBe(65)
      // A pack for a product outside the plan is refused.
      expect((await c.post('/api/billing/packs', { packCode: 'envelopes_25' })).data.error.code).toBe('plan_required')
    })

    it('allows only one on-demand charge in flight per workspace', async () => {
      const c = await newOwner(base)
      await subscribe(base, c, 'collect_starter')
      // A charge whose outcome is still unknown blocks a second one (e.g. a parallel click in another tab).
      await query(
        `INSERT INTO billing_invoices (workspace_id, kind, status, lines, subtotal, vat, total, currency, last_error)
         VALUES ($1, 'pack', 'pending', '[]', 4900, 882, 5782, 'ILS', 'unknown_outcome')`, [wsOf(c)],
      )
      const r = await c.post('/api/billing/packs', { packCode: 'requests_25' })
      expect(r.status).toBe(409)
      expect(r.data.error.code).toBe('payment_in_progress')
    })

    it('cancels at period end, can be resumed, and ends read-only', async () => {
      const c = await newOwner(base)
      await subscribe(base, c, 'collect_starter')
      expect((await c.post('/api/billing/cancel', { reason: 'too_expensive' })).status).toBe(200)
      expect((await sub(c)).cancel_at_period_end).toBe(true)
      expect((await c.get('/api/auth/me')).data.billing).toMatchObject({ status: 'active', cancelAtPeriodEnd: true })
      expect((await c.post('/api/billing/resume')).status).toBe(200)
      expect((await sub(c)).cancel_at_period_end).toBe(false)
      await c.post('/api/billing/cancel')
      await query(`UPDATE workspace_subscriptions SET current_period_end = now() - interval '1 minute' WHERE workspace_id = $1`, [wsOf(c)])
      await runBillingTick()
      expect((await sub(c)).status).toBe('canceled')
      expect((await queryOne(`SELECT count(*)::int AS n FROM billing_invoices WHERE workspace_id = $1 AND kind = 'renewal'`, [wsOf(c)])).n).toBe(0)
      expect((await mkRequest(c, await documentTypeId(c))).data.error.code).toBe('subscription_inactive')
      // Re-subscribing works from the cancelled state.
      await subscribe(base, c, 'collect_starter')
      expect((await sub(c)).status).toBe('active')
    })

    it('keeps an audit trail that cannot be rewritten', async () => {
      const c = await newOwner(base)
      await subscribe(base, c, 'collect_starter')
      const types = (await query('SELECT type FROM billing_events WHERE workspace_id = $1 ORDER BY id', [wsOf(c)])).map((r) => r.type)
      expect(types).toEqual(expect.arrayContaining(['checkout_started', 'subscription_started']))
      await expect(query('UPDATE billing_events SET type = $2 WHERE workspace_id = $1', [wsOf(c), 'x'])).rejects.toThrow(/append-only/)
    })
  })

  describe('funnel analytics', () => {
    it('records product milestones once, server-side, without personal data', async () => {
      const c = await newOwner(base)
      const t = await documentTypeId(c)
      await mkRequest(c, t)
      await mkRequest(c, t)
      const rows = await query('SELECT event, props, session_id FROM funnel_events WHERE workspace_id = $1 ORDER BY id', [wsOf(c)])
      expect(rows.map((r) => r.event)).toEqual(['signup', 'onboarding_completed', 'first_request'])
      expect(JSON.stringify(rows)).not.toMatch(/@|example\.test|Owner|Client A/)
    })

    it('keeps attribution from signup, filtered to the whitelist', async () => {
      const { resetRateLimits } = await import('../lib/rateLimit.mjs')
      resetRateLimits()
      const c = new Client(base)
      const r = await c.post('/api/auth/signup', {
        email: `attr${Date.now()}@example.test`, password: 'correct horse battery', name: 'Attr', language: 'he',
        attribution: { sessionId: 'abcDEF123_-xyz', utm_source: 'newsletter', plan: 'suite_starter', email: 'leak@example.test', page: '/<script>' },
      })
      const row = await queryOne(`SELECT props, session_id FROM funnel_events WHERE workspace_id = $1 AND event = 'signup'`, [r.data.user.workspaceId])
      expect(row.session_id).toBe('abcDEF123_-xyz')
      expect(row.props).toEqual({ utm_source: 'newsletter', plan: 'suite_starter', lang: 'he' })
    })

    it('accepts anonymous landing events, honoring Do Not Track and Global Privacy Control', async () => {
      const count = async () => (await queryOne(`SELECT count(*)::int AS n FROM funnel_events WHERE event = 'pricing_viewed'`)).n
      const before = await count()
      expect((await anon.post('/api/public/events', { event: 'pricing_viewed', sessionId: 'sess_12345678', props: { lang: 'en', device: 'mobile', ip: '1.2.3.4' } })).status).toBe(204)
      expect(await count()).toBe(before + 1)
      await anon.post('/api/public/events', { event: 'pricing_viewed', sessionId: 'sess_12345678' }, { headers: { dnt: '1' } })
      await anon.post('/api/public/events', { event: 'pricing_viewed', sessionId: 'sess_12345678' }, { headers: { 'sec-gpc': '1' } })
      await anon.post('/api/public/events', { event: 'trial_to_paid' })
      expect(await count()).toBe(before + 1)
      const last = await queryOne(`SELECT props FROM funnel_events WHERE event = 'pricing_viewed' ORDER BY id DESC LIMIT 1`)
      expect(last.props).toEqual({ lang: 'en', device: 'mobile' })
      expect((await queryOne(`SELECT count(*)::int AS n FROM funnel_events WHERE event = 'trial_to_paid' AND workspace_id IS NULL`)).n).toBe(0)
    })
  })

  describe('public catalog', () => {
    it('serves the catalog the marketing site renders from', async () => {
      const r = await anon.get('/api/public/billing/catalog')
      expect(r.status).toBe(200)
      expect(r.data.provisional).toBe(true)
      expect(r.data.plans.map((p) => p.code)).toContain('suite_starter')
      expect(r.data.savings.suite_starter).toBeGreaterThan(0)
    })
  })
})
