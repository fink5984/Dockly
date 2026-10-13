import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startApp, stopApp, newOwner, samplePdf, tinyPng, documentTypeId, skipIntegration, Client } from './helpers.mjs'

describe.skipIf(skipIntegration())('document request workflow', () => {
  let base, owner, idType, payType, request, portal, anon
  beforeAll(async () => {
    base = await startApp()
    owner = await newOwner(base)
    idType = await documentTypeId(owner, 'ID card', ['pdf', 'jpg', 'png'])
    payType = await documentTypeId(owner, 'Payslip', ['pdf'])
    anon = new Client(base)
  })
  afterAll(stopApp)

  it('creates a request with a new client in one step', async () => {
    const r = await owner.post('/api/requests', {
      newClient: { name: 'דנה לוי', phone: '050-765-4321', email: 'dana@example.test' },
      title: 'Mortgage application',
      instructions: 'Please upload clear scans.',
      deadline: '2099-01-31',
      items: [{ documentTypeId: idType, required: true, note: 'Both sides' }, { documentTypeId: payType, required: true }],
    })
    expect(r.status).toBe(201)
    request = r.data.request
    expect(request.status).toBe('new')
    expect(request.clientName).toBe('דנה לוי')
    expect(request.requiredDocuments).toHaveLength(2)
    expect(request.publicToken.length).toBeGreaterThanOrEqual(40)
  })

  it('validates input', async () => {
    const r = await owner.post('/api/requests', { title: '', items: [] })
    expect(r.status).toBe(400)
    expect(r.data.error.code).toBe('validation_failed')
  })

  it('serves the public portal without internal data', async () => {
    const r = await anon.get(`/api/public/portal/${request.publicToken}`)
    expect(r.status).toBe(200)
    portal = r.data
    expect(portal.request.title).toBe('Mortgage application')
    expect(portal.request.instructions).toBe('Please upload clear scans.')
    expect(portal.documents[0].clientNote).toBe('Both sides')
    const blob = JSON.stringify(portal)
    expect(blob).not.toContain('storage')
    expect(blob).not.toContain(owner.me.workspace.id)
    expect(blob).not.toContain('workspace_id')
  })

  it('rejects unknown tokens uniformly', async () => {
    expect((await anon.get('/api/public/portal/not-a-real-token-but-long-enough')).status).toBe(404)
    expect((await anon.get('/api/public/portal/short')).status).toBe(404)
  })

  it('rejects disguised and disallowed files without storing anything', async () => {
    const pay = portal.documents.find((d) => d.name === 'Payslip')
    const exe = Buffer.from('MZ\x90\x00 executable pretending to be a pdf')
    const r1 = await anon.upload(`/api/public/portal/${request.publicToken}/documents/${pay.id}`, exe, 'payslip.pdf', 'application/pdf')
    expect(r1.status).toBe(415)
    const r2 = await anon.upload(`/api/public/portal/${request.publicToken}/documents/${pay.id}`, tinyPng, 'payslip.png', 'image/png')
    expect(r2.status).toBe(415)
    expect(r2.data.error.code).toBe('file_type_not_allowed')
    const versions = await owner.get(`/api/requests/${request.id}/documents/${pay.id}/versions`)
    expect(versions.data).toHaveLength(0)
  })

  it('accepts a valid upload from the portal and confirms only after storing', async () => {
    const idDoc = portal.documents.find((d) => d.name === 'ID card')
    const r = await anon.upload(`/api/public/portal/${request.publicToken}/documents/${idDoc.id}`, tinyPng, 'תעודת זהות.png', 'image/png')
    expect(r.status).toBe(201)
    expect(r.data.document.status).toBe('uploaded')
    expect(r.data.document.fileName).toBe('תעודת זהות.png')
    const full = (await owner.get(`/api/requests/${request.id}`)).data
    expect(full.status).toBe('partial-submission')
    expect(full.progress.awaitingReview).toBe(1)
    const file = await owner.get(`/api/requests/${request.id}/documents/${idDoc.id}/file`)
    expect(file.status).toBe(200)
    const content = await fetch(base + file.data.url)
    expect(Buffer.from(await content.arrayBuffer()).equals(tinyPng)).toBe(true)
  })

  it('cannot upload into a document from another request through a valid token', async () => {
    const other = (await owner.post('/api/requests', { newClient: { name: 'Other' }, title: 'Other', items: [{ documentTypeId: idType }] })).data.request
    const r = await anon.upload(`/api/public/portal/${request.publicToken}/documents/${other.requiredDocuments[0].id}`, tinyPng, 'x.png', 'image/png')
    expect(r.status).toBe(404)
  })

  it('completes when every required document is received', async () => {
    const pay = portal.documents.find((d) => d.name === 'Payslip')
    const r = await anon.upload(`/api/public/portal/${request.publicToken}/documents/${pay.id}`, await samplePdf(1), 'payslip.pdf', 'application/pdf')
    expect(r.status).toBe(201)
    expect(r.data.requestStatus).toBe('completed')
  })

  it('reviews: reject requires a reason, which the client then sees', async () => {
    const pay = request.requiredDocuments.find((d) => d.name === 'Payslip')
    const noReason = await owner.post(`/api/requests/${request.id}/documents/${pay.id}/review`, { action: 'reject' })
    expect(noReason.status).toBe(400)
    const rej = await owner.post(`/api/requests/${request.id}/documents/${pay.id}/review`, { action: 'reject', reason: 'The last page is missing', channel: 'whatsapp' })
    expect(rej.status).toBe(200)
    expect(rej.data.request.status).toBe('partial-submission')
    expect(rej.data.notify.ok).toBe(true)
    const p = (await anon.get(`/api/public/portal/${request.publicToken}`)).data
    const doc = p.documents.find((d) => d.name === 'Payslip')
    expect(doc.status).toBe('rejected')
    expect(doc.rejectionReason).toBe('The last page is missing')
    expect(doc.canUpload).toBe(true)
  })

  it('keeps every version when the client uploads a replacement', async () => {
    const pay = request.requiredDocuments.find((d) => d.name === 'Payslip')
    await anon.upload(`/api/public/portal/${request.publicToken}/documents/${pay.id}`, await samplePdf(2), 'payslip-full.pdf', 'application/pdf')
    const versions = (await owner.get(`/api/requests/${request.id}/documents/${pay.id}/versions`)).data
    expect(versions).toHaveLength(2)
    expect(versions[0].isCurrent).toBe(true)
    expect(versions[1].reviewStatus).toBe('rejected')
    expect(versions[0].sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('approves, and approved documents cannot be replaced from the portal', async () => {
    const id = request.requiredDocuments.find((d) => d.name === 'ID card')
    const ok = await owner.post(`/api/requests/${request.id}/documents/${id.id}/review`, { action: 'approve' })
    expect(ok.status).toBe(200)
    const again = await owner.post(`/api/requests/${request.id}/documents/${id.id}/review`, { action: 'approve' })
    expect(again.status).toBe(409)
    const r = await anon.upload(`/api/public/portal/${request.publicToken}/documents/${id.id}`, tinyPng, 'new.png', 'image/png')
    expect(r.status).toBe(409)
  })

  it('downloads every current file as a zip', async () => {
    const res = await owner.request('GET', `/api/requests/${request.id}/download-all`, { raw: true })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/zip')
    const buf = Buffer.from(await res.arrayBuffer())
    expect(buf.readUInt32LE(0)).toBe(0x04034b50)
  })

  it('regenerating the link revokes the old one; disabling returns 410', async () => {
    const old = request.publicToken
    const r = await owner.post(`/api/requests/${request.id}/portal-link`, { action: 'regenerate' })
    expect(r.data.publicToken).not.toBe(old)
    expect((await anon.get(`/api/public/portal/${old}`)).status).toBe(404)
    await owner.post(`/api/requests/${request.id}/portal-link`, { action: 'disable' })
    expect((await anon.get(`/api/public/portal/${r.data.publicToken}`)).status).toBe(410)
    await owner.post(`/api/requests/${request.id}/portal-link`, { action: 'enable' })
    expect((await anon.get(`/api/public/portal/${r.data.publicToken}`)).status).toBe(200)
  })

  it('sends via WhatsApp (simulated in tests) and records the delivery', async () => {
    const r = await owner.post(`/api/requests/${request.id}/send`, { channel: 'whatsapp', kind: 'reminder' })
    expect(r.status).toBe(200)
    expect(r.data.simulated).toBe(true)
    const comms = (await owner.get(`/api/requests/${request.id}/communications`)).data
    expect(comms.deliveries.some((d) => d.kind === 'request_reminder' && d.status === 'skipped')).toBe(true)
  })

  it('reports a clear error when the client has no valid phone', async () => {
    const r0 = (await owner.post('/api/requests', { newClient: { name: 'No Phone' }, title: 'x', items: [{ documentTypeId: idType }] })).data.request
    const r = await owner.post(`/api/requests/${r0.id}/send`, { channel: 'whatsapp', kind: 'initial' })
    expect(r.status).toBe(400)
    expect(r.data.error.code).toBe('invalid_phone')
  })

  it('reports email as not configured instead of pretending', async () => {
    const r = await owner.post(`/api/requests/${request.id}/send`, { channel: 'email', kind: 'reminder' })
    expect(r.status).toBe(400)
    expect(r.data.error.code).toBe('email_not_configured')
  })

  it('logs a trustworthy activity trail', async () => {
    const acts = (await owner.get(`/api/activity?caseId=${request.id}`)).data
    const types = acts.map((a) => a.type)
    for (const t of ['request_created', 'document_uploaded', 'document_rejected', 'document_approved', 'request_completed']) {
      expect(types).toContain(t)
    }
    expect(acts.find((a) => a.type === 'document_uploaded').actorType).toBe('client')
  })

  it('duplicates a request and saves it as a template', async () => {
    const dup = await owner.post(`/api/requests/${request.id}/duplicate`, {})
    expect(dup.status).toBe(201)
    expect(dup.data.requiredDocuments.every((d) => d.status === 'missing')).toBe(true)
    const t = await owner.post(`/api/requests/${request.id}/save-as-template`, { name: 'Mortgage pack' })
    expect(t.status).toBe(201)
    expect(t.data.items).toHaveLength(2)
  })

  it('installs a starter template', async () => {
    const r = await owner.post('/api/request-templates/starters/tax', { language: 'he' })
    expect(r.status).toBe(201)
    expect(r.data.items.length).toBeGreaterThan(2)
    expect((await owner.post('/api/request-templates/starters/tax', { language: 'he' })).status).toBe(409)
  })

  it('dashboard reflects real data', async () => {
    const d = (await owner.get('/api/dashboard')).data
    expect(d.kpis.activeRequests).toBeGreaterThan(0)
    expect(d.actions.some((a) => a.kind === 'review')).toBe(true)
    expect(d.trend).toHaveLength(8)
    expect(d.onboarding.hasRequest).toBe(true)
  })
})
