import { Router } from 'express'
import { z } from 'zod'
import { config } from '../config.mjs'
import { query, queryOne, withTransaction } from '../db/pool.mjs'
import { parse, badRequest, conflict, unauthorized, HttpError, notFound, gone } from '../lib/http.mjs'
import { hashPassword, verifyPassword, passwordPolicyError } from '../lib/passwords.mjs'
import { signSession, buildSessionPayload, sessionCookie, clearSessionCookie } from '../lib/session.mjs'
import { rateLimit, hit, clientIp } from '../lib/rateLimit.mjs'
import { sha256Hex } from '../lib/crypto.mjs'
import { requireAuth, invalidateUserCache, normalizeRole } from '../middleware/auth.mjs'
import { logActivity } from '../lib/activity.mjs'
import { serializeWorkspace } from './workspace.mjs'
import { logger } from '../lib/logger.mjs'
import { accessSummary } from '../billing/access.mjs'
import { recordMilestone } from '../lib/funnel.mjs'
import { catalog } from '../../shared/billing/pricing.mjs'

const router = Router()

const LOCK_AFTER = 8

// The legacy plaintext column is dropped by a manual step after all passwords
// are hashed (server/db/manual/drop_plaintext_password.sql). Read it through
// to_jsonb() and only clear it while it still exists, so both states work.
let legacyColumn = null
async function hasLegacyPasswordColumn() {
  if (legacyColumn === null) {
    legacyColumn = Boolean(await queryOne(`SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'password'`))
  }
  return legacyColumn
}
async function clearLegacyPassword(id) {
  if (await hasLegacyPasswordColumn()) await query(`UPDATE profiles SET password = '' WHERE id = $1`, [id])
}
const LOCK_MINUTES = 15

function issueSession(res, profile) {
  const payload = buildSessionPayload(
    { profileId: profile.id, workspaceId: profile.workspace_id, sessionVersion: profile.session_version },
    config.sessionTtlDays,
  )
  const token = signSession(payload, config.sessionSecret)
  res.setHeader('Set-Cookie', sessionCookie(token, { maxAgeSeconds: config.sessionTtlDays * 86400, secure: config.isProduction }))
}

export async function loadMe(profileId) {
  const p = await queryOne('SELECT id, email, name, role, phone, avatar_url, workspace_id FROM profiles WHERE id = $1', [profileId])
  if (!p) return null
  const ws = await queryOne('SELECT * FROM workspaces WHERE id = $1', [p.workspace_id])
  return {
    user: {
      id: p.id,
      email: p.email,
      name: p.name,
      role: normalizeRole(p.role),
      phone: p.phone || undefined,
      avatar: p.avatar_url || undefined,
      workspaceId: p.workspace_id,
    },
    workspace: ws ? serializeWorkspace(ws) : null,
    billing: ws ? await accessSummary(ws.id) : null,
  }
}

const emailSchema = z.string().trim().toLowerCase().email().max(254)

router.post('/signup', rateLimit({ name: 'signup', limit: 5, windowMs: 60 * 60 * 1000 }), async (req, res) => {
  const body = parse(z.object({
    email: emailSchema,
    password: z.string().max(200),
    name: z.string().trim().min(1).max(120),
    phone: z.string().trim().max(40).optional().default(''),
    language: z.enum(['en', 'he']).optional(),
    // Non-identifying marketing attribution (see lib/funnel.mjs for what is kept).
    attribution: z.record(z.string(), z.string().max(100)).optional(),
  }), req.body)
  const policy = passwordPolicyError(body.password)
  if (policy) throw badRequest('weak_password', policy)

  const exists = await queryOne('SELECT 1 FROM profiles WHERE lower(email) = $1', [body.email])
  if (exists) throw conflict('email_taken', 'An account with this email already exists')

  const passwordHash = await hashPassword(body.password)
  const profile = await withTransaction(async (tx) => {
    const ws = await tx.queryOne(
      `INSERT INTO workspaces (name, business_type, contact_person, phone, email, default_language, timezone)
       VALUES ('', 'other', $1, $2, $3, $4, 'Asia/Jerusalem') RETURNING id`,
      [body.name, body.phone, body.email, body.language || 'he'],
    )
    // The insert trigger started a trial; its length comes from the catalog.
    await tx.query(
      `UPDATE workspace_subscriptions SET trial_ends_at = trial_started_at + make_interval(hours => $2 * 24) WHERE workspace_id = $1 AND status = 'trialing'`,
      [ws.id, catalog.trial.days],
    )
    return tx.queryOne(
      `INSERT INTO profiles (workspace_id, email, name, role, phone, password_hash)
       VALUES ($1, $2, $3, 'owner', $4, $5) RETURNING id, workspace_id, session_version`,
      [ws.id, body.email, body.name, body.phone, passwordHash],
    )
  })
  issueSession(res, profile)
  const a = body.attribution || {}
  await recordMilestone(profile.workspace_id, 'signup', { ...a, lang: body.language || 'he' }, a.sessionId)
  res.status(201).json(await loadMe(profile.id))
})

router.post('/signin', rateLimit({ name: 'signin-ip', limit: 20, windowMs: 10 * 60 * 1000 }), async (req, res) => {
  const body = parse(z.object({ email: emailSchema, password: z.string().min(1).max(200) }), req.body)
  // Per-account limiter in addition to the per-IP one.
  const perAccount = hit(`signin-acct:${body.email}`, 10, 10 * 60 * 1000)
  if (!perAccount.allowed) throw new HttpError(429, 'rate_limited', 'Too many attempts. Try again in a few minutes.', { retryAfter: perAccount.retryAfterSec })

  const profile = await queryOne(
    `SELECT id, workspace_id, to_jsonb(profiles)->>'password' AS password, password_hash, session_version, failed_login_count, locked_until, is_active
       FROM profiles WHERE lower(email) = $1 ORDER BY created_at LIMIT 1`,
    [body.email],
  )
  if (profile?.locked_until && new Date(profile.locked_until) > new Date()) {
    await verifyPassword(body.password, null) // keep timing uniform
    throw new HttpError(429, 'account_locked', 'Too many failed attempts. Try again later.')
  }
  const { ok, needsRehash } = await verifyPassword(body.password, profile)
  if (!ok || !profile?.is_active) {
    if (profile) {
      await query(
        `UPDATE profiles SET failed_login_count = failed_login_count + 1,
           locked_until = CASE WHEN failed_login_count + 1 >= $2 THEN now() + ($3 || ' minutes')::interval ELSE locked_until END
         WHERE id = $1`,
        [profile.id, LOCK_AFTER, String(LOCK_MINUTES)],
      )
    }
    logger.warn('signin_failed', { ip: clientIp(req) })
    throw unauthorized('invalid_credentials', 'Incorrect email or password')
  }
  if (needsRehash) {
    // Legacy plaintext row: replace with a hash and erase the plaintext now.
    await query(`UPDATE profiles SET password_hash = $2 WHERE id = $1`, [profile.id, await hashPassword(body.password)])
    await clearLegacyPassword(profile.id)
  }
  await query('UPDATE profiles SET failed_login_count = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [profile.id])
  issueSession(res, profile)
  res.json(await loadMe(profile.id))
})

router.post('/signout', (req, res) => {
  res.setHeader('Set-Cookie', clearSessionCookie({ secure: config.isProduction }))
  res.json({ ok: true })
})

/** Sign out every session for this user (bumps session_version). */
router.post('/signout-all', requireAuth, async (req, res) => {
  await query('UPDATE profiles SET session_version = session_version + 1 WHERE id = $1', [req.user.id])
  invalidateUserCache(req.user.id)
  res.setHeader('Set-Cookie', clearSessionCookie({ secure: config.isProduction }))
  res.json({ ok: true })
})

router.get('/me', async (req, res) => {
  if (!req.user) return res.json({ user: null, workspace: null })
  res.json(await loadMe(req.user.id))
})

router.patch('/me', requireAuth, async (req, res) => {
  const body = parse(z.object({
    name: z.string().trim().min(1).max(120).optional(),
    phone: z.string().trim().max(40).optional(),
  }), req.body)
  await query('UPDATE profiles SET name = COALESCE($2, name), phone = COALESCE($3, phone) WHERE id = $1', [req.user.id, body.name ?? null, body.phone ?? null])
  invalidateUserCache(req.user.id)
  res.json(await loadMe(req.user.id))
})

router.post('/change-password', requireAuth, rateLimit({ name: 'change-password', limit: 10, windowMs: 60 * 60 * 1000 }), async (req, res) => {
  const body = parse(z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().max(200) }), req.body)
  const policy = passwordPolicyError(body.newPassword)
  if (policy) throw badRequest('weak_password', policy)
  const profile = await queryOne(`SELECT id, workspace_id, to_jsonb(profiles)->>'password' AS password, password_hash FROM profiles WHERE id = $1`, [req.user.id])
  const { ok } = await verifyPassword(body.currentPassword, profile)
  if (!ok) throw badRequest('invalid_current_password', 'Current password is incorrect')
  const updated = await queryOne(
    `UPDATE profiles SET password_hash = $2, session_version = session_version + 1 WHERE id = $1
     RETURNING id, workspace_id, session_version`,
    [req.user.id, await hashPassword(body.newPassword)],
  )
  await clearLegacyPassword(req.user.id)
  invalidateUserCache(req.user.id)
  issueSession(res, updated) // keep this device signed in; others are revoked
  res.json({ ok: true })
})

// ── Invites ────────────────────────────────────────────────
router.get('/invite/:token', rateLimit({ name: 'invite-view', limit: 30, windowMs: 10 * 60 * 1000 }), async (req, res) => {
  const inv = await queryOne(
    `SELECT i.email, i.name, i.role, i.expires_at, i.accepted_at, i.revoked_at, w.name AS ws_name
       FROM workspace_invites i JOIN workspaces w ON w.id = i.workspace_id WHERE i.token_hash = $1`,
    [sha256Hex(String(req.params.token))],
  )
  if (!inv || inv.revoked_at) throw notFound('invalid_invite', 'This invitation is not valid')
  if (inv.accepted_at) throw gone('invite_used', 'This invitation was already used')
  if (new Date(inv.expires_at) < new Date()) throw gone('invite_expired', 'This invitation has expired')
  res.json({ email: inv.email, name: inv.name, role: normalizeRole(inv.role), workspaceName: inv.ws_name })
})

router.post('/invite/:token/accept', rateLimit({ name: 'invite-accept', limit: 10, windowMs: 10 * 60 * 1000 }), async (req, res) => {
  const body = parse(z.object({ name: z.string().trim().min(1).max(120), password: z.string().max(200) }), req.body)
  const policy = passwordPolicyError(body.password)
  if (policy) throw badRequest('weak_password', policy)
  const passwordHash = await hashPassword(body.password)
  const profile = await withTransaction(async (tx) => {
    const inv = await tx.queryOne(
      `SELECT * FROM workspace_invites WHERE token_hash = $1 FOR UPDATE`, [sha256Hex(String(req.params.token))],
    )
    if (!inv || inv.revoked_at) throw notFound('invalid_invite', 'This invitation is not valid')
    if (inv.accepted_at) throw gone('invite_used', 'This invitation was already used')
    if (new Date(inv.expires_at) < new Date()) throw gone('invite_expired', 'This invitation has expired')
    const taken = await tx.queryOne('SELECT 1 FROM profiles WHERE lower(email) = lower($1)', [inv.email])
    if (taken) throw conflict('email_taken', 'An account with this email already exists')
    const p = await tx.queryOne(
      `INSERT INTO profiles (workspace_id, email, name, role, password_hash)
       VALUES ($1, lower($2), $3, $4, $5) RETURNING id, workspace_id, session_version`,
      [inv.workspace_id, inv.email, body.name, normalizeRole(inv.role), passwordHash],
    )
    await tx.query('UPDATE workspace_invites SET accepted_at = now() WHERE id = $1', [inv.id])
    return p
  })
  await logActivity({ workspaceId: profile.workspace_id, type: 'member_joined', description: `${body.name} joined the workspace`, actor: { type: 'user', id: profile.id, name: body.name } })
  issueSession(res, profile)
  res.status(201).json(await loadMe(profile.id))
})

export default router
