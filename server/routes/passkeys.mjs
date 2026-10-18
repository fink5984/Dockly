/**
 * Passkeys (WebAuthn): sign in with the device's fingerprint, face or screen
 * lock instead of a password.
 *
 *   register:  options → browser creates a credential → verify (stores the public key)
 *   sign-in:   options → browser signs the challenge   → verify (issues the session)
 *
 * Each ceremony gets a one-time server-side challenge (webauthn_challenges),
 * consumed on first use. Sign-in uses discoverable credentials, so the user
 * doesn't type an email: the browser offers the passkeys saved for this site.
 */
import { Router } from 'express'
import { z } from 'zod'
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import { config } from '../config.mjs'
import { query, queryOne } from '../db/pool.mjs'
import { parse, badRequest, conflict, unauthorized, requireUuid } from '../lib/http.mjs'
import { verifyPassword } from '../lib/passwords.mjs'
import { rateLimit, clientIp } from '../lib/rateLimit.mjs'
import { requireAuth } from '../middleware/auth.mjs'
import { logger } from '../lib/logger.mjs'
import { issueSession, loadMe } from './auth.mjs'

const router = Router()

const CHALLENGE_TTL_MS = 5 * 60 * 1000
const MAX_PASSKEYS = 20

/**
 * The relying party for this request. The app is served from several
 * addresses (its own domain and the Railway one). They share the main RP ID,
 * so one passkey works on all of them: subdomains natively, other domains via
 * related origins (see relatedOriginsDocument). With related origins off, an
 * address outside the RP ID domain is its own RP. The browser-set Origin
 * header picks the address (pages can't forge it); requests without one
 * (non-browser clients) get the main RP and any accepted origin.
 */
export function relyingParty(originHeader) {
  const { rpId, origins, relatedOrigins } = config.webauthn
  const origin = origins.includes(originHeader) ? originHeader : null
  if (!origin) return { id: rpId, origins }
  const host = new URL(origin).hostname
  const underRpId = host === rpId || host.endsWith(`.${rpId}`)
  return { id: underRpId || relatedOrigins ? rpId : host, origins: [origin] }
}

/** Body of /.well-known/webauthn on the RP ID domain: the other addresses allowed to use its passkeys. */
export function relatedOriginsDocument() {
  return { origins: config.webauthn.relatedOrigins ? config.webauthn.origins.filter((o) => o.startsWith('https://')) : [] }
}

async function createChallenge(challenge, purpose, userId = null) {
  await query('DELETE FROM webauthn_challenges WHERE expires_at < now()')
  const row = await queryOne(
    `INSERT INTO webauthn_challenges (challenge, purpose, user_id, expires_at) VALUES ($1, $2, $3, $4) RETURNING id`,
    [challenge, purpose, userId, new Date(Date.now() + CHALLENGE_TTL_MS)],
  )
  return row.id
}

/** Deletes and returns the challenge if it exists, is unexpired and matches. */
async function consumeChallenge(id, purpose, userId = null) {
  return queryOne(
    `DELETE FROM webauthn_challenges
      WHERE id = $1 AND purpose = $2 AND expires_at > now() AND user_id IS NOT DISTINCT FROM $3
      RETURNING challenge`,
    [id, purpose, userId],
  )
}

/** Short device label for the settings list, e.g. "iPhone · Safari". */
export function deviceLabel(ua = '') {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : ''
  const browser = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) || /CriOS/.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : ''
  return [os, browser].filter(Boolean).join(' · ')
}

const serialize = (r, rpIdHere) => ({
  id: r.id,
  name: r.name,
  synced: r.device_type === 'multiDevice',
  // Domain the passkey belongs to, and whether it works at the address the user is on.
  domain: r.rp_id,
  worksHere: !r.rp_id || r.rp_id === rpIdHere,
  createdAt: r.created_at,
  lastUsedAt: r.last_used_at,
})

// The browser's credential JSON; field-level checks are done by the WebAuthn library.
const credentialJson = z.object({
  id: z.string().min(1).max(1024),
  rawId: z.string().min(1).max(1024),
  type: z.literal('public-key'),
  response: z.record(z.string(), z.unknown()),
}).passthrough()

// ── Management (signed in) ─────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  const rows = await query(
    'SELECT id, name, device_type, rp_id, created_at, last_used_at FROM webauthn_credentials WHERE user_id = $1 ORDER BY created_at',
    [req.user.id],
  )
  // Same-origin GETs carry no Origin header: rebuild it from the request.
  const here = relyingParty(req.get('origin') || `${req.protocol}://${req.get('host')}`).id
  res.json({ passkeys: rows.map((r) => serialize(r, here)) })
})

/**
 * Adding a passkey creates a long-lived way into the account, so it needs the
 * current password, not just a session cookie (a stolen session can't add one).
 */
router.post('/register/options', requireAuth, rateLimit({ name: 'passkey-register', limit: 10, windowMs: 10 * 60 * 1000, key: (req) => req.user.id }), async (req, res) => {
  const body = parse(z.object({ password: z.string().min(1).max(200) }), req.body)
  const profile = await queryOne(`SELECT id, workspace_id, to_jsonb(profiles)->>'password' AS password, password_hash FROM profiles WHERE id = $1`, [req.user.id])
  const { ok } = await verifyPassword(body.password, profile)
  if (!ok) throw badRequest('invalid_current_password', 'Current password is incorrect')

  const existing = await query('SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = $1', [req.user.id])
  if (existing.length >= MAX_PASSKEYS) throw conflict('too_many_passkeys', 'Remove a passkey before adding another')

  const rp = relyingParty(req.get('origin'))
  const options = await generateRegistrationOptions({
    rpName: config.webauthn.rpName,
    rpID: rp.id,
    userName: req.user.email,
    userDisplayName: req.user.name || req.user.email,
    userID: new TextEncoder().encode(req.user.id),
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({ id: c.credential_id, transports: c.transports })),
    // Discoverable (sign in without typing an email) and verified on the device (fingerprint/face/PIN).
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    preferredAuthenticatorType: 'localDevice',
  })
  const challengeId = await createChallenge(options.challenge, 'register', req.user.id)
  res.json({ challengeId, options })
})

router.post('/register/verify', requireAuth, async (req, res) => {
  const body = parse(z.object({ challengeId: z.string().uuid(), response: credentialJson }), req.body)
  const ch = await consumeChallenge(body.challengeId, 'register', req.user.id)
  if (!ch) throw badRequest('passkey_expired', 'This request expired. Try again.')
  const rp = relyingParty(req.get('origin'))

  let verification
  try {
    verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: ch.challenge,
      expectedOrigin: rp.origins,
      expectedRPID: rp.id,
      requireUserVerification: true,
    })
  } catch (err) {
    logger.warn('passkey_register_failed', { userId: req.user.id, reason: err.message })
    throw badRequest('passkey_failed', 'The passkey could not be verified', { reason: String(err.message).slice(0, 300) })
  }
  if (!verification.verified) throw badRequest('passkey_failed', 'The passkey could not be verified')

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo
  const row = await queryOne(
    `INSERT INTO webauthn_credentials (user_id, credential_id, public_key, counter, transports, device_type, backed_up, name, rp_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (credential_id) DO NOTHING
     RETURNING id, name, device_type, rp_id, created_at, last_used_at`,
    [req.user.id, credential.id, Buffer.from(credential.publicKey), credential.counter, credential.transports || [],
      credentialDeviceType, credentialBackedUp, deviceLabel(String(req.get('user-agent') || '')), rp.id],
  )
  if (!row) throw conflict('passkey_exists', 'This passkey is already registered')
  res.status(201).json(serialize(row, rp.id))
})

router.delete('/:id', requireAuth, async (req, res) => {
  const id = requireUuid(req.params.id)
  await query('DELETE FROM webauthn_credentials WHERE id = $1 AND user_id = $2', [id, req.user.id])
  res.json({ ok: true })
})

/** A ceremony failed in the browser (never reaches verify): record why, for support. */
router.post('/client-error', rateLimit({ name: 'passkey-client-error', limit: 20, windowMs: 10 * 60 * 1000 }), async (req, res) => {
  const body = parse(z.object({ stage: z.enum(['register', 'signin']), detail: z.string().max(500) }), req.body)
  const report = {
    stage: body.stage, detail: body.detail, origin: String(req.get('origin') || '').slice(0, 200),
    userId: req.user?.id || null, ua: String(req.get('user-agent') || '').slice(0, 300),
  }
  logger.warn('passkey_client_error', report)
  await query(`DELETE FROM passkey_client_errors WHERE created_at < now() - interval '14 days'`)
  await query(
    'INSERT INTO passkey_client_errors (stage, detail, origin, user_id, user_agent) VALUES ($1, $2, $3, $4, $5)',
    [report.stage, report.detail, report.origin, report.userId, report.ua],
  )
  res.json({ ok: true })
})

// ── Sign-in (public) ───────────────────────────────────────
router.post('/signin/options', rateLimit({ name: 'passkey-signin-options', limit: 30, windowMs: 10 * 60 * 1000 }), async (req, res) => {
  const options = await generateAuthenticationOptions({ rpID: relyingParty(req.get('origin')).id, userVerification: 'required' })
  const challengeId = await createChallenge(options.challenge, 'signin')
  res.json({ challengeId, options })
})

router.post('/signin/verify', rateLimit({ name: 'signin-ip', limit: 20, windowMs: 10 * 60 * 1000 }), async (req, res) => {
  const body = parse(z.object({ challengeId: z.string().uuid(), response: credentialJson }), req.body)
  const fail = (reason) => {
    logger.warn('passkey_signin_failed', { ip: clientIp(req), reason })
    return unauthorized('passkey_failed', 'Sign-in with passkey failed')
  }
  const ch = await consumeChallenge(body.challengeId, 'signin')
  if (!ch) throw fail('challenge')

  const cred = await queryOne(
    `SELECT c.id, c.user_id, c.credential_id, c.public_key, c.counter, c.transports,
            p.workspace_id, p.session_version, p.is_active
       FROM webauthn_credentials c JOIN profiles p ON p.id = c.user_id
      WHERE c.credential_id = $1`,
    [body.response.id],
  )
  // Unknown credential: typically a passkey whose account or registration was removed.
  if (!cred) throw unauthorized('passkey_unknown', 'This passkey is not registered with any account')
  if (!cred.is_active) throw fail('inactive')
  const userHandle = body.response.response.userHandle
  if (userHandle && userHandle !== Buffer.from(cred.user_id).toString('base64url')) throw fail('user_handle')

  const rp = relyingParty(req.get('origin'))
  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: ch.challenge,
      expectedOrigin: rp.origins,
      expectedRPID: rp.id,
      credential: { id: cred.credential_id, publicKey: new Uint8Array(cred.public_key), counter: Number(cred.counter), transports: cred.transports },
      requireUserVerification: true,
    })
  } catch (err) {
    throw fail(err.message)
  }
  if (!verification.verified) throw fail('unverified')

  const info = verification.authenticationInfo
  await query(
    'UPDATE webauthn_credentials SET counter = $2, backed_up = $3, last_used_at = now() WHERE id = $1',
    [cred.id, info.newCounter, info.credentialBackedUp],
  )
  await query('UPDATE profiles SET last_login_at = now() WHERE id = $1', [cred.user_id])
  issueSession(res, { id: cred.user_id, workspace_id: cred.workspace_id, session_version: cred.session_version })
  res.json(await loadMe(cred.user_id))
})

export default router
