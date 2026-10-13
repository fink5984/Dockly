import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startApp, stopApp, Client, newOwner, skipIntegration } from './helpers.mjs'

describe.skipIf(skipIntegration())('authentication & sessions', () => {
  let base
  beforeAll(async () => { base = await startApp() })
  afterAll(stopApp)

  it('signs up, reads /me, signs out', async () => {
    const c = await newOwner(base)
    const me = await c.get('/api/auth/me')
    expect(me.data.user.role).toBe('owner')
    expect(me.data.user).not.toHaveProperty('password')
    await c.post('/api/auth/signout')
    expect((await c.get('/api/auth/me')).data.user).toBeNull()
  })

  it('never exposes password data and normalizes email case', async () => {
    const c = await newOwner(base)
    const fresh = new Client(base)
    const r = await fresh.post('/api/auth/signin', { email: c.email.toUpperCase(), password: 'correct horse battery' })
    expect(r.status).toBe(200)
    expect(JSON.stringify(r.data)).not.toMatch(/scrypt|password_hash/)
  })

  it('rejects bad credentials with a generic message', async () => {
    const c = await newOwner(base)
    const r = await new Client(base).post('/api/auth/signin', { email: c.email, password: 'wrong password!' })
    expect(r.status).toBe(401)
    expect(r.data.error.code).toBe('invalid_credentials')
    const r2 = await new Client(base).post('/api/auth/signin', { email: 'nobody@example.test', password: 'whatever123' })
    expect(r2.data.error.code).toBe('invalid_credentials')
  })

  it('locks an account after repeated failures', async () => {
    const c = await newOwner(base)
    const { resetRateLimits } = await import('../lib/rateLimit.mjs')
    for (let i = 0; i < 8; i++) {
      resetRateLimits()
      await new Client(base).post('/api/auth/signin', { email: c.email, password: `wrong-${i}-attempt` })
    }
    resetRateLimits()
    const r = await new Client(base).post('/api/auth/signin', { email: c.email, password: 'correct horse battery' })
    expect(r.status).toBe(429)
    expect(r.data.error.code).toBe('account_locked')
  })

  it('migrates a legacy plaintext password to a hash on first login', async () => {
    const { query, queryOne } = await import('../db/pool.mjs')
    const ws = await queryOne(`INSERT INTO workspaces (name) VALUES ('Legacy') RETURNING id`)
    const email = `legacy_${Date.now()}@example.test`
    await query(`INSERT INTO profiles (workspace_id, email, name, role, password) VALUES ($1,$2,'Legacy','owner','old-plain-pass')`, [ws.id, email])
    const c = new Client(base)
    expect((await c.post('/api/auth/signin', { email, password: 'old-plain-pass' })).status).toBe(200)
    const row = await queryOne('SELECT password, password_hash FROM profiles WHERE email = $1', [email])
    expect(row.password).toBe('')
    expect(row.password_hash).toMatch(/^scrypt\$/)
    // still works with the hash
    expect((await new Client(base).post('/api/auth/signin', { email, password: 'old-plain-pass' })).status).toBe(200)
  })

  it('rejects forged and tampered session cookies', async () => {
    const c = await newOwner(base)
    const forged = new Client(base)
    forged.cookie = c.cookie.replace(/.$/, (ch) => (ch === 'A' ? 'B' : 'A'))
    expect((await forged.get('/api/clients')).status).toBe(401)
    // A raw profile UUID (the old "session") is no longer a credential.
    const old = new Client(base)
    old.cookie = `dockly_session=${c.me.user.id}`
    expect((await old.get('/api/clients')).status).toBe(401)
  })

  it('requires the CSRF header on cookie-authenticated writes', async () => {
    const c = await newOwner(base)
    const r = await c.request('POST', '/api/clients', { json: { name: 'X' }, csrf: false })
    expect(r.status).toBe(403)
    expect(r.data.error.code).toBe('csrf_failed')
    const cross = await c.request('POST', '/api/clients', { json: { name: 'X' }, headers: { origin: 'https://evil.example' } })
    expect(cross.status).toBe(403)
  })

  it('revokes other sessions on password change', async () => {
    const c = await newOwner(base)
    const other = new Client(base)
    await other.post('/api/auth/signin', { email: c.email, password: 'correct horse battery' })
    expect((await other.get('/api/clients')).status).toBe(200)
    const r = await c.post('/api/auth/change-password', { currentPassword: 'correct horse battery', newPassword: 'an even better passphrase' })
    expect(r.status).toBe(200)
    expect((await other.get('/api/clients')).status).toBe(401)
    expect((await c.get('/api/clients')).status).toBe(200)
  })

  it('removed legacy endpoints no longer exist', async () => {
    const anon = new Client(base)
    expect((await anon.post('/api/storage/delete-folder', { prefix: 'a' })).status).toBe(404)
    expect((await anon.get('/api/storage/download?key=x')).status).toBe(404)
    expect((await anon.post('/api/whatsapp/send', { phoneNumber: '1' })).status).toBe(401)
  })

  it('sets security headers', async () => {
    const res = await fetch(base + '/api/health')
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('referrer-policy')).toBe('same-origin')
  })
})

describe.skipIf(skipIntegration())('team roles & invites', () => {
  let base
  beforeAll(async () => { base = await startApp() })
  afterAll(stopApp)

  it('invites a viewer who can read but not write', async () => {
    const owner = await newOwner(base)
    const inv = await owner.post('/api/team/invites', { email: `viewer_${Date.now()}@example.test`, name: 'Vee', role: 'viewer' })
    expect(inv.status).toBe(201)
    const token = inv.data.link.split('/').pop()
    const viewer = new Client(base)
    expect((await viewer.get(`/api/auth/invite/${token}`)).data.role).toBe('viewer')
    expect((await viewer.post(`/api/auth/invite/${token}/accept`, { name: 'Vee', password: 'viewer passphrase 1' })).status).toBe(201)
    expect((await viewer.get('/api/clients')).status).toBe(200)
    expect((await viewer.post('/api/clients', { name: 'Nope' })).status).toBe(403)
    // invite can't be reused
    expect((await new Client(base).post(`/api/auth/invite/${token}/accept`, { name: 'X', password: 'another passphrase' })).status).toBe(410)
  })

  it('members cannot delete or change settings; the last owner cannot be demoted', async () => {
    const owner = await newOwner(base)
    const inv = await owner.post('/api/team/invites', { email: `member_${Date.now()}@example.test`, role: 'member' })
    const member = new Client(base)
    await member.post(`/api/auth/invite/${inv.data.link.split('/').pop()}/accept`, { name: 'Mem', password: 'member passphrase 1' })
    const client = await member.post('/api/clients', { name: 'Client M' })
    expect(client.status).toBe(201)
    expect((await member.del(`/api/clients/${client.data.id}`)).status).toBe(403)
    expect((await member.patch('/api/workspace', { name: 'Hijacked' })).status).toBe(403)
    const demote = await owner.patch(`/api/team/members/${owner.me.user.id}`, { role: 'admin' })
    expect(demote.status).toBe(409)
  })

  it('removed members lose access immediately', async () => {
    const owner = await newOwner(base)
    const inv = await owner.post('/api/team/invites', { email: `gone_${Date.now()}@example.test`, role: 'member' })
    const m = new Client(base)
    const acc = await m.post(`/api/auth/invite/${inv.data.link.split('/').pop()}/accept`, { name: 'Gone', password: 'member passphrase 2' })
    expect((await owner.del(`/api/team/members/${acc.data.user.id}`)).status).toBe(200)
    expect((await m.get('/api/clients')).status).toBe(401)
  })
})
