/**
 * Password hashing with scrypt (Node built-in, memory-hard).
 * Stored format: scrypt$N$r$p$<salt b64url>$<hash b64url>
 *
 * Legacy rows created before the security upgrade have the plaintext in
 * `profiles.password` and no `password_hash`. `verifyPassword` accepts those
 * once (constant-time compare) and reports `needsRehash` so the caller can
 * replace the plaintext with a hash on the spot.
 */
import { scrypt as scryptCb, randomBytes, timingSafeEqual } from 'crypto'
import { promisify } from 'util'
import { safeEqual } from './crypto.mjs'

const scrypt = promisify(scryptCb)
const N = 16384
const R = 8
const P = 1
const KEYLEN = 64

export async function hashPassword(password) {
  const salt = randomBytes(16)
  const hash = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 })
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${hash.toString('base64url')}`
}

async function verifyScrypt(password, stored) {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, n, r, p, saltB64, hashB64] = parts
  const salt = Buffer.from(saltB64, 'base64url')
  const expected = Buffer.from(hashB64, 'base64url')
  const actual = await scrypt(password, salt, expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
  })
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

// A fixed hash used to equalise timing when the account doesn't exist.
let dummyHash = null
async function getDummyHash() {
  if (!dummyHash) dummyHash = await hashPassword('dockly-timing-equaliser')
  return dummyHash
}

/**
 * @param {string} password candidate
 * @param {{ password_hash?: string|null, password?: string|null } | null} row
 * @returns {Promise<{ ok: boolean, needsRehash: boolean }>}
 */
export async function verifyPassword(password, row) {
  if (!row) {
    await verifyScrypt(password, await getDummyHash())
    return { ok: false, needsRehash: false }
  }
  if (row.password_hash) {
    return { ok: await verifyScrypt(password, row.password_hash), needsRehash: false }
  }
  if (row.password) {
    // Legacy plaintext — compare in constant time, then caller rehashes.
    await verifyScrypt(password, await getDummyHash())
    const ok = safeEqual(password, row.password)
    return { ok, needsRehash: ok }
  }
  await verifyScrypt(password, await getDummyHash())
  return { ok: false, needsRehash: false }
}

/** Basic strength policy: length is what matters; block the most common. */
export function passwordPolicyError(password) {
  if (typeof password !== 'string' || password.length < 8) return 'Password must be at least 8 characters'
  if (password.length > 200) return 'Password is too long'
  const common = ['password', '12345678', '123456789', 'qwertyui', '11111111', 'password1', 'iloveyou']
  if (common.includes(password.toLowerCase())) return 'This password is too common'
  return null
}
