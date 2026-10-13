import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createHash } from 'crypto'
import { startApp, stopApp, newOwner, samplePdf, tinyPng, tinyPngDataUrl, skipIntegration, Client } from './helpers.mjs'

async function pdfText(buffer) {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false }).promise
  let text = ''
  for (let i = 1; i <= pdf.numPages; i++) {
    const tc = await (await pdf.getPage(i)).getTextContent()
    text += tc.items.map((x) => x.str).join(' ') + '\n'
  }
  // pdf.js inserts spacing between separately drawn runs; compare normalized text.
  return { text: text.replace(/\s+/g, ' '), pages: pdf.numPages }
}

describe.skipIf(skipIntegration())('electronic signatures', () => {
  let base, owner, client, request, anon
  beforeAll(async () => {
    base = await startApp()
    owner = await newOwner(base)
    anon = new Client(base)
    client = (await owner.post('/api/clients', { name: 'Yossi Cohen', email: 'yossi@example.test' })).data
  })
  afterAll(stopApp)

  it('creates a request from an uploaded PDF and records the original hash', async () => {
    const pdf = await samplePdf(2, 'Engagement letter')
    const up = await owner.upload('/api/signatures/uploads', pdf, 'engagement.pdf', 'application/pdf')
    expect(up.status).toBe(201)
    expect(up.data.pages).toBe(2)
    const r = await owner.post('/api/signatures', {
      clientId: client.id, title: 'Engagement letter', document: up.data, canvasWidth: 750, language: 'he',
      fields: [
        { type: 'signature', label: 'Signature', page: 2, x: 400, y: 900, width: 200, height: 60, required: true },
        { type: 'name', label: 'Name', page: 2, x: 60, y: 900, width: 250, height: 30, required: true },
        { type: 'date', label: 'Date', page: 1, x: 60, y: 200, width: 150, height: 30, required: true },
        { type: 'text', label: 'Notes', page: 1, x: 60, y: 260, width: 300, height: 30, required: false },
        { type: 'checkbox', label: 'Agree', page: 1, x: 60, y: 320, width: 24, height: 24, required: true },
      ],
    })
    expect(r.status).toBe(201)
    request = r.data.request
    expect(request.status).toBe('pending')
    expect(request.originalSha256).toBe(createHash('sha256').update(pdf).digest('hex'))
  })

  it('wraps uploaded images into a PDF', async () => {
    const up = await owner.upload('/api/signatures/uploads', tinyPng, 'scan.png', 'image/png')
    expect(up.status).toBe(201)
    expect(up.data.fileType).toBe('application/pdf')
    expect(up.data.fileName).toBe('scan.pdf')
  })

  it('exposes the signer view without internal fields', async () => {
    const v = await anon.get(`/api/public/sign/${request.publicToken}`)
    expect(v.status).toBe(200)
    expect(v.data.fields).toHaveLength(5)
    expect(v.data.consentText.he).toBeTruthy()
    const blob = JSON.stringify(v.data)
    expect(blob).not.toContain('storage')
    expect(blob).not.toContain('ws/')
    const f = await anon.get(`/api/public/sign/${request.publicToken}/file`)
    expect(f.status).toBe(200)
  })

  it('records the first view only once', async () => {
    await anon.post(`/api/public/sign/${request.publicToken}/view`, {})
    await anon.post(`/api/public/sign/${request.publicToken}/view`, {})
    const ev = (await owner.get(`/api/signatures/${request.id}/events`)).data
    expect(ev.events.filter((e) => e.event === 'viewed')).toHaveLength(1)
  })

  it('refuses incomplete submissions, missing consent and foreign fields', async () => {
    const f = Object.fromEntries((await anon.get(`/api/public/sign/${request.publicToken}`)).data.fields.map((x) => [x.type, x.id]))
    const noConsent = await anon.post(`/api/public/sign/${request.publicToken}/submit`, { signerName: 'Yossi', consent: false, values: [] })
    expect(noConsent.data.error.code).toBe('consent_required')
    const missing = await anon.post(`/api/public/sign/${request.publicToken}/submit`, { signerName: 'Yossi', consent: true, values: [{ fieldId: f.name, value: 'x' }] })
    expect(missing.status).toBe(400)
    expect(missing.data.error.code).toBe('required_fields_missing')
    const foreign = await anon.post(`/api/public/sign/${request.publicToken}/submit`, { signerName: 'Yossi', consent: true, values: [{ fieldId: '00000000-0000-4000-8000-000000000000', value: 'x' }] })
    expect(foreign.data.error.code).toBe('unknown_field')
    const badSig = await anon.post(`/api/public/sign/${request.publicToken}/submit`, { signerName: 'Yossi', consent: true, values: [{ fieldId: f.signature, value: 'javascript:alert(1)' }] })
    expect(badSig.data.error.code).toBe('invalid_signature')
  })

  it('signs with Hebrew values and produces a verifiable signed PDF', async () => {
    const f = Object.fromEntries((await anon.get(`/api/public/sign/${request.publicToken}`)).data.fields.map((x) => [x.type, x.id]))
    const r = await anon.post(`/api/public/sign/${request.publicToken}/submit`, {
      signerName: 'יוסי כהן', consent: true, language: 'he',
      values: [
        { fieldId: f.signature, value: tinyPngDataUrl },
        { fieldId: f.name, value: 'יוסי כהן' },
        { fieldId: f.date, value: '2026-10-13' },
        { fieldId: f.text, value: 'ת.ז 123456789' },
        { fieldId: f.checkbox, value: 'true' },
      ],
    })
    expect(r.status).toBe(200)
    const s = (await owner.get(`/api/signatures/${request.id}`)).data
    expect(s.status).toBe('signed')
    expect(s.signerName).toBe('יוסי כהן')
    expect(s.signedSha256).toMatch(/^[0-9a-f]{64}$/)

    const file = await owner.get(`/api/signatures/${request.id}/file?variant=signed`)
    const bytes = Buffer.from(await (await fetch(base + file.data.url)).arrayBuffer())
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(s.signedSha256)
    const { text, pages } = await pdfText(bytes)
    expect(pages).toBe(2)
    expect(text).toContain('Engagement letter')
    // Hebrew is drawn in visual order; extraction yields the reversed glyph run.
    expect(text).toContain('ןהכ יסוי')
    expect(text).toContain('13/10/2026')
    expect(text).toContain(request.id)
  })

  it('keeps an intact hash-chained audit trail and blocks tampering', async () => {
    const ev = (await owner.get(`/api/signatures/${request.id}/events`)).data
    expect(ev.intact).toBe(true)
    expect(ev.events.map((e) => e.event)).toEqual(['created', 'viewed', 'consented', 'signed', 'completed_pdf'])
    const { query } = await import('../db/pool.mjs')
    await expect(query(`UPDATE signature_events SET actor = 'x' WHERE request_id = $1`, [request.id])).rejects.toThrow(/append-only/)
    await expect(query(`DELETE FROM signature_events WHERE request_id = $1`, [request.id])).rejects.toThrow(/append-only/)
  })

  it('produces a signing certificate', async () => {
    const res = await owner.request('GET', `/api/signatures/${request.id}/certificate?lang=en`, { raw: true })
    expect(res.status).toBe(200)
    const { text } = await pdfText(Buffer.from(await res.arrayBuffer()))
    expect(text).toContain('Signing certificate')
    expect(text).toContain('not a qualified or certified electronic signature')
    const he = await owner.request('GET', `/api/signatures/${request.id}/certificate?lang=he`, { raw: true })
    expect(he.status).toBe(200)
  })

  it('cannot be signed twice', async () => {
    const r = await anon.post(`/api/public/sign/${request.publicToken}/submit`, { signerName: 'Someone', consent: true, values: [] })
    expect(r.status).toBe(409)
  })

  it('supports declining, and expiry blocks signing', async () => {
    const up = await owner.upload('/api/signatures/uploads', await samplePdf(1), 'a.pdf', 'application/pdf')
    const mk = async (extra = {}) => (await owner.post('/api/signatures', {
      clientId: client.id, title: 'T', document: up.data, canvasWidth: 750, fields: [{ type: 'name', page: 1, x: 1, y: 1, width: 100, height: 20 }], ...extra,
    })).data.request
    const d = await mk()
    expect((await anon.post(`/api/public/sign/${d.publicToken}/decline`, { reason: 'Wrong amount' })).status).toBe(200)
    expect((await owner.get(`/api/signatures/${d.id}`)).data.declineReason).toBe('Wrong amount')
    const up2 = await owner.upload('/api/signatures/uploads', await samplePdf(1), 'b.pdf', 'application/pdf')
    const e = (await owner.post('/api/signatures', {
      clientId: client.id, title: 'E', document: up2.data, canvasWidth: 750, expiresAt: new Date(Date.now() + 60_000).toISOString(),
      fields: [{ type: 'name', page: 1, x: 1, y: 1, width: 100, height: 20 }],
    })).data.request
    const { query } = await import('../db/pool.mjs')
    await query(`UPDATE signature_requests SET expires_at = now() - interval '1 minute' WHERE id = $1`, [e.id])
    const f = (await anon.get(`/api/public/sign/${e.publicToken}`)).data
    expect(f.status).toBe('expired')
    const r = await anon.post(`/api/public/sign/${e.publicToken}/submit`, { signerName: 'X Y', consent: true, values: [{ fieldId: f.fields[0].id, value: 'X' }] })
    expect(r.status).toBe(410)
  })

  it('archives instead of deleting, preserving the audit trail', async () => {
    const r = await owner.del(`/api/signatures/${request.id}`)
    expect(r.status).toBe(200)
    expect((await owner.get(`/api/signatures/${request.id}`)).status).toBe(404)
    const { queryOne } = await import('../db/pool.mjs')
    expect((await queryOne('SELECT count(*)::int AS n FROM signature_events WHERE request_id = $1', [request.id])).n).toBeGreaterThan(3)
  })
})
