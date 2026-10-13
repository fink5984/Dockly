/**
 * Session authentication, role checks and CSRF protection.
 *
 * Roles (stored in profiles.role; legacy values mapped):
 *   owner  — everything, including workspace deletion and ownership
 *   admin  — settings, team, branding, deletes
 *   member — day-to-day work: clients, requests, reviews, signatures
 *   viewer — read-only
 */
import { config } from '../config.mjs'
import { queryOne } from '../db/pool.mjs'
import { SESSION_COOKIE, parseCookies, verifySession } from '../lib/session.mjs'
import { unauthorized, forbidden, HttpError } from '../lib/http.mjs'

const ROLE_RANK = { viewer: 0, member: 1, admin: 2, owner: 3 }

/** Map legacy role strings onto the four supported roles. */
export function normalizeRole(role) {
  switch (role) {
    case 'owner': return 'owner'
    case 'admin': return 'admin'
    case 'viewer': return 'viewer'
    case 'manager':
    case 'staff':
    case 'member':
    default: return 'member'
  }
}

export function roleAtLeast(role, minimum) {
  return ROLE_RANK[normalizeRole(role)] >= ROLE_RANK[minimum]
}

// Tiny TTL cache so every API call doesn't hit `profiles`.
const cache = new Map()
const CACHE_MS = 10_000

export function invalidateUserCache(profileId) {
  if (profileId) cache.delete(profileId)
  else cache.clear()
}

async function loadUser(profileId) {
  const hit = cache.get(profileId)
  if (hit && hit.expires > Date.now()) return hit.user
  const row = await queryOne(
    `SELECT p.id, p.workspace_id, p.email, p.name, p.role, p.phone, p.avatar_url, p.session_version, p.is_active
       FROM profiles p WHERE p.id = $1`,
    [profileId],
  )
  const user = row && {
    id: row.id,
    workspaceId: row.workspace_id,
    email: row.email,
    name: row.name,
    role: normalizeRole(row.role),
    phone: row.phone,
    avatarUrl: row.avatar_url,
    sessionVersion: row.session_version,
    isActive: row.is_active,
  }
  cache.set(profileId, { user, expires: Date.now() + CACHE_MS })
  return user
}

/** Attaches req.user when a valid session cookie is present. Never rejects. */
export async function attachUser(req, _res, next) {
  try {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE]
    if (!token) return next()
    const payload = verifySession(token, config.sessionSecret)
    if (!payload) return next()
    const user = await loadUser(payload.sub)
    if (!user || !user.isActive) return next()
    if (user.sessionVersion !== payload.sv || user.workspaceId !== payload.ws) return next()
    req.user = user
    req.session = payload
    next()
  } catch (err) {
    next(err)
  }
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized())
  next()
}

export function requireRole(minimum) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized())
    if (!roleAtLeast(req.user.role, minimum)) return next(forbidden())
    next()
  }
}

/** Shorthand: any mutating request needs at least `member`. */
export function requireWrite(req, _res, next) {
  if (!req.user) return next(unauthorized())
  if (!roleAtLeast(req.user.role, 'member')) return next(forbidden('read_only', 'Your role is read-only'))
  next()
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * CSRF defence for cookie-authenticated endpoints:
 *  1. state-changing requests must carry `X-Requested-With: dockly`, a custom
 *     header browsers won't send cross-site without a CORS preflight (which
 *     this server never grants), and
 *  2. if an Origin header is present it must be ours.
 * Public token endpoints and the WhatsApp webhook are exempt (no cookies used).
 */
export function csrfProtection(req, _res, next) {
  if (SAFE_METHODS.has(req.method)) return next()
  if (req.path.startsWith('/public/') || req.path.startsWith('/whatsapp/webhook')) return next()
  if (req.get('x-requested-with') !== 'dockly') {
    return next(new HttpError(403, 'csrf_failed', 'Request blocked'))
  }
  const origin = req.get('origin')
  if (origin) {
    const allowed = new Set([config.appBaseUrl, ...config.allowedOrigins])
    const self = `${req.protocol}://${req.get('host')}`
    if (!allowed.has(origin) && origin !== self) {
      return next(new HttpError(403, 'csrf_failed', 'Request blocked'))
    }
  }
  next()
}
