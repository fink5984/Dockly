/**
 * In-memory fixed-window rate limiter. Sadir runs as a single Railway
 * instance; if it is ever scaled horizontally this must move to a shared
 * store (documented in SECURITY_REVIEW.md).
 */
import { tooMany } from './http.mjs'

const buckets = new Map()

// Periodic cleanup so the map doesn't grow without bound.
setInterval(() => {
  const now = Date.now()
  for (const [key, b] of buckets) if (b.resetAt <= now) buckets.delete(key)
}, 60_000).unref()

/** Returns { allowed, remaining, retryAfterSec } and records the hit. */
export function hit(key, limit, windowMs, now = Date.now()) {
  let b = buckets.get(key)
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs }
    buckets.set(key, b)
  }
  b.count += 1
  return {
    allowed: b.count <= limit,
    remaining: Math.max(0, limit - b.count),
    retryAfterSec: Math.ceil((b.resetAt - now) / 1000),
  }
}

export function resetRateLimits() {
  buckets.clear()
}

export function clientIp(req) {
  // `trust proxy` is set to 1 (Railway's edge), so req.ip is the real client.
  return req.ip || req.socket?.remoteAddress || 'unknown'
}

/**
 * Express middleware factory.
 * @param {{ name: string, limit: number, windowMs: number, key?: (req) => string }} opts
 */
export function rateLimit({ name, limit, windowMs, key }) {
  return (req, _res, next) => {
    if (process.env.DISABLE_RATE_LIMIT === 'true') return next()
    const k = `${name}:${key ? key(req) : clientIp(req)}`
    const r = hit(k, limit, windowMs)
    if (!r.allowed) return next(tooMany(r.retryAfterSec))
    next()
  }
}
