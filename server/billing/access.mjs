/**
 * Entitlements: what a workspace may do right now, and how much it has used.
 *
 * This is the single place access decisions are made. Routes call the
 * `assert*` / `consume*` helpers; the UI only mirrors the result.
 *
 * Status model
 *   legacy     grandfathered pre-billing workspace: everything, quotas not enforced
 *   comped     granted by an operator: plan limits (or none), never billed
 *   trialing   30-day no-card trial with trial limits
 *   active     paid and current
 *   past_due   renewal failed; full access during the grace period
 *   expired    trial ended without a plan                     → read-only
 *   suspended  grace period ended without payment              → read-only
 *   canceled   cancelled and the paid period is over           → read-only
 *
 * "Read-only" keeps the workspace's data fully available (view, download,
 * export) and keeps links already sent to clients working, but stops new
 * requests, envelopes, staff uploads and outgoing messages.
 */
import { query, queryOne } from '../db/pool.mjs'
import { HttpError } from '../lib/http.mjs'
import { catalog, findPlan, effectiveLimits, addInterval } from '../../shared/billing/pricing.mjs'

export const READ_ONLY_STATUSES = new Set(['expired', 'suspended', 'canceled'])
const PRODUCT_OF = { requests: 'collect', envelopes: 'sign' }
const db0 = { query, queryOne }

/** Load the subscription row; a workspace without one gets a trial (never unlimited access). */
export async function loadSubscription(workspaceId, db = db0) {
  const row = await db.queryOne('SELECT * FROM workspace_subscriptions WHERE workspace_id = $1', [workspaceId])
  if (row) return row
  await db.query(
    `INSERT INTO workspace_subscriptions (workspace_id, status, trial_started_at, trial_ends_at)
     VALUES ($1, 'trialing', now(), now() + make_interval(hours => $2 * 24)) ON CONFLICT (workspace_id) DO NOTHING`,
    [workspaceId, catalog.trial.days],
  )
  return db.queryOne('SELECT * FROM workspace_subscriptions WHERE workspace_id = $1', [workspaceId])
}

/**
 * Status as of `now`, derived from timestamps so enforcement is correct even
 * if the scheduler hasn't run yet.
 */
export function effectiveStatus(row, now = new Date()) {
  const t = now.getTime()
  const at = (v) => (v ? new Date(v).getTime() : null)
  switch (row.status) {
    case 'trialing': return at(row.trial_ends_at) !== null && at(row.trial_ends_at) <= t ? 'expired' : 'trialing'
    case 'active':
      if (row.cancel_at_period_end && at(row.current_period_end) !== null && at(row.current_period_end) <= t) return 'canceled'
      return 'active'
    case 'past_due': return at(row.grace_ends_at) !== null && at(row.grace_ends_at) <= t ? 'suspended' : 'past_due'
    case 'legacy': return at(row.legacy_until) !== null && at(row.legacy_until) <= t ? 'expired' : 'legacy'
    default: return row.status
  }
}

/** The window monthly quotas are counted in. Yearly plans still have monthly quotas. */
export function usageWindow(row, status, now = new Date()) {
  const trialBased = !row.plan_code && row.trial_started_at && (status === 'trialing' || status === 'expired')
  if (trialBased) return { start: new Date(row.trial_started_at), end: new Date(row.trial_ends_at) }
  if (row.plan_code && row.current_period_start && status !== 'comped') {
    const anchor = new Date(row.current_period_start)
    let k = 0
    while (k < 600 && addInterval(anchor, 'month', k + 1) <= now) k++
    return { start: addInterval(anchor, 'month', k), end: addInterval(anchor, 'month', k + 1) }
  }
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  return { start, end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) }
}

function baseFor(row, status) {
  if (status === 'legacy') return { base: null, products: ['collect', 'sign'] }
  const plan = row.plan_code ? findPlan(row.plan_code) : null
  if (plan) return { base: plan.limits, products: plan.products }
  if (status === 'comped') return { base: null, products: ['collect', 'sign'] }
  return { base: catalog.trial.limits, products: catalog.trial.products }
}

/**
 * Full access picture for a workspace (cheap: 3 small queries).
 * Storage and seats are only measured when `measure` is true.
 */
export async function getAccess(workspaceId, { db = db0, now = new Date(), measure = false } = {}) {
  const row = await loadSubscription(workspaceId, db)
  const status = effectiveStatus(row, now)
  const window = usageWindow(row, status, now)
  const { base, products } = baseFor(row, status)
  const [counters, credits] = await Promise.all([
    db.query('SELECT metric, used FROM usage_counters WHERE workspace_id = $1 AND period_start = $2', [workspaceId, window.start]),
    db.query(
      `SELECT metric, sum(quantity)::int AS q FROM usage_credits
        WHERE workspace_id = $1 AND valid_from <= $2 AND valid_until > $2 GROUP BY metric`,
      [workspaceId, now],
    ),
  ])
  const creditMap = Object.fromEntries(credits.map((c) => [c.metric, c.q]))
  const limits = effectiveLimits({ base, addons: row.addons || [], credits: creditMap })
  const usage = { requests: 0, envelopes: 0 }
  for (const c of counters) usage[c.metric] = c.used
  if (measure) {
    const [storageBytes, seats] = await Promise.all([storageUsedBytes(workspaceId, db), seatsUsed(workspaceId, db)])
    usage.storageBytes = storageBytes
    usage.seats = seats
  }
  return {
    row,
    status,
    readOnly: READ_ONLY_STATUSES.has(status),
    products,
    limits,
    credits: creditMap,
    usage,
    window,
  }
}

// ── Measurements ───────────────────────────────────────────

/** Bytes stored for a workspace: every request-file version, legacy single files and signature documents. */
export async function storageUsedBytes(workspaceId, db = db0) {
  const r = await db.queryOne(
    `SELECT COALESCE((SELECT sum(size_bytes) FROM case_document_files WHERE workspace_id = $1), 0)::bigint
          + COALESCE((SELECT sum(cd.file_size) FROM case_documents cd JOIN cases c ON c.id = cd.case_id
                       WHERE c.workspace_id = $1 AND cd.current_file_id IS NULL AND cd.storage_path IS NOT NULL), 0)::bigint
          + COALESCE((SELECT sum(document_file_size) FROM signature_requests WHERE workspace_id = $1), 0)::bigint
          + COALESCE((SELECT sum(sd.file_size) FROM signature_documents sd JOIN signature_requests s ON s.id = sd.request_id
                       WHERE s.workspace_id = $1), 0)::bigint AS bytes`,
    [workspaceId],
  )
  return Number(r.bytes)
}

/** Seats: active members plus outstanding invitations. */
export async function seatsUsed(workspaceId, db = db0) {
  const r = await db.queryOne(
    `SELECT (SELECT count(*) FROM profiles WHERE workspace_id = $1 AND is_active)::int
          + (SELECT count(*) FROM workspace_invites WHERE workspace_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now())::int AS n`,
    [workspaceId],
  )
  return r.n
}

// ── Enforcement ────────────────────────────────────────────

const paymentRequired = (code, message, details) => new HttpError(402, code, message, { upgrade: true, ...details })

export function assertNotReadOnly(access) {
  if (access.readOnly) {
    throw paymentRequired('subscription_inactive', inactiveMessage(access.status), { status: access.status })
  }
}

function inactiveMessage(status) {
  if (status === 'expired') return 'Your free trial has ended. Choose a plan to keep creating requests — your data is safe.'
  if (status === 'suspended') return 'Your subscription is paused because of a payment problem. Update your payment method to continue.'
  return 'Your subscription has ended. Choose a plan to continue.'
}

export function assertProduct(access, product) {
  if (!access.products.includes(product)) {
    throw paymentRequired('plan_required', product === 'sign'
      ? 'E-Signatures aren’t included in your plan. Add them to send documents for signature.'
      : 'Document Collection isn’t included in your plan. Add it to send document requests.', { product })
  }
}

/** Workspace must be writable (not read-only). Returns the access picture. */
export async function assertWritable(workspaceId, db = db0) {
  const access = await getAccess(workspaceId, { db })
  assertNotReadOnly(access)
  return access
}

/** Product included and workspace writable (no quota consumed), e.g. uploading a file to sign. */
export async function assertCanUse(workspaceId, product, db = db0) {
  const access = await getAccess(workspaceId, { db })
  assertNotReadOnly(access)
  assertProduct(access, product)
  return access
}

/**
 * Consume one unit of a monthly quota inside the caller's transaction, so a
 * failed create gives the unit back. Atomic: concurrent creates can't overshoot.
 */
export async function consumeQuota(tx, workspaceId, metric, { now = new Date() } = {}) {
  const access = await getAccess(workspaceId, { db: tx, now })
  assertNotReadOnly(access)
  assertProduct(access, PRODUCT_OF[metric])
  const limit = access.limits[metric]
  if (limit === null) {
    // Not enforced (legacy/comped): still counted, for usage display.
    await tx.query(
      `INSERT INTO usage_counters (workspace_id, metric, period_start, used) VALUES ($1,$2,$3,1)
       ON CONFLICT (workspace_id, metric, period_start) DO UPDATE SET used = usage_counters.used + 1, updated_at = now()`,
      [workspaceId, metric, access.window.start],
    )
    return { used: access.usage[metric] + 1, limit }
  }
  const row = await tx.queryOne(
    `INSERT INTO usage_counters (workspace_id, metric, period_start, used)
     SELECT $1, $2, $3, 1 WHERE $4::int >= 1
     ON CONFLICT (workspace_id, metric, period_start)
       DO UPDATE SET used = usage_counters.used + 1, updated_at = now() WHERE usage_counters.used < $4::int
     RETURNING used`,
    [workspaceId, metric, access.window.start, limit],
  )
  if (!row) {
    throw paymentRequired('quota_exceeded', metric === 'requests'
      ? `You’ve used all ${limit} document requests for this period. Upgrade or add a request pack to send more.`
      : `You’ve used all ${limit} signature envelopes for this period. Upgrade or add a signature pack to send more.`,
    { metric, limit, used: access.usage[metric], resetsAt: access.window.end })
  }
  return { used: row.used, limit }
}

/**
 * Storage check before accepting a file. Client-portal/WhatsApp uploads get a
 * small buffer so a client in the middle of a submission isn't cut off.
 */
export async function assertStorage(workspaceId, incomingBytes, { via = 'staff', db = db0 } = {}) {
  const access = await getAccess(workspaceId, { db })
  if (via === 'staff') assertNotReadOnly(access)
  const limit = access.limits.storageBytes
  if (limit === null) return access
  const allowance = via === 'staff' ? limit : Math.floor(limit * (1 + catalog.portalStorageBuffer))
  const used = await storageUsedBytes(workspaceId, db)
  if (used + incomingBytes > allowance) {
    throw new HttpError(via === 'staff' ? 402 : 507, 'storage_limit_reached',
      via === 'staff'
        ? 'Your workspace storage is full. Upgrade your plan or add storage to upload more files.'
        : 'This business can’t receive more files right now. Please contact them directly.',
      via === 'staff' ? { upgrade: true, limitBytes: limit, usedBytes: used } : undefined)
  }
  return access
}

export async function assertSeatAvailable(workspaceId, db = db0) {
  const access = await getAccess(workspaceId, { db })
  assertNotReadOnly(access)
  if (access.limits.seats === null) return
  const used = await seatsUsed(workspaceId, db)
  if (used >= access.limits.seats) {
    throw paymentRequired('seat_limit_reached', `Your plan includes ${access.limits.seats} team seats. Add a seat or upgrade to invite more people.`, { seats: access.limits.seats, used })
  }
}

/** Outgoing client messages cost money (WhatsApp) — not sent from read-only workspaces. */
export async function messagingAllowed(workspaceId) {
  const access = await getAccess(workspaceId)
  return !access.readOnly
}

/** Compact summary for /api/auth/me (drives banners and gating in the UI). */
export async function accessSummary(workspaceId) {
  const a = await getAccess(workspaceId)
  const r = a.row
  return {
    status: a.status,
    readOnly: a.readOnly,
    planCode: r.plan_code || null,
    interval: r.billing_interval || null,
    products: a.products,
    trialEndsAt: r.trial_ends_at || null,
    currentPeriodEnd: r.current_period_end || null,
    cancelAtPeriodEnd: r.cancel_at_period_end,
    graceEndsAt: r.grace_ends_at || null,
    legacyUntil: r.legacy_until || null,
  }
}
