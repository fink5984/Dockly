/**
 * Stateless signed session tokens carried in an httpOnly cookie.
 *
 *   token = base64url(JSON payload) + "." + HMAC-SHA256(secret, payload)
 *   payload = { sub: profileId, ws: workspaceId, sv: sessionVersion, iat, exp }
 *
 * Revocation: bumping profiles.session_version invalidates every token
 * issued before (logout-everywhere, password change, member removal).
 */
import { hmacSha256, safeEqual } from './crypto.mjs'

export const SESSION_COOKIE = 'dockly_session'

export function signSession(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${hmacSha256(secret, body)}`
}

/** Returns the payload if the signature is valid and the token is unexpired, else null. */
export function verifySession(token, secret, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 2048) return null
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const body = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  if (!safeEqual(sig, hmacSha256(secret, body))) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < now) return null
    if (typeof payload.sub !== 'string' || typeof payload.ws !== 'string') return null
    return payload
  } catch {
    return null
  }
}

export function buildSessionPayload({ profileId, workspaceId, sessionVersion }, ttlDays, now = Date.now()) {
  const iat = Math.floor(now / 1000)
  return { sub: profileId, ws: workspaceId, sv: sessionVersion, iat, exp: iat + ttlDays * 86400 }
}

export function parseCookies(header) {
  const out = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    const key = part.slice(0, idx).trim()
    const val = part.slice(idx + 1).trim()
    if (key) {
      try { out[key] = decodeURIComponent(val) } catch { out[key] = val }
    }
  }
  return out
}

export function sessionCookie(token, { maxAgeSeconds, secure }) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function clearSessionCookie({ secure }) {
  return sessionCookie('', { maxAgeSeconds: 0, secure })
}
