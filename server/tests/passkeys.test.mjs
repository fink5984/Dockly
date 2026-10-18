import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createHash, generateKeyPairSync, randomBytes, sign } from 'crypto'
import { isoCBOR } from '@simplewebauthn/server/helpers'
import { startApp, stopApp, Client, newOwner, skipIntegration } from './helpers.mjs'
import { deviceLabel } from '../routes/passkeys.mjs'

const ORIGIN = 'http://localhost' // APP_BASE_URL in vitest.config.mjs
const RP_ID = 'localhost'
const b64 = (buf) => Buffer.from(buf).toString('base64url')
const sha256 = (data) => createHash('sha256').update(data).digest()

/** Software authenticator: what the phone's fingerprint sensor + secure chip do. */
class VirtualAuthenticator {
  constructor() {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    this.privateKey = privateKey
    this.jwk = publicKey.export({ format: 'jwk' })
    this.credentialId = randomBytes(16)
    this.counter = 0
  }

  authData({ attested = false, flags = 0x05 } = {}) {
    const counter = Buffer.alloc(4)
    counter.writeUInt32BE(this.counter)
    const parts = [sha256(RP_ID), Buffer.from([attested ? flags | 0x40 : flags]), counter]
    if (attested) {
      const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(this.jwk.x, 'base64url')], [-3, Buffer.from(this.jwk.y, 'base64url')]])
      const len = Buffer.alloc(2)
      len.writeUInt16BE(this.credentialId.length)
      parts.push(Buffer.alloc(16), len, this.credentialId, Buffer.from(isoCBOR.encode(cose)))
    }
    return Buffer.concat(parts)
  }

  register(options, { origin = ORIGIN } = {}) {
    this.userHandle = options.user.id
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin, crossOrigin: false }))
    const attestationObject = isoCBOR.encode(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', this.authData({ attested: true })]]))
    return {
      id: b64(this.credentialId), rawId: b64(this.credentialId), type: 'public-key',
      response: { clientDataJSON: b64(clientDataJSON), attestationObject: b64(attestationObject), transports: ['internal'] },
      clientExtensionResults: {}, authenticatorAttachment: 'platform',
    }
  }

  signIn(options, { origin = ORIGIN, flags = 0x05 } = {}) {
    this.counter += 1
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin, crossOrigin: false }))
    const authenticatorData = this.authData({ flags })
    const signature = sign('sha256', Buffer.concat([authenticatorData, sha256(clientDataJSON)]), this.privateKey)
    return {
      id: b64(this.credentialId), rawId: b64(this.credentialId), type: 'public-key',
      response: { clientDataJSON: b64(clientDataJSON), authenticatorData: b64(authenticatorData), signature: b64(signature), userHandle: this.userHandle },
      clientExtensionResults: {}, authenticatorAttachment: 'platform',
    }
  }
}

const PASSWORD = 'correct horse battery'

async function addPasskey(client, device = new VirtualAuthenticator()) {
  const opts = await client.post('/api/auth/passkeys/register/options', { password: PASSWORD })
  expect(opts.status).toBe(200)
  const r = await client.post('/api/auth/passkeys/register/verify', { challengeId: opts.data.challengeId, response: device.register(opts.data.options) })
  expect(r.status).toBe(201)
  return { device, passkey: r.data }
}

async function passkeySignIn(device, opts = {}) {
  const c = new Client(globalThis.__passkeyBase)
  const o = await c.post('/api/auth/passkeys/signin/options')
  const r = await c.post('/api/auth/passkeys/signin/verify', { challengeId: o.data.challengeId, response: device.signIn(o.data.options, opts) })
  return { c, r, challengeId: o.data.challengeId }
}

describe('deviceLabel', () => {
  it('names common devices', () => {
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toBe('iPhone · Safari')
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36')).toBe('Android · Chrome')
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0')).toBe('Windows · Edge')
    expect(deviceLabel('')).toBe('')
  })
})

describe.skipIf(skipIntegration())('passkeys (fingerprint sign-in)', () => {
  let base
  beforeAll(async () => {
    base = await startApp()
    globalThis.__passkeyBase = base
    const { resetRateLimits } = await import('../lib/rateLimit.mjs')
    resetRateLimits()
  })
  afterAll(stopApp)

  it('requires the current password to add a passkey', async () => {
    const c = await newOwner(base)
    const r = await c.post('/api/auth/passkeys/register/options', { password: 'not my password' })
    expect(r.status).toBe(400)
    expect(r.data.error.code).toBe('invalid_current_password')
    expect((await new Client(base).post('/api/auth/passkeys/register/options', { password: PASSWORD })).status).toBe(401)
  })

  it('registers a passkey and signs in with it, without email or password', async () => {
    const owner = await newOwner(base)
    const { device, passkey } = await addPasskey(owner)
    expect(passkey).toMatchObject({ synced: false, lastUsedAt: null })
    expect(passkey).not.toHaveProperty('public_key')
    const list = await owner.get('/api/auth/passkeys')
    expect(list.data.passkeys).toHaveLength(1)

    const { c, r } = await passkeySignIn(device)
    expect(r.status).toBe(200)
    expect(r.data.user.id).toBe(owner.me.user.id)
    expect((await c.get('/api/auth/me')).data.user.email).toBe(owner.email)
    expect((await owner.get('/api/auth/passkeys')).data.passkeys[0].lastUsedAt).not.toBeNull()
  })

  it('uses each challenge once and rejects other origins and missing user verification', async () => {
    const owner = await newOwner(base)
    const { device } = await addPasskey(owner)
    const { c, r, challengeId } = await passkeySignIn(device)
    expect(r.status).toBe(200)
    // Replaying the same challenge fails even with a fresh signature.
    const replay = await c.post('/api/auth/passkeys/signin/verify', { challengeId, response: device.signIn({ challenge: 'x' }) })
    expect(replay.status).toBe(401)

    const phishing = await passkeySignIn(device, { origin: 'https://evil.example' })
    expect(phishing.r.status).toBe(401)
    expect(phishing.r.data.error.code).toBe('passkey_failed')
    const noUv = await passkeySignIn(device, { flags: 0x01 })
    expect(noUv.r.status).toBe(401)
  })

  it('explains a failed registration and accepts browser-side error reports', async () => {
    const owner = await newOwner(base)
    const opts = await owner.post('/api/auth/passkeys/register/options', { password: PASSWORD })
    const bad = await owner.post('/api/auth/passkeys/register/verify', { challengeId: opts.data.challengeId, response: new VirtualAuthenticator().register(opts.data.options, { origin: 'https://evil.example' }) })
    expect(bad.status).toBe(400)
    expect(bad.data.error.code).toBe('passkey_failed')
    expect(bad.data.error.details.reason).toMatch(/origin/i)
    const report = await owner.post('/api/auth/passkeys/client-error', { stage: 'register', detail: 'ERROR_AUTHENTICATOR_GENERAL_ERROR (UnknownError: x)' })
    expect(report.status).toBe(200)
  })

  it('rejects a cloned authenticator (signature counter went backwards)', async () => {
    const owner = await newOwner(base)
    const { device } = await addPasskey(owner)
    expect((await passkeySignIn(device)).r.status).toBe(200)
    expect((await passkeySignIn(device)).r.status).toBe(200)
    device.counter = 0
    expect((await passkeySignIn(device)).r.status).toBe(401)
  })

  it('stops working once removed, and only the owner can remove it', async () => {
    const owner = await newOwner(base)
    const { device, passkey } = await addPasskey(owner)
    const other = await newOwner(base)
    await other.request('DELETE', `/api/auth/passkeys/${passkey.id}`)
    expect((await owner.get('/api/auth/passkeys')).data.passkeys).toHaveLength(1)

    expect((await owner.request('DELETE', `/api/auth/passkeys/${passkey.id}`)).status).toBe(200)
    const { r } = await passkeySignIn(device)
    expect(r.status).toBe(401)
    expect(r.data.error.code).toBe('passkey_unknown')
  })

  it('refuses sign-in for a removed team member', async () => {
    const owner = await newOwner(base)
    const { device } = await addPasskey(owner)
    const { query } = await import('../db/pool.mjs')
    const { invalidateUserCache } = await import('../middleware/auth.mjs')
    await query('UPDATE profiles SET is_active = false WHERE id = $1', [owner.me.user.id])
    invalidateUserCache(owner.me.user.id)
    expect((await passkeySignIn(device)).r.status).toBe(401)
  })
})
