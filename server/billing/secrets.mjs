/**
 * Encryption at rest for payment-provider tokens (AES-256-GCM).
 *
 * A Cardcom token is not a card number, but it can be charged with our
 * terminal credentials, so it's treated as a secret: encrypted in the
 * database, never logged, never sent to the browser.
 *
 * Format: v1.<iv>.<tag>.<ciphertext> (base64url). The key comes from
 * BILLING_ENCRYPTION_KEY; outside production it falls back to a key derived
 * from SESSION_SECRET so local development works without extra setup.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'
import { config } from '../config.mjs'

function key() {
  const material = config.billing.encryptionKey || (config.isProduction ? '' : `dev-billing:${config.sessionSecret}`)
  if (!material) throw new Error('BILLING_ENCRYPTION_KEY is not configured')
  return createHash('sha256').update(material).digest()
}

export function encryptSecret(plain) {
  if (plain === null || plain === undefined || plain === '') return null
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.')
}

export function decryptSecret(blob) {
  if (!blob) return null
  const [v, iv, tag, ct] = String(blob).split('.')
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Unsupported secret format')
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8')
}
