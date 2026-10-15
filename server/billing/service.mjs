/**
 * Billing service: checkout, verified payment application, plan changes,
 * packs, cancellation, renewals and dunning.
 *
 * Invariants
 *  - Prices are computed here from the catalog; the browser only sends codes.
 *  - A subscription changes only after the provider's server-to-server result
 *    is fetched and matches the checkout session (reference, return value,
 *    amount, currency, terminal). Redirects and callbacks are just triggers.
 *  - Every application is idempotent: checkout sessions are locked and move
 *    `open → completed` once; invoices are unique per provider transaction
 *    and per renewal period; callbacks are de-duplicated in payment_events.
 *  - Network calls to the provider never happen inside a DB transaction.
 *  - Charges carry a per-attempt idempotency key. An attempt with an unknown
 *    outcome (timeout) is looked up before any retry, so a customer is never
 *    charged twice for one invoice.
 */
import { createHmac } from 'crypto'
import { config } from '../config.mjs'
import { pool, query, queryOne, withTransaction } from '../db/pool.mjs'
import { HttpError, badRequest, conflict, notFound } from '../lib/http.mjs'
import { logger } from '../lib/logger.mjs'
import { publish } from '../lib/events.mjs'
import { notifyWorkspace } from '../lib/activity.mjs'
import { recordMilestone } from '../lib/funnel.mjs'
import { safeEqual, sha256Hex } from '../lib/crypto.mjs'
import { sendEmail, renderEmail } from '../messaging/email.mjs'
import { BRAND } from '../../shared/brand.mjs'
import {
  catalog, quoteSubscription, quotePack, prorate, addInterval, findPack, findPlan, normalizeAddons, vatOf, PricingError,
} from '../../shared/billing/pricing.mjs'
import { getProvider } from './providers/index.mjs'
import { encryptSecret, decryptSecret } from './secrets.mjs'
import { getAccess, loadSubscription, effectiveStatus } from './access.mjs'

const LOCK_ID = 727_002
const DAY = 86_400_000

// ── Helpers ────────────────────────────────────────────────

export async function recordBillingEvent(db, workspaceId, type, actor, details = {}) {
  await db.query('INSERT INTO billing_events (workspace_id, type, actor, details) VALUES ($1,$2,$3,$4)', [workspaceId, type, actor, JSON.stringify(details)])
}

const actorOf = (user) => (user ? `user:${user.id}` : 'system')

function pricing(fn) {
  try {
    return fn()
  } catch (err) {
    if (err instanceof PricingError) throw badRequest(err.code, err.message)
    throw err
  }
}

function finalizeCharge(subtotal, kind = 'proration', code = 'proration') {
  const vat = vatOf(subtotal)
  return { lines: [{ code, kind, qty: 1, unit: subtotal, total: subtotal }], subtotal, vat, total: subtotal + vat, currency: catalog.currency, catalogVersion: catalog.version, interval: null }
}

function webhookSig(sessionId) {
  return createHmac('sha256', `billing-webhook:${config.sessionSecret}`).update(sessionId).digest('base64url').slice(0, 32)
}

/** Query string our webhook URL carries for a session (also used to replay a sandbox callback). */
export function webhookQuery(sessionId) {
  return { sid: sessionId, sig: webhookSig(sessionId) }
}

export function verifyWebhookSig(sessionId, sig) {
  return typeof sessionId === 'string' && typeof sig === 'string' && safeEqual(webhookSig(sessionId), sig)
}

async function customerFor(workspaceId, sub) {
  const ws = await queryOne(
    `SELECT w.name, w.email, w.default_language,
            (SELECT email FROM profiles WHERE workspace_id = w.id AND role = 'owner' AND is_active ORDER BY created_at LIMIT 1) AS owner_email
       FROM workspaces w WHERE w.id = $1`,
    [workspaceId],
  )
  return {
    name: sub.billing_name || ws.name || '',
    email: sub.billing_email || ws.owner_email || ws.email || '',
    taxId: sub.billing_tax_id || '',
    language: ws.default_language === 'en' ? 'en' : 'he',
  }
}

function cardOf(sub) {
  if (!sub.payment_token_enc) return null
  return { expMonth: sub.card_exp_month, expYear: sub.card_exp_year, last4: sub.card_last4, brand: sub.card_brand }
}

// ── State for the billing page ─────────────────────────────

export function serializeInvoice(i) {
  return {
    id: i.id, number: i.number, kind: i.kind, status: i.status, periodStart: i.period_start, periodEnd: i.period_end,
    lines: i.lines, subtotal: i.subtotal, vat: i.vat, total: i.total, currency: i.currency,
    documentNumber: i.provider_document_number || null, documentUrl: i.provider_document_url || null,
    paidAt: i.paid_at, createdAt: i.created_at, attemptCount: i.attempt_count,
  }
}

export async function billingState(workspaceId) {
  const access = await getAccess(workspaceId, { measure: true })
  const s = access.row
  const invoices = await query('SELECT * FROM billing_invoices WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 50', [workspaceId])
  const provider = getProvider()
  return {
    subscription: {
      status: access.status,
      readOnly: access.readOnly,
      planCode: s.plan_code,
      interval: s.billing_interval,
      addons: s.addons || [],
      periodSubtotal: s.period_subtotal,
      currency: s.currency,
      catalogVersion: s.catalog_version,
      trialStartedAt: s.trial_started_at,
      trialEndsAt: s.trial_ends_at,
      currentPeriodStart: s.current_period_start,
      currentPeriodEnd: s.current_period_end,
      cancelAtPeriodEnd: s.cancel_at_period_end,
      pending: s.pending_plan_code || s.pending_interval || s.pending_addons
        ? { planCode: s.pending_plan_code || s.plan_code, interval: s.pending_interval || s.billing_interval, addons: s.pending_addons || s.addons || [] }
        : null,
      pastDueSince: s.past_due_since,
      graceEndsAt: s.grace_ends_at,
      nextRetryAt: s.next_retry_at,
      legacyUntil: s.legacy_until,
      interest: s.interest,
      paymentMethod: s.payment_token_enc ? { brand: s.card_brand, last4: s.card_last4, expMonth: s.card_exp_month, expYear: s.card_exp_year } : null,
      billingDetails: { name: s.billing_name || '', email: s.billing_email || '', taxId: s.billing_tax_id || '' },
    },
    entitlements: { products: access.products, limits: access.limits, credits: access.credits },
    usage: { ...access.usage, windowStart: access.window.start, windowEnd: access.window.end },
    invoices: invoices.map(serializeInvoice),
    provider: { name: provider.name, live: provider.live, available: provider.available, salesEmail: config.billing.salesEmail || null },
  }
}

// ── Checkout (hosted payment page) ─────────────────────────

const SUBSCRIBABLE = new Set(['trialing', 'expired', 'legacy', 'comped', 'canceled', 'suspended'])

/**
 * Create (or return the existing, for a retried click) hosted checkout session.
 * @param {{ workspaceId: string, user: object, kind: 'subscribe'|'change'|'pack'|'payment_method',
 *           selection: object, idempotencyKey: string, language?: 'he'|'en', quote?: object }} p
 */
export async function startCheckout(p) {
  const existing = await queryOne('SELECT * FROM checkout_sessions WHERE workspace_id = $1 AND idempotency_key = $2', [p.workspaceId, p.idempotencyKey])
  if (existing) {
    if (existing.status !== 'open' || !existing.redirect_url) throw conflict('checkout_closed', 'This checkout has already finished')
    return { sessionId: existing.id, redirectUrl: existing.redirect_url }
  }
  const provider = getProvider()
  if (!provider.available) throw new HttpError(503, 'billing_unavailable', 'Online payment is not available yet. Contact us to upgrade.')

  const sub = await loadSubscription(p.workspaceId)
  const status = effectiveStatus(sub)
  let quote = p.quote
  let operation = 'ChargeAndCreateToken'
  if (p.kind === 'subscribe') {
    if (!SUBSCRIBABLE.has(status)) throw conflict('already_subscribed', 'This workspace already has an active subscription')
    quote = pricing(() => quoteSubscription(p.selection))
  } else if (p.kind === 'pack') {
    quote = pricing(() => quotePack(p.selection.packCode))
  } else if (p.kind === 'payment_method') {
    quote = { lines: [], subtotal: 0, vat: 0, total: 0, currency: catalog.currency, catalogVersion: catalog.version, interval: null }
    operation = 'CreateTokenOnly'
  } else if (p.kind !== 'change' || !quote) {
    throw badRequest('invalid_checkout', 'Invalid checkout')
  }

  const session = await queryOne(
    `INSERT INTO checkout_sessions (workspace_id, created_by, kind, selection, quote, amount_total, currency, provider, idempotency_key, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now() + make_interval(mins => $10)) RETURNING *`,
    [p.workspaceId, p.user?.id || null, p.kind, JSON.stringify(p.selection), JSON.stringify(quote), quote.total, quote.currency,
      provider.name, p.idempotencyKey, config.billing.checkoutTtlMinutes],
  )
  const customer = await customerFor(p.workspaceId, sub)
  const ret = `${config.appBaseUrl}/app/billing/return?session=${session.id}`
  let created
  try {
    created = await provider.createCheckout({
      session,
      customer,
      lines: quote.lines,
      interval: quote.interval,
      language: p.language || customer.language,
      operation,
      urls: {
        success: ret,
        failed: `${ret}&result=failed`,
        cancel: `${ret}&result=canceled`,
        webhook: `${config.appBaseUrl}/api/public/billing/webhook/${provider.name}?sid=${session.id}&sig=${webhookSig(session.id)}`,
      },
    })
  } catch (err) {
    await query(`UPDATE checkout_sessions SET status = 'failed', failure_code = $2 WHERE id = $1`, [session.id, err.code || 'provider_error'])
    if (err instanceof HttpError) throw err
    logger.error('checkout_create_failed', { workspaceId: p.workspaceId, err })
    throw new HttpError(502, 'payment_provider_error', 'The payment page could not be opened. Please try again in a moment.')
  }
  await query('UPDATE checkout_sessions SET provider_ref = $2, redirect_url = $3 WHERE id = $1', [session.id, created.ref, created.redirectUrl])
  await recordBillingEvent({ query }, p.workspaceId, 'checkout_started', actorOf(p.user), { sessionId: session.id, kind: p.kind, amount: quote.total })
  return { sessionId: session.id, redirectUrl: created.redirectUrl }
}

export function serializeSession(s) {
  return { id: s.id, kind: s.kind, status: s.status, amount: s.amount_total, currency: s.currency, failureCode: s.failure_code, completedAt: s.completed_at, selection: s.selection }
}

/**
 * Ask the provider for the authoritative result of a session and apply it.
 * Used by callbacks, by the return page (polling) and by the reconciler.
 */
export async function syncCheckout(sessionId, source = 'sync') {
  const s = await queryOne('SELECT * FROM checkout_sessions WHERE id = $1', [sessionId])
  if (!s) throw notFound()
  if (s.status !== 'open' || !s.provider_ref) return { session: serializeSession(s), outcome: 'unchanged' }
  const provider = getProvider(s.provider)
  let result
  try {
    result = await provider.getCheckoutResult(s.provider_ref)
  } catch (err) {
    logger.warn('checkout_result_unavailable', { sessionId, err })
    return { session: serializeSession(s), outcome: 'provider_unavailable' }
  }
  const outcome = await applyCheckoutResult(sessionId, result, source)
  const fresh = await queryOne('SELECT * FROM checkout_sessions WHERE id = $1', [sessionId])
  return { session: serializeSession(fresh), outcome }
}

/**
 * Validate a provider result against the stored session and apply it once.
 * @returns {Promise<'pending'|'applied'|'already_applied'|'declined'|'mismatch'|'duplicate_payment'>}
 */
export async function applyCheckoutResult(sessionId, result, source = 'sync') {
  const post = { milestone: null, collect: false }
  const outcome = await withTransaction(async (tx) => {
    const s = await tx.queryOne('SELECT * FROM checkout_sessions WHERE id = $1 FOR UPDATE', [sessionId])
    if (!s) return 'mismatch'
    if (s.status === 'completed') return 'already_applied'
    if (s.status === 'failed') return 'declined'
    if (!result || result.status === 'pending') return 'pending'

    const fail = async (code, eventType) => {
      await tx.query(`UPDATE checkout_sessions SET status = 'failed', failure_code = $2 WHERE id = $1`, [s.id, code])
      await recordBillingEvent(tx, s.workspace_id, eventType, `provider:${s.provider}`, { sessionId: s.id, code, source, summary: result.summary })
    }

    // Identity checks: the result must be for THIS session.
    if (result.ref !== s.provider_ref || (result.returnValue && result.returnValue !== s.id) || result.terminalMismatch) {
      logger.error('billing_result_mismatch', { sessionId: s.id, reason: 'reference' })
      await fail('reference_mismatch', 'payment_mismatch')
      return 'mismatch'
    }
    if (result.status === 'declined') {
      await fail(result.failureCode || 'declined', 'payment_declined')
      return 'declined'
    }
    // Price validation: what was charged must equal what we quoted.
    if (s.kind !== 'payment_method' && (result.amount !== s.amount_total || result.currency !== s.currency)) {
      logger.error('billing_amount_mismatch', { sessionId: s.id, expected: s.amount_total, got: result.amount, currency: result.currency })
      await fail('amount_mismatch', 'payment_mismatch')
      return 'mismatch'
    }
    if (s.kind === 'payment_method' && !result.token) {
      await fail('no_token', 'payment_declined')
      return 'declined'
    }

    const sub = await tx.queryOne('SELECT * FROM workspace_subscriptions WHERE workspace_id = $1 FOR UPDATE', [s.workspace_id])
    const now = new Date()
    const status = effectiveStatus(sub, now)

    // Record the money first (unique per provider transaction).
    let invoiceId = null
    if (s.kind !== 'payment_method') {
      const meta = s.kind === 'pack' ? { packCode: s.selection.packCode } : { planCode: s.selection.planCode, interval: s.selection.interval, addons: normalizeAddons(s.selection.addons) }
      const inv = await tx.queryOne(
        `INSERT INTO billing_invoices (workspace_id, kind, status, lines, meta, subtotal, vat, total, currency, checkout_session_id, provider,
                                       provider_transaction_id, provider_document_number, provider_document_url, attempt_count, paid_at, period_start, period_end)
         VALUES ($1,$2,'paid',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1,now(),$14,$15)
         ON CONFLICT (provider, provider_transaction_id) WHERE provider_transaction_id IS NOT NULL DO NOTHING RETURNING id`,
        [s.workspace_id, { subscribe: 'subscription', change: 'proration', pack: 'pack' }[s.kind], JSON.stringify(s.quote.lines), JSON.stringify(meta),
          s.quote.subtotal, s.quote.vat, s.quote.total, s.currency, s.id, s.provider, result.transactionId, result.documentNumber, result.documentUrl,
          null, null],
      )
      if (!inv) {
        await tx.query(`UPDATE checkout_sessions SET status = 'completed', completed_at = now(), provider_transaction_id = $2 WHERE id = $1`, [s.id, result.transactionId])
        return 'already_applied'
      }
      invoiceId = inv.id
    }

    // A second subscribe paid while the workspace is already active (two tabs): keep the money on record, flag for refund.
    if (s.kind === 'subscribe' && !SUBSCRIBABLE.has(status)) {
      await tx.query(`UPDATE checkout_sessions SET status = 'completed', completed_at = now(), provider_transaction_id = $2, failure_code = 'duplicate_payment' WHERE id = $1`, [s.id, result.transactionId])
      await recordBillingEvent(tx, s.workspace_id, 'duplicate_payment_needs_refund', `provider:${s.provider}`, { sessionId: s.id, invoiceId, amount: s.amount_total })
      logger.error('billing_duplicate_payment', { sessionId: s.id, workspaceId: s.workspace_id })
      return 'duplicate_payment'
    }

    if (result.token) {
      await tx.query(
        `UPDATE workspace_subscriptions SET provider = $2, payment_token_enc = $3, card_brand = $4, card_last4 = $5, card_exp_month = $6, card_exp_year = $7
          WHERE workspace_id = $1`,
        [s.workspace_id, s.provider, encryptSecret(result.token), result.card?.brand || null, result.card?.last4 || null, result.card?.expMonth || null, result.card?.expYear || null],
      )
    }

    if (s.kind === 'subscribe') {
      const sel = s.selection
      const anchor = status === 'trialing' && sub.trial_ends_at && new Date(sub.trial_ends_at) > now ? new Date(sub.trial_ends_at) : now
      const periodEnd = addInterval(anchor, sel.interval)
      await tx.query(
        `UPDATE workspace_subscriptions SET status = 'active', plan_code = $2, billing_interval = $3, addons = $4, period_subtotal = $5, period_lines = $6,
            currency = $7, catalog_version = $8, current_period_start = $9, current_period_end = $10, cancel_at_period_end = false, canceled_at = NULL,
            pending_plan_code = NULL, pending_interval = NULL, pending_addons = NULL, past_due_since = NULL, grace_ends_at = NULL,
            next_retry_at = NULL, retry_count = 0, legacy_until = NULL, version = version + 1
          WHERE workspace_id = $1`,
        [s.workspace_id, sel.planCode, sel.interval, JSON.stringify(normalizeAddons(sel.addons)), s.quote.subtotal, JSON.stringify(s.quote.lines),
          s.currency, s.quote.catalogVersion, now, periodEnd],
      )
      await tx.query('UPDATE billing_invoices SET period_start = $2, period_end = $3 WHERE id = $1', [invoiceId, now, periodEnd])
      // Outstanding renewal invoices from a lapsed subscription are superseded by the new one.
      await tx.query(`UPDATE billing_invoices SET status = 'void' WHERE workspace_id = $1 AND kind = 'renewal' AND status IN ('pending','failed')`, [s.workspace_id])
      await tx.query(`UPDATE checkout_sessions SET status = 'canceled' WHERE workspace_id = $1 AND kind = 'subscribe' AND status = 'open' AND id <> $2`, [s.workspace_id, s.id])
      if (status === 'trialing' || status === 'expired') post.milestone = { event: 'trial_to_paid', props: { plan: sel.planCode, interval: sel.interval, from: status } }
      await recordBillingEvent(tx, s.workspace_id, 'subscription_started', `provider:${s.provider}`, { plan: sel.planCode, interval: sel.interval, from: status, periodEnd })
    } else if (s.kind === 'change') {
      const next = s.selection
      await tx.query(
        `UPDATE workspace_subscriptions SET plan_code = $2, addons = $3, period_subtotal = $4, period_lines = $5, catalog_version = $6,
            pending_plan_code = NULL, pending_interval = NULL, pending_addons = NULL, version = version + 1 WHERE workspace_id = $1`,
        [s.workspace_id, next.planCode, JSON.stringify(normalizeAddons(next.addons)), next.fullQuote.subtotal, JSON.stringify(next.fullQuote.lines), next.fullQuote.catalogVersion],
      )
      await tx.query('UPDATE billing_invoices SET period_start = $2, period_end = $3 WHERE id = $1', [invoiceId, now, sub.current_period_end])
      await recordBillingEvent(tx, s.workspace_id, 'plan_changed', `provider:${s.provider}`, { from: sub.plan_code, to: next.planCode, prorated: s.quote.total })
    } else if (s.kind === 'pack') {
      await grantPack(tx, s.workspace_id, s.selection.packCode, invoiceId, now)
    } else if (s.kind === 'payment_method') {
      await recordBillingEvent(tx, s.workspace_id, 'payment_method_updated', `provider:${s.provider}`, { last4: result.card?.last4 || null })
      post.collect = status === 'past_due' || status === 'suspended'
    }
    await tx.query(`UPDATE checkout_sessions SET status = 'completed', completed_at = now(), provider_transaction_id = $2 WHERE id = $1`, [s.id, result.transactionId])
    return 'applied'
  })

  const s = await queryOne('SELECT workspace_id FROM checkout_sessions WHERE id = $1', [sessionId])
  if (s && outcome !== 'pending') publish(s.workspace_id, 'billing')
  if (s && post.milestone) await recordMilestone(s.workspace_id, post.milestone.event, post.milestone.props)
  if (s && post.collect) await collectOutstanding(s.workspace_id).catch((err) => logger.error('collect_after_card_update_failed', { err }))
  return outcome
}

async function grantPack(tx, workspaceId, packCode, invoiceId, now) {
  const pack = findPack(packCode)
  const access = await getAccess(workspaceId, { db: tx, now })
  for (const [metric, qty] of Object.entries(pack.grants)) {
    await tx.query(
      `INSERT INTO usage_credits (workspace_id, metric, quantity, valid_from, valid_until, invoice_id) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (invoice_id, metric) WHERE invoice_id IS NOT NULL DO NOTHING`,
      [workspaceId, metric, qty, access.window.start, access.window.end, invoiceId],
    )
  }
  await recordBillingEvent(tx, workspaceId, 'pack_purchased', 'system', { packCode, invoiceId, validUntil: access.window.end })
}

/**
 * Provider callback. Identifies the session (signed sid in our webhook URL +
 * the provider reference in the body), de-duplicates, then fetches the
 * authoritative result. Never trusts the body for the outcome.
 */
export async function handleCallback(providerName, req) {
  const provider = getProvider(providerName)
  const sid = String(req.query.sid || '')
  if (!verifyWebhookSig(sid, String(req.query.sig || ''))) return { status: 'ignored', reason: 'bad_signature' }
  const parsed = provider.parseCallback(req)
  const s = await queryOne('SELECT id, workspace_id, provider, provider_ref, status FROM checkout_sessions WHERE id = $1', [sid])
  if (!s || s.provider !== providerName || !parsed || parsed.ref !== s.provider_ref) return { status: 'ignored', reason: 'unknown_session' }

  const raw = JSON.stringify(req.body || {})
  const eventKey = `checkout:${s.provider_ref}`
  const inserted = await queryOne(
    `INSERT INTO payment_events (provider, event_key, workspace_id, checkout_session_id, kind, payload_sha256)
     VALUES ($1,$2,$3,$4,'checkout_callback',$5) ON CONFLICT (provider, event_key) DO NOTHING RETURNING id`,
    [providerName, eventKey, s.workspace_id, s.id, sha256Hex(raw)],
  )
  if (!inserted) {
    const prior = await queryOne('SELECT processed_at FROM payment_events WHERE provider = $1 AND event_key = $2', [providerName, eventKey])
    if (prior?.processed_at) return { status: 'duplicate' }
  }
  const { outcome } = await syncCheckout(s.id, 'callback')
  if (outcome !== 'pending' && outcome !== 'provider_unavailable') {
    await query('UPDATE payment_events SET processed_at = now(), outcome = $3 WHERE provider = $1 AND event_key = $2', [providerName, eventKey, outcome])
  }
  return { status: 'processed', outcome }
}

// ── Token charges (upgrades, packs, renewals) ──────────────

/**
 * Charge an invoice against the stored payment token. Safe to call
 * repeatedly: a previous attempt with an unknown outcome is looked up first.
 * @returns {Promise<'paid'|'declined'|'unknown'|'no_payment_method'>}
 */
export async function collectInvoice(invoiceId) {
  const inv = await queryOne('SELECT * FROM billing_invoices WHERE id = $1', [invoiceId])
  if (!inv || inv.status === 'paid') return 'paid'
  if (inv.status === 'void') return 'declined'
  const sub = await queryOne('SELECT * FROM workspace_subscriptions WHERE workspace_id = $1', [inv.workspace_id])
  const provider = getProvider(sub.provider || config.billing.provider)
  const keyFor = (n) => `dk-${inv.number}-${n}`

  if (inv.attempt_count > 0 && inv.last_error === 'unknown_outcome') {
    const found = await provider.findCharge(keyFor(inv.attempt_count))
    if (found.status === 'approved') return markInvoicePaid(inv.id, found)
    if (found.status === 'error') return 'unknown'
  }
  if (!sub.payment_token_enc) {
    await query(`UPDATE billing_invoices SET last_error = 'no_payment_method' WHERE id = $1`, [inv.id])
    return 'no_payment_method'
  }
  const attempt = inv.attempt_count + 1
  // Mark the attempt BEFORE calling out: a crash mid-call leaves 'unknown_outcome' to be looked up next time.
  await query(`UPDATE billing_invoices SET attempt_count = $2, last_error = 'unknown_outcome' WHERE id = $1`, [inv.id, attempt])
  const customer = await customerFor(inv.workspace_id, sub)
  const result = await provider.chargeToken({
    token: decryptSecret(sub.payment_token_enc),
    card: cardOf(sub),
    amount: inv.total,
    currency: inv.currency,
    idempotencyKey: keyFor(attempt),
    customer,
    lines: inv.lines,
    language: customer.language,
    interval: inv.meta?.interval || null,
  })
  if (result.status === 'approved') {
    if (result.amount !== null && result.amount !== undefined && result.amount !== inv.total) {
      logger.error('billing_charge_amount_mismatch', { invoiceId: inv.id, expected: inv.total, got: result.amount })
    }
    return markInvoicePaid(inv.id, result)
  }
  if (result.status === 'error') return 'unknown'
  await query(`UPDATE billing_invoices SET last_error = $2 WHERE id = $1`, [inv.id, result.failureCode || 'declined'])
  await recordBillingEvent({ query }, inv.workspace_id, 'charge_declined', `provider:${provider.name}`, { invoiceId: inv.id, attempt, code: result.failureCode })
  return 'declined'
}

async function markInvoicePaid(invoiceId, result) {
  let workspaceId
  await withTransaction(async (tx) => {
    const inv = await tx.queryOne('SELECT * FROM billing_invoices WHERE id = $1 FOR UPDATE', [invoiceId])
    if (inv.status === 'paid') return
    workspaceId = inv.workspace_id
    await tx.query(
      `UPDATE billing_invoices SET status = 'paid', paid_at = now(), last_error = NULL, provider = COALESCE(provider, $2),
          provider_transaction_id = $3, provider_document_number = $4, provider_document_url = $5 WHERE id = $1`,
      [inv.id, config.billing.provider, result.transactionId, result.documentNumber || null, result.documentUrl || null],
    )
    const sub = await tx.queryOne('SELECT * FROM workspace_subscriptions WHERE workspace_id = $1 FOR UPDATE', [inv.workspace_id])
    if (inv.kind === 'renewal') {
      const m = inv.meta || {}
      await tx.query(
        `UPDATE workspace_subscriptions SET status = 'active', plan_code = $2, billing_interval = $3, addons = $4, period_subtotal = $5, period_lines = $6,
            current_period_start = $7, current_period_end = $8, pending_plan_code = NULL, pending_interval = NULL, pending_addons = NULL,
            past_due_since = NULL, grace_ends_at = NULL, next_retry_at = NULL, retry_count = 0, version = version + 1
          WHERE workspace_id = $1`,
        [inv.workspace_id, m.planCode || sub.plan_code, m.interval || sub.billing_interval, JSON.stringify(m.addons || sub.addons || []), inv.subtotal,
          JSON.stringify(inv.lines), inv.period_start, inv.period_end],
      )
      await recordBillingEvent(tx, inv.workspace_id, 'subscription_renewed', 'system', { invoiceId: inv.id, periodEnd: inv.period_end })
    } else if (inv.kind === 'proration') {
      const m = inv.meta || {}
      await tx.query(
        `UPDATE workspace_subscriptions SET plan_code = $2, addons = $3, period_subtotal = $4, period_lines = $5, catalog_version = $6,
            pending_plan_code = NULL, pending_interval = NULL, pending_addons = NULL, version = version + 1 WHERE workspace_id = $1`,
        [inv.workspace_id, m.planCode, JSON.stringify(m.addons || []), m.fullQuote.subtotal, JSON.stringify(m.fullQuote.lines), m.fullQuote.catalogVersion],
      )
      await recordBillingEvent(tx, inv.workspace_id, 'plan_changed', 'system', { from: sub.plan_code, to: m.planCode, invoiceId: inv.id })
    } else if (inv.kind === 'pack') {
      await grantPack(tx, inv.workspace_id, inv.meta.packCode, inv.id, new Date())
    }
  })
  if (workspaceId) publish(workspaceId, 'billing')
  return 'paid'
}

async function createChargeInvoice(workspaceId, kind, quote, meta, period = {}) {
  try {
    return await queryOne(
    `INSERT INTO billing_invoices (workspace_id, kind, status, lines, meta, subtotal, vat, total, currency, period_start, period_end)
     VALUES ($1,$2,'pending',$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [workspaceId, kind, JSON.stringify(quote.lines), JSON.stringify(meta), quote.subtotal, quote.vat, quote.total, quote.currency, period.start || null, period.end || null],
    )
  } catch (err) {
    if (err.code === '23505') throw conflict('payment_in_progress', 'Another payment for this workspace is being processed. Try again in a minute.')
    throw err
  }
}

/** Charge an on-demand invoice right away; void it if the card declines. */
async function chargeNow(workspaceId, kind, quote, meta, period) {
  const inv = await createChargeInvoice(workspaceId, kind, quote, meta, period)
  const r = await collectInvoice(inv.id)
  if (r === 'paid') return { status: 'paid', invoiceId: inv.id }
  if (r === 'unknown') return { status: 'processing', invoiceId: inv.id }
  await query(`UPDATE billing_invoices SET status = 'failed' WHERE id = $1`, [inv.id])
  throw new HttpError(402, 'payment_declined', 'Your card was declined. Update your payment method and try again.', { invoiceId: inv.id })
}

// ── Plan changes, packs, cancellation ──────────────────────

/**
 * Change plan / interval / add-ons.
 *  - not subscribed yet (trial, expired, legacy, …) → hosted checkout
 *  - more expensive, same interval → prorated charge now (token, or hosted checkout)
 *  - cheaper, or a different interval → scheduled for the end of the period
 */
export async function changePlan({ workspaceId, user, selection, idempotencyKey, language }) {
  const sel = { planCode: selection.planCode, interval: selection.interval, addons: Object.fromEntries(pricing(() => normalizeAddons(selection.addons)).map((a) => [a.code, a.qty])) }
  const next = pricing(() => quoteSubscription(sel))
  const sub = await loadSubscription(workspaceId)
  const status = effectiveStatus(sub)
  if (SUBSCRIBABLE.has(status)) {
    return { action: 'checkout', ...(await startCheckout({ workspaceId, user, kind: 'subscribe', selection: sel, idempotencyKey, language })) }
  }
  if (status === 'past_due') throw conflict('payment_overdue', 'Update your payment method before changing plans')

  const sameSelection = sub.plan_code === sel.planCode && sub.billing_interval === sel.interval &&
    JSON.stringify(normalizeAddons(sub.addons)) === JSON.stringify(normalizeAddons(sel.addons))
  if (sameSelection) {
    if (sub.pending_plan_code || sub.pending_interval || sub.pending_addons) await clearPendingChange(workspaceId, user)
    return { action: 'none' }
  }

  if (sel.interval !== sub.billing_interval || next.subtotal < sub.period_subtotal) {
    await withTransaction(async (tx) => {
      await tx.query(
        `UPDATE workspace_subscriptions SET pending_plan_code = $2, pending_interval = $3, pending_addons = $4, version = version + 1 WHERE workspace_id = $1`,
        [workspaceId, sel.planCode, sel.interval, JSON.stringify(normalizeAddons(sel.addons))],
      )
      await recordBillingEvent(tx, workspaceId, 'change_scheduled', actorOf(user), { to: sel, effectiveAt: sub.current_period_end })
    })
    publish(workspaceId, 'billing')
    return { action: 'scheduled', effectiveAt: sub.current_period_end }
  }

  const amount = prorate({ fromSubtotal: sub.period_subtotal, toSubtotal: next.subtotal, periodStart: sub.current_period_start, periodEnd: sub.current_period_end })
  const meta = { planCode: sel.planCode, interval: sel.interval, addons: normalizeAddons(sel.addons), fullQuote: next }
  if (amount <= 0) {
    await withTransaction(async (tx) => {
      await tx.query(
        `UPDATE workspace_subscriptions SET plan_code = $2, addons = $3, period_subtotal = $4, period_lines = $5, catalog_version = $6,
            pending_plan_code = NULL, pending_interval = NULL, pending_addons = NULL, version = version + 1 WHERE workspace_id = $1`,
        [workspaceId, sel.planCode, JSON.stringify(meta.addons), next.subtotal, JSON.stringify(next.lines), next.catalogVersion],
      )
      await recordBillingEvent(tx, workspaceId, 'plan_changed', actorOf(user), { from: sub.plan_code, to: sel.planCode, prorated: 0 })
    })
    publish(workspaceId, 'billing')
    return { action: 'applied' }
  }
  const charge = finalizeCharge(amount)
  if (sub.payment_token_enc) {
    const r = await chargeNow(workspaceId, 'proration', charge, meta, { start: new Date(), end: sub.current_period_end })
    return { action: r.status === 'paid' ? 'applied' : 'processing', invoiceId: r.invoiceId }
  }
  return { action: 'checkout', ...(await startCheckout({ workspaceId, user, kind: 'change', selection: { ...sel, fullQuote: next }, quote: charge, idempotencyKey, language })) }
}

export async function clearPendingChange(workspaceId, user) {
  await withTransaction(async (tx) => {
    await tx.query('UPDATE workspace_subscriptions SET pending_plan_code = NULL, pending_interval = NULL, pending_addons = NULL, version = version + 1 WHERE workspace_id = $1', [workspaceId])
    await recordBillingEvent(tx, workspaceId, 'change_unscheduled', actorOf(user))
  })
  publish(workspaceId, 'billing')
}

export async function buyPack({ workspaceId, user, packCode, idempotencyKey, language }) {
  const pack = findPack(packCode)
  if (!pack) throw badRequest('unknown_pack', 'Unknown pack')
  const access = await getAccess(workspaceId)
  if (access.status !== 'active') {
    throw conflict('subscription_required', access.status === 'trialing'
      ? 'Packs are for paid plans. Choose a plan to get more requests and signatures.'
      : 'An active subscription is required to buy a pack')
  }
  if (!access.products.includes(pack.requiresProduct)) throw conflict('plan_required', 'This pack is for a product that isn’t in your plan')
  const quote = quotePack(packCode)
  if (access.row.payment_token_enc) {
    const r = await chargeNow(workspaceId, 'pack', quote, { packCode }, {})
    return { action: r.status === 'paid' ? 'applied' : 'processing', invoiceId: r.invoiceId }
  }
  return { action: 'checkout', ...(await startCheckout({ workspaceId, user, kind: 'pack', selection: { packCode }, idempotencyKey, language })) }
}

export async function cancelAtPeriodEnd(workspaceId, user, reason) {
  const sub = await loadSubscription(workspaceId)
  if (effectiveStatus(sub) !== 'active') throw conflict('nothing_to_cancel', 'There is no active paid subscription to cancel')
  await withTransaction(async (tx) => {
    await tx.query('UPDATE workspace_subscriptions SET cancel_at_period_end = true, canceled_at = now(), version = version + 1 WHERE workspace_id = $1', [workspaceId])
    await recordBillingEvent(tx, workspaceId, 'cancel_scheduled', actorOf(user), { effectiveAt: sub.current_period_end, reason: reason ? String(reason).slice(0, 40) : null })
  })
  publish(workspaceId, 'billing')
  return { effectiveAt: sub.current_period_end }
}

export async function resumeSubscription(workspaceId, user) {
  const sub = await loadSubscription(workspaceId)
  if (sub.status !== 'active' || !sub.cancel_at_period_end || effectiveStatus(sub) !== 'active') throw conflict('nothing_to_resume', 'There is nothing to resume')
  await withTransaction(async (tx) => {
    await tx.query('UPDATE workspace_subscriptions SET cancel_at_period_end = false, canceled_at = NULL, version = version + 1 WHERE workspace_id = $1', [workspaceId])
    await recordBillingEvent(tx, workspaceId, 'cancel_reverted', actorOf(user))
  })
  publish(workspaceId, 'billing')
}

export async function updateBillingDetails(workspaceId, user, d) {
  await query('UPDATE workspace_subscriptions SET billing_name = $2, billing_email = $3, billing_tax_id = $4 WHERE workspace_id = $1', [workspaceId, d.name || null, d.email || null, d.taxId || null])
  await recordBillingEvent({ query }, workspaceId, 'billing_details_updated', actorOf(user))
}

/** After a card update: charge what's outstanding and restore access. */
export async function collectOutstanding(workspaceId) {
  const sub = await loadSubscription(workspaceId)
  const status = effectiveStatus(sub)
  if (status !== 'past_due' && status !== 'suspended') return null
  const inv = await queryOne(`SELECT * FROM billing_invoices WHERE workspace_id = $1 AND kind = 'renewal' AND status = 'pending' ORDER BY created_at DESC LIMIT 1`, [workspaceId])
  if (!inv) return null
  if (status === 'suspended') {
    // Access lapsed: the paid period starts now rather than in the past.
    const start = new Date()
    await query('UPDATE billing_invoices SET period_start = $2, period_end = $3 WHERE id = $1', [inv.id, start, addInterval(start, inv.meta?.interval || sub.billing_interval)])
  }
  const r = await collectInvoice(inv.id)
  if (r !== 'paid') await scheduleRetry(workspaceId, new Date())
  return r
}

// ── Scheduled jobs ─────────────────────────────────────────

async function notifyOwners(workspaceId, { type = 'warning', en, he, actionUrl = '/app/billing' }) {
  const ws = await queryOne('SELECT name, default_language, brand_color FROM workspaces WHERE id = $1', [workspaceId])
  const lang = ws?.default_language === 'en' ? 'en' : 'he'
  const copy = lang === 'en' ? en : he
  // Both languages travel with the notification so each viewer sees their own.
  await notifyWorkspace({ workspaceId, type, title: copy.title, message: copy.body, actionUrl, template: 'localized', params: { en, he } })
  const owners = await query(`SELECT email FROM profiles WHERE workspace_id = $1 AND role = 'owner' AND is_active`, [workspaceId])
  const { html, text } = renderEmail({
    language: lang, brandName: BRAND.name, logoUrl: `${config.appBaseUrl}${BRAND.assets.icon}`, heading: copy.title, paragraphs: [copy.body],
    ctaLabel: lang === 'en' ? 'Open billing' : 'למסך החיוב', ctaUrl: `${config.appBaseUrl}${actionUrl}`,
    footer: lang === 'en' ? 'You receive this because you own this Sadir workspace.' : 'קיבלת הודעה זו כבעלים של סביבת העבודה ב-Sadir.',
  })
  for (const o of owners) await sendEmail({ to: o.email, subject: copy.title, html, text })
}

async function expireTrials(now, stats) {
  const rows = await query(
    `UPDATE workspace_subscriptions SET status = 'expired', version = version + 1
      WHERE status = 'trialing' AND trial_ends_at <= $1 RETURNING workspace_id`, [now],
  )
  for (const r of rows) {
    await recordBillingEvent({ query }, r.workspace_id, 'trial_expired', 'system')
    await notifyOwners(r.workspace_id, {
      en: { title: 'Your Sadir trial has ended', body: 'Your workspace is now read-only. Your data and client links are safe — choose a plan to continue sending requests.' },
      he: { title: 'תקופת הניסיון ב-Sadir הסתיימה', body: 'סביבת העבודה עברה למצב צפייה בלבד. הנתונים והקישורים שנשלחו ללקוחות שמורים — בחרו מסלול כדי להמשיך לשלוח בקשות.' },
    })
    publish(r.workspace_id, 'billing')
    stats.trialsExpired++
  }
}

const REMINDER_DAYS = [7, 3, 1]
async function trialReminders(now, stats) {
  const rows = await query(
    `SELECT workspace_id, trial_ends_at, trial_reminders_sent FROM workspace_subscriptions
      WHERE status = 'trialing' AND trial_ends_at > $1 AND trial_ends_at <= $1::timestamptz + interval '7 days'`, [now],
  )
  for (const r of rows) {
    const daysLeft = Math.ceil((new Date(r.trial_ends_at) - now) / DAY)
    const due = REMINDER_DAYS.filter((d) => daysLeft <= d && !(r.trial_reminders_sent || []).includes(d))
    if (!due.length) continue
    const mark = Math.min(...due)
    // Claim the reminder first so two runs can't both send it.
    const claimed = await queryOne(
      `UPDATE workspace_subscriptions SET trial_reminders_sent = trial_reminders_sent || $2::jsonb
        WHERE workspace_id = $1 AND NOT (trial_reminders_sent @> $3::jsonb) RETURNING 1`,
      [r.workspace_id, JSON.stringify(due), JSON.stringify([mark])],
    )
    if (!claimed) continue
    await notifyOwners(r.workspace_id, {
      type: 'info',
      en: { title: daysLeft <= 1 ? 'Your Sadir trial ends tomorrow' : `Your Sadir trial ends in ${daysLeft} days`, body: 'Choose a plan to keep sending requests and signatures without interruption. No charge happens until you choose.' },
      he: { title: daysLeft <= 1 ? 'תקופת הניסיון ב-Sadir מסתיימת מחר' : `תקופת הניסיון ב-Sadir מסתיימת בעוד ${daysLeft} ימים`, body: 'בחרו מסלול כדי להמשיך לשלוח בקשות וחתימות ללא הפסקה. שום חיוב לא יתבצע עד שתבחרו.' },
    })
    stats.trialReminders++
  }
}

async function finishCanceled(now, stats) {
  const rows = await query(
    `UPDATE workspace_subscriptions SET status = 'canceled', version = version + 1
      WHERE status = 'active' AND cancel_at_period_end AND current_period_end <= $1 RETURNING workspace_id`, [now],
  )
  for (const r of rows) {
    await recordBillingEvent({ query }, r.workspace_id, 'subscription_ended', 'system')
    publish(r.workspace_id, 'billing')
    stats.canceled++
  }
}

/** Create the renewal invoice for a due subscription (idempotent per period). */
async function renewalInvoice(sub) {
  const interval = sub.pending_interval || sub.billing_interval
  let quote
  let meta
  if (sub.pending_plan_code || sub.pending_interval || sub.pending_addons) {
    const sel = { planCode: sub.pending_plan_code || sub.plan_code, interval, addons: Object.fromEntries((sub.pending_addons || sub.addons || []).map((a) => [a.code, a.qty])) }
    quote = quoteSubscription(sel)
    meta = { planCode: sel.planCode, interval, addons: normalizeAddons(sel.addons) }
  } else {
    // Existing customers renew at the price they bought (snapshot), not today's catalog price.
    const subtotal = sub.period_subtotal
    const vat = vatOf(subtotal)
    quote = { lines: sub.period_lines || [{ code: sub.plan_code, kind: 'plan', qty: 1, unit: subtotal, total: subtotal }], subtotal, vat, total: subtotal + vat, currency: sub.currency }
    meta = { planCode: sub.plan_code, interval, addons: sub.addons || [] }
  }
  const start = new Date(sub.current_period_end)
  const end = addInterval(start, interval)
  await query(
    `INSERT INTO billing_invoices (workspace_id, kind, status, lines, meta, subtotal, vat, total, currency, period_start, period_end)
     VALUES ($1,'renewal','pending',$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (workspace_id, period_start) WHERE kind = 'renewal' DO NOTHING`,
    [sub.workspace_id, JSON.stringify(quote.lines), JSON.stringify(meta), quote.subtotal, quote.vat, quote.total, quote.currency, start, end],
  )
  return queryOne(`SELECT * FROM billing_invoices WHERE workspace_id = $1 AND kind = 'renewal' AND period_start = $2`, [sub.workspace_id, start])
}

async function scheduleRetry(workspaceId, now) {
  const sub = await loadSubscription(workspaceId)
  const firstFailure = sub.status !== 'past_due'
  const since = firstFailure ? now : new Date(sub.past_due_since)
  const retryCount = firstFailure ? 0 : sub.retry_count + 1
  const retryDay = catalog.grace.retryDays[retryCount]
  await query(
    `UPDATE workspace_subscriptions SET status = CASE WHEN status = 'suspended' THEN 'suspended' ELSE 'past_due' END,
        past_due_since = $2, grace_ends_at = COALESCE(grace_ends_at, $3), retry_count = $4, next_retry_at = $5, version = version + 1
      WHERE workspace_id = $1`,
    [workspaceId, since, new Date(since.getTime() + catalog.grace.pastDueDays * DAY), retryCount,
      retryDay === undefined ? null : new Date(since.getTime() + retryDay * DAY)],
  )
  if (firstFailure) {
    await recordBillingEvent({ query }, workspaceId, 'payment_failed', 'system', { graceDays: catalog.grace.pastDueDays })
    await notifyOwners(workspaceId, {
      en: { title: 'We couldn’t renew your Sadir subscription', body: `Your card was declined. Everything keeps working for ${catalog.grace.pastDueDays} days while we retry — update your payment method to avoid interruption.` },
      he: { title: 'לא הצלחנו לחדש את המנוי ב-Sadir', body: `החיוב בכרטיס נדחה. הכול ממשיך לעבוד ${catalog.grace.pastDueDays} ימים בזמן שננסה שוב — עדכנו את אמצעי התשלום כדי למנוע הפסקה.` },
    })
  }
  publish(workspaceId, 'billing')
}

async function renewDue(now, stats) {
  const due = await query(
    `SELECT workspace_id FROM workspace_subscriptions
      WHERE status = 'active' AND NOT cancel_at_period_end AND current_period_end <= $1 ORDER BY current_period_end LIMIT 100`, [now],
  )
  for (const { workspace_id: ws } of due) {
    try {
      const sub = await loadSubscription(ws)
      if (sub.status !== 'active' || sub.cancel_at_period_end || new Date(sub.current_period_end) > now) continue
      const inv = await renewalInvoice(sub)
      const r = await collectInvoice(inv.id)
      if (r === 'paid') stats.renewed++
      else if (r === 'declined' || r === 'no_payment_method') { await scheduleRetry(ws, now); stats.failed++ }
      else stats.unknown++
    } catch (err) {
      logger.error('billing_renewal_failed', { workspaceId: ws, err })
    }
  }
}

async function retryPastDue(now, stats) {
  const due = await query(
    `SELECT workspace_id FROM workspace_subscriptions WHERE status = 'past_due' AND next_retry_at IS NOT NULL AND next_retry_at <= $1 LIMIT 100`, [now],
  )
  for (const { workspace_id: ws } of due) {
    const inv = await queryOne(`SELECT id FROM billing_invoices WHERE workspace_id = $1 AND kind = 'renewal' AND status = 'pending' ORDER BY created_at DESC LIMIT 1`, [ws])
    if (!inv) continue
    const r = await collectInvoice(inv.id)
    if (r === 'paid') stats.recovered++
    else if (r !== 'unknown') await scheduleRetry(ws, now)
  }
}

async function suspendAfterGrace(now, stats) {
  const rows = await query(
    `UPDATE workspace_subscriptions SET status = 'suspended', next_retry_at = NULL, version = version + 1
      WHERE status = 'past_due' AND grace_ends_at <= $1 RETURNING workspace_id`, [now],
  )
  for (const r of rows) {
    await recordBillingEvent({ query }, r.workspace_id, 'subscription_suspended', 'system')
    await notifyOwners(r.workspace_id, {
      en: { title: 'Your Sadir workspace is paused', body: 'We couldn’t collect payment, so the workspace is read-only. Update your payment method to restore it immediately — nothing was deleted.' },
      he: { title: 'סביבת העבודה ב-Sadir הושהתה', body: 'לא הצלחנו לגבות תשלום ולכן סביבת העבודה במצב צפייה בלבד. עדכנו אמצעי תשלום כדי לשחזר אותה מיד — שום דבר לא נמחק.' },
    })
    publish(r.workspace_id, 'billing')
    stats.suspended++
  }
}

/** Charges whose outcome is unknown (timeouts) are resolved by lookup. */
async function resolveUnknownCharges(_now, stats) {
  const rows = await query(`SELECT id FROM billing_invoices WHERE status = 'pending' AND last_error = 'unknown_outcome' AND updated_at < now() - interval '2 minutes' LIMIT 50`)
  for (const r of rows) {
    const inv = await queryOne('SELECT * FROM billing_invoices WHERE id = $1', [r.id])
    const sub = await loadSubscription(inv.workspace_id)
    const found = await getProvider(sub.provider || config.billing.provider).findCharge(`dk-${inv.number}-${inv.attempt_count}`)
    if (found.status === 'approved') { await markInvoicePaid(inv.id, found); stats.resolved++ }
    else if (found.status === 'not_found') {
      await query(`UPDATE billing_invoices SET last_error = 'not_charged' WHERE id = $1`, [inv.id])
      if (inv.kind !== 'renewal') await query(`UPDATE billing_invoices SET status = 'failed' WHERE id = $1`, [inv.id])
      stats.resolved++
    }
  }
}

/** Callbacks can be lost: ask the provider about sessions that are still open. */
async function reconcileCheckouts(now, stats) {
  await query(`UPDATE checkout_sessions SET status = 'expired' WHERE status = 'open' AND expires_at < $1::timestamptz - interval '1 day'`, [now])
  const open = await query(
    `SELECT id FROM checkout_sessions WHERE status = 'open' AND provider_ref IS NOT NULL AND created_at < $1::timestamptz - interval '2 minutes'
      ORDER BY created_at LIMIT 50`, [now],
  )
  for (const s of open) {
    const { outcome } = await syncCheckout(s.id, 'reconcile')
    if (outcome !== 'pending' && outcome !== 'unchanged') stats.reconciled++
  }
}

export async function runBillingTick(now = new Date()) {
  const stats = { trialsExpired: 0, trialReminders: 0, renewed: 0, failed: 0, unknown: 0, recovered: 0, suspended: 0, canceled: 0, reconciled: 0, resolved: 0 }
  const client = await pool.connect()
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_ID])
    if (!rows[0].ok) return { ...stats, locked: true }
    try {
      for (const job of [expireTrials, trialReminders, finishCanceled, resolveUnknownCharges, renewDue, retryPastDue, suspendAfterGrace, reconcileCheckouts]) {
        try {
          await job(now, stats)
        } catch (err) {
          logger.error('billing_job_failed', { job: job.name, err })
        }
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID])
    }
  } finally {
    client.release()
  }
  if (Object.values(stats).some(Boolean)) logger.info('billing_tick', stats)
  return stats
}

// ── Reconciliation report (operator) ───────────────────────

/** Compare our paid invoices with the provider's settled transactions for a date range. */
export async function reconciliationReport({ from, to }) {
  const provider = getProvider()
  const ours = await query(
    `SELECT id, number, workspace_id, total, currency, provider_transaction_id, paid_at FROM billing_invoices
      WHERE status = 'paid' AND provider = $3 AND paid_at >= $1 AND paid_at < $2`,
    [from, to, provider.name],
  )
  const theirs = await provider.listTransactions({ from, to })
  const issues = []
  if (theirs) {
    const byId = new Map(theirs.filter((t) => !t.isRefund).map((t) => [t.transactionId, t]))
    for (const inv of ours) {
      const t = byId.get(inv.provider_transaction_id)
      if (!t) issues.push({ type: 'missing_at_provider', invoice: inv.number, transactionId: inv.provider_transaction_id })
      else {
        if (t.amount !== inv.total) issues.push({ type: 'amount_mismatch', invoice: inv.number, ours: inv.total, provider: t.amount })
        byId.delete(inv.provider_transaction_id)
      }
    }
    for (const t of byId.values()) issues.push({ type: 'unmatched_provider_transaction', transactionId: t.transactionId, amount: t.amount })
  }
  const flagged = await query(
    `SELECT workspace_id, type, details, created_at FROM billing_events
      WHERE type IN ('duplicate_payment_needs_refund','payment_mismatch') AND created_at >= $1 AND created_at < $2`, [from, to],
  )
  for (const f of flagged) issues.push({ type: f.type, workspaceId: f.workspace_id, details: f.details, at: f.created_at })
  return { provider: provider.name, providerListAvailable: Boolean(theirs), invoices: ours.length, providerTransactions: theirs?.length ?? null, issues }
}

export { findPlan }
