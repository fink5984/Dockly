/**
 * Web push: settings, device registration and delivery. The real push
 * service call is replaced by a recorder, so nothing leaves the process.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { startApp, stopApp, newOwner, samplePdf, documentTypeId, skipIntegration, Client } from './helpers.mjs'
import { setPushSender } from '../messaging/push.mjs'
import { isPushServiceUrl } from '../routes/push.mjs'

const keys = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' }
const fcm = (id) => `https://fcm.googleapis.com/fcm/send/${id}`

let sent = []
const waitForSends = async (n, ms = 3000) => {
  const end = Date.now() + ms
  while (sent.length < n && Date.now() < end) await new Promise((r) => setTimeout(r, 25))
  return sent
}

describe('push service url allowlist', () => {
  it('accepts browser push services only', () => {
    expect(isPushServiceUrl('https://fcm.googleapis.com/fcm/send/abc')).toBe(true)
    expect(isPushServiceUrl('https://updates.push.services.mozilla.com/wpush/v2/abc')).toBe(true)
    expect(isPushServiceUrl('https://web.push.apple.com/abc')).toBe(true)
    expect(isPushServiceUrl('https://wns2-par02p.notify.windows.com/w/?token=abc')).toBe(true)
    expect(isPushServiceUrl('http://fcm.googleapis.com/fcm/send/abc')).toBe(false)
    expect(isPushServiceUrl('https://127.0.0.1/x')).toBe(false)
    expect(isPushServiceUrl('https://169.254.169.254/latest')).toBe(false)
    expect(isPushServiceUrl('https://fcm.googleapis.com.evil.test/x')).toBe(false)
    expect(isPushServiceUrl('https://evilfcm.googleapis.com.test/x')).toBe(false)
    expect(isPushServiceUrl('https://fcm.googleapis.com:8443/x')).toBe(false)
    expect(isPushServiceUrl('not a url')).toBe(false)
  })
})

describe.skipIf(skipIntegration())('push notifications', () => {
  let base, owner
  beforeAll(async () => {
    base = await startApp()
    owner = await newOwner(base, { name: 'Dana Owner' })
  })
  afterAll(() => { setPushSender(undefined); return stopApp() })
  beforeEach(() => {
    sent = []
    setPushSender(async (sub, payload) => { sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) }) })
  })

  it('reports status and defaults to every event', async () => {
    const r = await owner.get('/api/push')
    expect(r.status).toBe(200)
    expect(r.data.configured).toBe(true)
    expect(r.data.publicKey).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(r.data.events).toEqual(['document_uploaded', 'request_completed', 'signature_signed', 'signature_declined', 'support_message', 'billing'])
    expect(r.data.devices).toBe(0)
  })

  it('requires sign-in', async () => {
    expect((await new Client(base).get('/api/push')).status).toBe(401)
  })

  it('validates preferences', async () => {
    expect((await owner.put('/api/push/preferences', { events: ['nope'] })).status).toBe(400)
    const r = await owner.put('/api/push/preferences', { events: ['signature_signed', 'document_uploaded'] })
    expect(r.data.events).toEqual(['document_uploaded', 'signature_signed'])
  })

  it('only registers real push service endpoints', async () => {
    expect((await owner.post('/api/push/subscriptions', { endpoint: 'https://127.0.0.1/hook', keys })).status).toBe(400)
    expect((await owner.post('/api/push/subscriptions', { endpoint: fcm('x'), keys: { p256dh: 'short', auth: 'x' } })).status).toBe(400)
    expect((await owner.post('/api/push/subscriptions', { endpoint: fcm('owner-1'), keys, language: 'he' })).status).toBe(201)
    expect((await owner.get('/api/push')).data.devices).toBe(1)
  })

  it('pushes chosen events in the device language and skips the others', async () => {
    const dt = await documentTypeId(owner, 'Passport')
    const client = (await owner.post('/api/clients', { name: 'Noa Client', phone: '0501234567' })).data
    const request = (await owner.post('/api/requests', { clientId: client.id, title: 'Onboarding', items: [{ documentTypeId: dt }] })).data.request
    const anon = new Client(base)
    const portal = (await anon.get(`/api/public/portal/${request.publicToken}`)).data
    const up = await anon.upload(`/api/public/portal/${request.publicToken}/documents/${portal.documents[0].id}`, await samplePdf(1), 'passport.pdf', 'application/pdf')
    expect(up.status).toBeLessThan(300)

    // document_uploaded is enabled; request_completed was turned off above.
    await waitForSends(1)
    await new Promise((r) => setTimeout(r, 200))
    expect(sent).toHaveLength(1)
    expect(sent[0].endpoint).toBe(fcm('owner-1'))
    expect(sent[0].payload.title).toBe('Noa Client העלה/תה את Passport')
    expect(sent[0].payload.url).toBe(`/app/requests/${request.id}`)
  })

  it('sends a test push and drops subscriptions the browser revoked', async () => {
    const t = await owner.post('/api/push/test')
    expect(t.data.sent).toBe(1)
    expect(sent[0].payload.title).toBe('התראות פוש פעילות')

    setPushSender(async () => { throw Object.assign(new Error('gone'), { statusCode: 410 }) })
    expect((await owner.post('/api/push/test')).data.sent).toBe(0)
    expect((await owner.get('/api/push')).data.devices).toBe(0)
  })

  it('moves a device to whoever subscribed last and never removes someone else\'s', async () => {
    const other = await newOwner(base, { name: 'Other' })
    await owner.post('/api/push/subscriptions', { endpoint: fcm('shared'), keys })
    await other.post('/api/push/subscriptions', { endpoint: fcm('shared'), keys })
    expect((await owner.get('/api/push')).data.devices).toBe(0)
    expect((await other.get('/api/push')).data.devices).toBe(1)
    await owner.post('/api/push/subscriptions/remove', { endpoint: fcm('shared') })
    expect((await other.get('/api/push')).data.devices).toBe(1)
  })

  it('signing out everywhere stops pushes to every device', async () => {
    await owner.post('/api/push/subscriptions', { endpoint: fcm('owner-2'), keys })
    expect((await owner.get('/api/push')).data.devices).toBe(1)
    const ownerId = owner.me.user.id
    await owner.post('/api/auth/signout-all')
    const { query } = await import('../db/pool.mjs')
    expect(await query('SELECT 1 FROM push_subscriptions WHERE user_id = $1', [ownerId])).toHaveLength(0)
  })
})
