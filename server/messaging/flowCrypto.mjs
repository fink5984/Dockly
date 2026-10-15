/**
 * WhatsApp Flows encryption (data_api_version 3.0).
 *
 * Endpoint requests: an AES-128 key encrypted with our RSA public key
 * (OAEP, SHA-256), and the JSON body encrypted with AES-GCM under that key.
 * Responses reuse the key with the request IV bit-flipped.
 *
 * Uploaded media: the CDN file is AES-256-CBC ciphertext followed by the
 * first 10 bytes of HMAC-SHA256(hmac_key, iv || ciphertext); hashes of the
 * CDN file and of the plaintext are checked as well.
 */
import { privateDecrypt, constants, createDecipheriv, createCipheriv, createHmac, createHash, timingSafeEqual } from 'crypto'

export class FlowCryptoError extends Error {}

const b64 = (s) => Buffer.from(String(s || ''), 'base64')

/** @returns {{ payload: object, aesKey: Buffer, iv: Buffer }} */
export function decryptFlowRequest(body, privateKeyPem) {
  const { encrypted_aes_key: encKey, encrypted_flow_data: encData, initial_vector: ivB64 } = body || {}
  if (!encKey || !encData || !ivB64) throw new FlowCryptoError('missing_fields')
  let aesKey
  try {
    aesKey = privateDecrypt({ key: privateKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, b64(encKey))
  } catch {
    throw new FlowCryptoError('bad_key')
  }
  const iv = b64(ivB64)
  const data = b64(encData)
  try {
    const decipher = createDecipheriv(`aes-${aesKey.length * 8}-gcm`, aesKey, iv)
    decipher.setAuthTag(data.subarray(-16))
    const json = Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()]).toString('utf8')
    return { payload: JSON.parse(json), aesKey, iv }
  } catch {
    throw new FlowCryptoError('bad_payload')
  }
}

/** @returns {string} base64 body to return as text/plain */
export function encryptFlowResponse(response, aesKey, iv) {
  const flipped = Buffer.from(iv.map((b) => ~b & 0xff))
  const cipher = createCipheriv(`aes-${aesKey.length * 8}-gcm`, aesKey, flipped)
  const enc = Buffer.concat([cipher.update(JSON.stringify(response), 'utf8'), cipher.final(), cipher.getAuthTag()])
  return enc.toString('base64')
}

const sha256 = (buf) => createHash('sha256').update(buf).digest()
/** Meta sends hashes base64-encoded; accept hex too. */
const hashMatches = (buf, expected) => {
  const h = sha256(buf)
  return expected === h.toString('base64') || expected === h.toString('hex')
}

/** Decrypt a Flow media file downloaded from `cdn_url`. */
export function decryptFlowMedia(cdnFile, meta) {
  if (!meta || !hashMatches(cdnFile, meta.encrypted_hash)) throw new FlowCryptoError('encrypted_hash_mismatch')
  const iv = b64(meta.iv)
  const ciphertext = cdnFile.subarray(0, -10)
  const mac = cdnFile.subarray(-10)
  const expected = createHmac('sha256', b64(meta.hmac_key)).update(iv).update(ciphertext).digest().subarray(0, 10)
  if (mac.length !== 10 || !timingSafeEqual(mac, expected)) throw new FlowCryptoError('hmac_mismatch')
  let plain
  try {
    const decipher = createDecipheriv('aes-256-cbc', b64(meta.encryption_key), iv)
    plain = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch {
    throw new FlowCryptoError('decrypt_failed')
  }
  if (!hashMatches(plain, meta.plaintext_hash)) throw new FlowCryptoError('plaintext_hash_mismatch')
  return plain
}
