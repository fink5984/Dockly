import { randomBytes, createHash, createHmac, timingSafeEqual } from 'crypto'

/** URL-safe random token with `bytes` bytes of entropy (default 32 → 256 bits). */
export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url')
}

export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex')
}

export function hmacSha256(secret, data) {
  return createHmac('sha256', secret).update(data).digest('base64url')
}

/** Constant-time string comparison. */
export function safeEqual(a, b) {
  const ab = Buffer.from(String(a))
  const bb = Buffer.from(String(b))
  if (ab.length !== bb.length) {
    // Still burn comparable time so length isn't trivially observable.
    timingSafeEqual(ab, ab)
    return false
  }
  return timingSafeEqual(ab, bb)
}
