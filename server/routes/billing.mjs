/**
 * Workspace billing API (authenticated) and payment-provider callbacks (public).
 *
 * Roles: owners manage billing (plans, payment, cancellation); admins can
 * view it. Everyone else only sees the subscription summary in /auth/me.
 */
import { Router } from 'express'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { config } from '../config.mjs'
import { query, queryOne } from '../db/pool.mjs'
import { parse, notFound, requireUuid, badRequest } from '../lib/http.mjs'
import { requireAuth, requireRole } from '../middleware/auth.mjs'
import { rateLimit } from '../lib/rateLimit.mjs'
import { logger } from '../lib/logger.mjs'
import { catalog, suiteSavings } from '../../shared/billing/pricing.mjs'
import {
  billingState, startCheckout, changePlan, clearPendingChange, buyPack, cancelAtPeriodEnd, resumeSubscription,
  updateBillingDetails, syncCheckout, serializeSession, handleCallback, serializeInvoice, webhookQuery,
} from '../billing/service.mjs'
import { getProvider } from '../billing/providers/index.mjs'
import { sandboxSession, completeSandboxSession, SANDBOX_CARDS } from '../billing/providers/sandbox.mjs'

// ── Authenticated ──────────────────────────────────────────
export const billingRouter = Router()
billingRouter.use(requireAuth)

const ownerOnly = requireRole('owner')
const adminUp = requireRole('admin')

const selectionSchema = z.object({
  planCode: z.string().regex(/^[a-z0-9_]{1,40}$/),
  interval: z.enum(['month', 'year']),
  addons: z.record(z.string().regex(/^[a-z0-9_]{1,40}$/), z.number().int().min(0).max(100)).optional().default({}),
})
const languageOf = (req) => (req.get('accept-language')?.toLowerCase().startsWith('en') ? 'en' : 'he')

function idempotencyKey(req) {
  const k = req.get('idempotency-key')
  if (k === undefined) return randomUUID()
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(k)) throw badRequest('invalid_idempotency_key', 'Invalid Idempotency-Key header')
  return k
}

const moneyLimiter = rateLimit({ name: 'billing-money', limit: 20, windowMs: 10 * 60 * 1000, key: (req) => req.user.workspaceId })

billingRouter.get('/', adminUp, async (req, res) => {
  res.json(await billingState(req.user.workspaceId))
})

billingRouter.post('/checkout', ownerOnly, moneyLimiter, async (req, res) => {
  const sel = parse(selectionSchema, req.body)
  res.status(201).json(await startCheckout({
    workspaceId: req.user.workspaceId, user: req.user, kind: 'subscribe', selection: sel, idempotencyKey: idempotencyKey(req), language: languageOf(req),
  }))
})

billingRouter.post('/change', ownerOnly, moneyLimiter, async (req, res) => {
  const sel = parse(selectionSchema, req.body)
  res.json(await changePlan({ workspaceId: req.user.workspaceId, user: req.user, selection: sel, idempotencyKey: idempotencyKey(req), language: languageOf(req) }))
})

billingRouter.delete('/pending', ownerOnly, async (req, res) => {
  await clearPendingChange(req.user.workspaceId, req.user)
  res.json({ ok: true })
})

billingRouter.post('/packs', ownerOnly, moneyLimiter, async (req, res) => {
  const b = parse(z.object({ packCode: z.string().regex(/^[a-z0-9_]{1,40}$/) }), req.body)
  res.json(await buyPack({ workspaceId: req.user.workspaceId, user: req.user, packCode: b.packCode, idempotencyKey: idempotencyKey(req), language: languageOf(req) }))
})

billingRouter.post('/payment-method', ownerOnly, moneyLimiter, async (req, res) => {
  res.status(201).json(await startCheckout({
    workspaceId: req.user.workspaceId, user: req.user, kind: 'payment_method', selection: {}, idempotencyKey: idempotencyKey(req), language: languageOf(req),
  }))
})

billingRouter.post('/cancel', ownerOnly, async (req, res) => {
  const b = parse(z.object({ reason: z.enum(['too_expensive', 'missing_features', 'not_using', 'switching', 'other']).optional() }), req.body || {})
  res.json(await cancelAtPeriodEnd(req.user.workspaceId, req.user, b.reason))
})

billingRouter.post('/resume', ownerOnly, async (req, res) => {
  await resumeSubscription(req.user.workspaceId, req.user)
  res.json({ ok: true })
})

billingRouter.put('/details', ownerOnly, async (req, res) => {
  const b = parse(z.object({
    name: z.string().trim().max(120).optional().default(''),
    email: z.union([z.literal(''), z.string().trim().toLowerCase().email().max(254)]).optional().default(''),
    // Israeli business number (ח.פ / ע.מ) or ID: digits only, 5–12
    taxId: z.union([z.literal(''), z.string().trim().regex(/^\d{5,12}$/, 'Digits only')]).optional().default(''),
  }), req.body)
  await updateBillingDetails(req.user.workspaceId, req.user, b)
  res.json({ ok: true })
})

/** What the workspace needs (asked during onboarding; shapes recommendations). */
billingRouter.patch('/interest', adminUp, async (req, res) => {
  const b = parse(z.object({ interest: z.enum(['collect', 'sign', 'both']) }), req.body)
  await query('UPDATE workspace_subscriptions SET interest = $2 WHERE workspace_id = $1', [req.user.workspaceId, b.interest])
  res.json({ ok: true })
})

async function ownSession(req) {
  const s = await queryOne('SELECT * FROM checkout_sessions WHERE id = $1 AND workspace_id = $2', [requireUuid(req.params.id), req.user.workspaceId])
  if (!s) throw notFound()
  return s
}

billingRouter.get('/checkout/:id', adminUp, async (req, res) => {
  res.json(serializeSession(await ownSession(req)))
})

/** Return page: asks the provider (server-to-server) — the redirect itself proves nothing. */
billingRouter.post('/checkout/:id/sync', adminUp, rateLimit({ name: 'billing-sync', limit: 60, windowMs: 60 * 1000, key: (req) => req.user.id }), async (req, res) => {
  const s = await ownSession(req)
  const { session } = await syncCheckout(s.id, 'return')
  res.json(session)
})

billingRouter.get('/invoices/:id', adminUp, async (req, res) => {
  const inv = await queryOne('SELECT * FROM billing_invoices WHERE id = $1 AND workspace_id = $2', [requireUuid(req.params.id), req.user.workspaceId])
  if (!inv) throw notFound()
  const ws = await queryOne('SELECT name FROM workspaces WHERE id = $1', [req.user.workspaceId])
  const sub = await queryOne('SELECT billing_name, billing_tax_id FROM workspace_subscriptions WHERE workspace_id = $1', [req.user.workspaceId])
  res.json({ ...serializeInvoice(inv), billedTo: { name: sub?.billing_name || ws.name, taxId: sub?.billing_tax_id || '' }, provider: inv.provider })
})

// ── Public ─────────────────────────────────────────────────
export const publicBillingRouter = Router()

/** The catalog the marketing site and the billing page render from. */
export function publicCatalog() {
  return { ...catalog, savings: suiteSavings() }
}
publicBillingRouter.get('/catalog', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300')
  res.json(publicCatalog())
})

/**
 * Provider callback. Always answers 200 quickly (providers retry on errors),
 * after which the authoritative result has been fetched and applied.
 */
publicBillingRouter.post('/webhook/:provider', rateLimit({ name: 'billing-webhook', limit: 120, windowMs: 60 * 1000 }), async (req, res) => {
  const name = req.params.provider
  if (!['cardcom', 'sandbox'].includes(name)) throw notFound()
  try {
    const r = await handleCallback(name, req)
    if (r.status === 'ignored') logger.warn('billing_callback_ignored', { provider: name, reason: r.reason })
    res.json({ ok: true })
  } catch (err) {
    logger.error('billing_callback_failed', { provider: name, err })
    // 500 makes the provider retry; the reconciler also picks the session up.
    res.status(500).json({ ok: false })
  }
})

// Sandbox "hosted page" — simulation only, never available with a live provider.
function sandboxOnly(_req, _res, next) {
  if (getProvider().name !== 'sandbox') return next(notFound())
  next()
}

publicBillingRouter.get('/sandbox/:ref', sandboxOnly, async (req, res) => {
  const info = sandboxSession(req.params.ref)
  if (!info) throw notFound()
  const s = await queryOne(
    `SELECT cs.id, cs.kind, cs.quote, w.name AS workspace FROM checkout_sessions cs JOIN workspaces w ON w.id = cs.workspace_id
      WHERE cs.provider = 'sandbox' AND cs.provider_ref = $1`, [req.params.ref],
  )
  if (!s) throw notFound()
  res.json({ ...info, kind: s.kind, lines: s.quote.lines, subtotal: s.quote.subtotal, vat: s.quote.vat, workspace: s.workspace, cards: SANDBOX_CARDS })
})

publicBillingRouter.post('/sandbox/:ref/complete', sandboxOnly, async (req, res) => {
  const b = parse(z.object({ card: z.enum(['success', 'decline', 'renewal_decline', 'cancel']) }), req.body)
  const s = await queryOne(`SELECT id FROM checkout_sessions WHERE provider = 'sandbox' AND provider_ref = $1`, [req.params.ref])
  if (!s) throw notFound()
  const base = `${config.appBaseUrl}/app/billing/return?session=${s.id}`
  if (b.card === 'cancel') return res.json({ returnUrl: `${base}&result=canceled` })
  completeSandboxSession(req.params.ref, b.card)
  // Deliver the provider callback the way a real provider would (it carries only the reference).
  await handleCallback('sandbox', { query: webhookQuery(s.id), body: { ref: req.params.ref } })
  res.json({ returnUrl: b.card === 'decline' ? `${base}&result=failed` : base })
})

