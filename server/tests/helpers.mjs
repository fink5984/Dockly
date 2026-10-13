/**
 * Test helpers: boot the app on a random port and a tiny cookie-aware client.
 * Fixtures are generated in code — never real client documents.
 */
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { createHmac } from 'crypto'

export const skipIntegration = () => process.env.DOCKLY_IT_SKIP === '1'

let server
let baseUrl

export async function startApp() {
  if (server) return baseUrl
  const { createApp } = await import('../app.mjs')
  const app = createApp()
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve) })
  baseUrl = `http://127.0.0.1:${server.address().port}`
  return baseUrl
}

// The DB pool stays open for the whole file (several describe blocks share it);
// globalSetup terminates connections before dropping the test database.
export async function stopApp() {
  if (server) await new Promise((r) => server.close(r))
  server = null
}

/** Minimal HTTP client that keeps cookies and sends the CSRF header. */
export class Client {
  constructor(base) {
    this.base = base
    this.cookie = ''
  }

  async request(method, path, { json, form, headers = {}, raw = false, csrf = true } = {}) {
    const h = { ...headers }
    if (this.cookie) h.cookie = this.cookie
    if (csrf && method !== 'GET') h['x-requested-with'] = 'dockly'
    let body
    if (json !== undefined) { h['content-type'] = 'application/json'; body = JSON.stringify(json) }
    if (form) body = form
    const res = await fetch(this.base + path, { method, headers: h, body, redirect: 'manual' })
    const set = res.headers.getSetCookie?.() || []
    for (const c of set) {
      const [pair] = c.split(';')
      const [name, value] = pair.split('=')
      if (name === 'dockly_session') this.cookie = value ? `dockly_session=${value}` : ''
    }
    if (raw) return res
    const text = await res.text()
    let data
    try { data = text ? JSON.parse(text) : null } catch { data = text }
    return { status: res.status, data, headers: res.headers }
  }

  get(p, o) { return this.request('GET', p, o) }
  post(p, json, o = {}) { return this.request('POST', p, { ...o, json }) }
  patch(p, json, o = {}) { return this.request('PATCH', p, { ...o, json }) }
  put(p, json, o = {}) { return this.request('PUT', p, { ...o, json }) }
  del(p, o) { return this.request('DELETE', p, o) }

  upload(path, buffer, fileName, type = 'application/octet-stream') {
    const fd = new FormData()
    fd.append('file', new Blob([buffer], { type }), fileName)
    return this.request('POST', path, { form: fd })
  }
}

let counter = 0
/** Create a workspace owner account and return a signed-in client. */
export async function newOwner(base, { name = 'Owner', workspace = 'Test Office' } = {}) {
  // Signup is rate limited per IP; tests create many accounts from one IP.
  const { resetRateLimits } = await import('../lib/rateLimit.mjs')
  resetRateLimits()
  const c = new Client(base)
  counter++
  const email = `owner${counter}_${Date.now()}@example.test`
  const r = await c.post('/api/auth/signup', { email, password: 'correct horse battery', name, language: 'en' })
  if (r.status !== 201) throw new Error(`signup failed: ${JSON.stringify(r.data)}`)
  await c.patch('/api/workspace', { name: workspace })
  c.email = email
  c.me = r.data
  return c
}

export async function samplePdf(pages = 2, text = 'Sample agreement') {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < pages; i++) {
    const p = pdf.addPage([595.28, 841.89])
    p.drawText(`${text} — page ${i + 1}`, { x: 50, y: 780, size: 14, font })
  }
  return Buffer.from(await pdf.save())
}

/** 1x1 transparent PNG. */
export const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')
export const tinyPngDataUrl = `data:image/png;base64,${tinyPng.toString('base64')}`

export function signWebhook(body, secret = process.env.WHATSAPP_APP_SECRET) {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
}

export async function documentTypeId(client, name = 'ID card', allowedFormats = ['pdf', 'jpg', 'png']) {
  const r = await client.post('/api/document-types', { name, allowedFormats, maxSizeMB: 5 })
  if (r.status !== 201) throw new Error(JSON.stringify(r.data))
  return r.data.id
}
