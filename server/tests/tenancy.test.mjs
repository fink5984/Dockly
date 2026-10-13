/**
 * Horizontal privilege escalation: workspace B must not be able to read,
 * modify, enumerate or download anything belonging to workspace A.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startApp, stopApp, newOwner, samplePdf, documentTypeId, skipIntegration, Client } from './helpers.mjs'

describe.skipIf(skipIntegration())('tenant isolation', () => {
  let base, a, b, aClient, aRequest, aDoc, aSig
  beforeAll(async () => {
    base = await startApp()
    a = await newOwner(base, { workspace: 'Office A' })
    b = await newOwner(base, { workspace: 'Office B' })
    const dt = await documentTypeId(a, 'Passport')
    aClient = (await a.post('/api/clients', { name: 'Secret Client', phone: '0501234567' })).data
    aRequest = (await a.post('/api/requests', { clientId: aClient.id, title: 'Confidential', items: [{ documentTypeId: dt }] })).data.request
    aDoc = aRequest.requiredDocuments[0]
    await a.upload(`/api/requests/${aRequest.id}/documents/${aDoc.id}/upload`, await samplePdf(1), 'passport.pdf', 'application/pdf')
    const up = await a.upload('/api/signatures/uploads', await samplePdf(1), 'nda.pdf', 'application/pdf')
    aSig = (await a.post('/api/signatures', {
      clientId: aClient.id, title: 'NDA', document: up.data, canvasWidth: 750,
      fields: [{ type: 'signature', page: 1, x: 50, y: 50, width: 200, height: 60 }],
    })).data.request
  })
  afterAll(stopApp)

  it('cannot read another workspace\'s records', async () => {
    expect((await b.get(`/api/clients/${aClient.id}`)).status).toBe(404)
    expect((await b.get(`/api/clients/${aClient.id}/overview`)).status).toBe(404)
    expect((await b.get(`/api/requests/${aRequest.id}`)).status).toBe(404)
    expect((await b.get(`/api/signatures/${aSig.id}`)).status).toBe(404)
    expect((await b.get(`/api/signatures/${aSig.id}/certificate`)).status).toBe(404)
    expect((await b.get(`/api/requests/${aRequest.id}/documents/${aDoc.id}/file`)).status).toBe(404)
    expect((await b.get(`/api/requests/${aRequest.id}/documents/${aDoc.id}/versions`)).status).toBe(404)
    expect((await b.get(`/api/requests/${aRequest.id}/download-all`)).status).toBe(404)
    expect((await b.get(`/api/signatures/${aSig.id}/file`)).status).toBe(404)
  })

  it('cannot modify another workspace\'s records', async () => {
    expect((await b.patch(`/api/clients/${aClient.id}`, { name: 'pwned' })).status).toBe(404)
    expect((await b.patch(`/api/requests/${aRequest.id}`, { title: 'pwned' })).status).toBe(404)
    expect((await b.post(`/api/requests/${aRequest.id}/documents/${aDoc.id}/review`, { action: 'approve' })).status).toBe(404)
    expect((await b.upload(`/api/requests/${aRequest.id}/documents/${aDoc.id}/upload`, await samplePdf(1), 'x.pdf')).status).toBe(404)
    expect((await b.post(`/api/requests/${aRequest.id}/portal-link`, { action: 'disable' })).status).toBe(404)
    expect((await b.post(`/api/signatures/${aSig.id}/cancel`)).status).toBe(404)
    expect((await b.del(`/api/requests/${aRequest.id}`)).status).toBe(404)
    // A still sees the original values
    expect((await a.get(`/api/requests/${aRequest.id}`)).data.title).toBe('Confidential')
  })

  it('cannot attach records from another workspace', async () => {
    const bType = await documentTypeId(b, 'B type')
    expect((await b.post('/api/requests', { clientId: aClient.id, title: 'x', items: [{ documentTypeId: bType }] })).status).toBe(404)
    const bClient = (await b.post('/api/clients', { name: 'B client' })).data
    const aType = aDoc.documentTypeId
    expect((await b.post('/api/requests', { clientId: bClient.id, title: 'x', items: [{ documentTypeId: aType }] })).status).toBe(400)
    // Signature with A's uploaded file key
    const aFull = await a.get(`/api/signatures/${aSig.id}`)
    expect(aFull.status).toBe(200)
    const forged = { key: `ws/${a.me.workspace.id}/signatures/uploads/x-nda.pdf`, fileName: 'nda.pdf', fileType: 'application/pdf', fileSize: 1 }
    expect((await b.post('/api/signatures', { clientId: bClient.id, title: 't', document: forged, canvasWidth: 750, fields: [{ type: 'signature', page: 1, x: 1, y: 1, width: 50, height: 20 }] })).status).toBe(400)
  })

  it('does not leak through lists, search, dashboard or the library', async () => {
    const lists = await Promise.all([
      b.get('/api/clients'), b.get('/api/requests?include=documents'), b.get('/api/signatures'),
      b.get('/api/search?q=Secret'), b.get('/api/search?q=Confidential'), b.get('/api/documents'),
      b.get('/api/activity'), b.get('/api/dashboard'),
    ])
    const blob = JSON.stringify(lists.map((l) => l.data))
    expect(blob).not.toContain('Secret Client')
    expect(blob).not.toContain('Confidential')
    expect(blob).not.toContain(aClient.id)
  })

  it('anonymous callers cannot reach the private API', async () => {
    const anon = new Client(base)
    for (const p of ['/api/clients', '/api/requests', '/api/signatures', '/api/dashboard', '/api/documents', `/api/requests/${aRequest.id}`]) {
      expect((await anon.get(p)).status).toBe(401)
    }
  })
})
