import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { generateKeyPairSync, publicEncrypt, constants, randomBytes, createCipheriv, createDecipheriv, createHmac, createHash } from 'crypto'
import { PDFDocument } from 'pdf-lib'
import { startApp, stopApp, newOwner, documentTypeId, signWebhook, skipIntegration } from './helpers.mjs'
import { decryptFlowRequest, encryptFlowResponse, decryptFlowMedia, FlowCryptoError } from '../messaging/flowCrypto.mjs'
import { documentsFlow } from '../messaging/documentsFlow.mjs'

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})

/** Encrypt a request body the way WhatsApp does. */
function encryptAsMeta(payload) {
  const aesKey = randomBytes(16)
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-128-gcm', aesKey, iv)
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final(), cipher.getAuthTag()])
  const body = {
    encrypted_aes_key: publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, aesKey).toString('base64'),
    encrypted_flow_data: data.toString('base64'),
    initial_vector: iv.toString('base64'),
  }
  return { body, aesKey, iv }
}

/** Decrypt our response the way WhatsApp does. */
function decryptResponse(text, aesKey, iv) {
  const buf = Buffer.from(text, 'base64')
  const d = createDecipheriv('aes-128-gcm', aesKey, Buffer.from(iv.map((b) => ~b & 0xff)))
  d.setAuthTag(buf.subarray(-16))
  return JSON.parse(Buffer.concat([d.update(buf.subarray(0, -16)), d.final()]).toString('utf8'))
}

/** Encrypt a media file the way WhatsApp's CDN stores it. */
function encryptMedia(plain) {
  const key = randomBytes(32), hmacKey = randomBytes(32), iv = randomBytes(16)
  const c = createCipheriv('aes-256-cbc', key, iv)
  const ciphertext = Buffer.concat([c.update(plain), c.final()])
  const mac = createHmac('sha256', hmacKey).update(iv).update(ciphertext).digest().subarray(0, 10)
  const cdnFile = Buffer.concat([ciphertext, mac])
  const sha = (b) => createHash('sha256').update(b).digest('base64')
  return {
    cdnFile,
    meta: { encryption_key: key.toString('base64'), hmac_key: hmacKey.toString('base64'), iv: iv.toString('base64'), encrypted_hash: sha(cdnFile), plaintext_hash: sha(plain) },
  }
}

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

describe('WhatsApp Flow crypto', () => {
  it('decrypts a request and encrypts a response WhatsApp can read', () => {
    const { body, aesKey, iv } = encryptAsMeta({ action: 'ping', version: '3.0' })
    const dec = decryptFlowRequest(body, privateKey)
    expect(dec.payload).toEqual({ action: 'ping', version: '3.0' })
    const out = encryptFlowResponse({ data: { status: 'active' } }, dec.aesKey, dec.iv)
    expect(decryptResponse(out, aesKey, iv)).toEqual({ data: { status: 'active' } })
  })

  it('rejects requests encrypted for another key or tampered with', () => {
    const { body } = encryptAsMeta({ action: 'ping' })
    const other = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
    expect(() => decryptFlowRequest(body, other.privateKey)).toThrow(FlowCryptoError)
    const data = Buffer.from(body.encrypted_flow_data, 'base64'); data[0] ^= 1
    expect(() => decryptFlowRequest({ ...body, encrypted_flow_data: data.toString('base64') }, privateKey)).toThrow(FlowCryptoError)
  })

  it('decrypts and verifies uploaded media', () => {
    const { cdnFile, meta } = encryptMedia(PNG_1PX)
    expect(decryptFlowMedia(cdnFile, meta).equals(PNG_1PX)).toBe(true)
    const bad = Buffer.from(cdnFile); bad[3] ^= 1
    expect(() => decryptFlowMedia(bad, meta)).toThrow(FlowCryptoError)
    expect(() => decryptFlowMedia(bad, { ...meta, encrypted_hash: createHash('sha256').update(bad).digest('base64') })).toThrow('hmac_mismatch')
  })
})

describe('Flow JSON', () => {
  const screens = Object.fromEntries(documentsFlow.screens.map((s) => [s.id, s]))
  it('routes only between declared screens and ends at a terminal screen with a footer', () => {
    for (const [from, to] of Object.entries(documentsFlow.routing_model)) {
      expect(screens[from]).toBeTruthy()
      for (const t of to) expect(screens[t]).toBeTruthy()
    }
    for (const s of documentsFlow.screens.filter((x) => x.terminal)) {
      expect(s.layout.children.some((c) => c.type === 'Footer')).toBe(true)
    }
  })
  it('has at most one media picker and two embedded links per screen', () => {
    for (const s of documentsFlow.screens) {
      expect(s.layout.children.filter((c) => c.type === 'PhotoPicker' || c.type === 'DocumentPicker').length).toBeLessThanOrEqual(1)
      expect(s.layout.children.filter((c) => c.type === 'EmbeddedLink').length).toBeLessThanOrEqual(2)
      for (const c of s.layout.children) if (c.type === 'EmbeddedLink') expect(c.text.length).toBeLessThanOrEqual(25)
    }
  })
})

describe('combineFiles', () => {
  it('keeps a single file and merges several pages into one PDF', async () => {
    const { combineFiles } = await import('../messaging/whatsappFlow.mjs')
    expect((await combineFiles([PNG_1PX])).ext).toBe('png')
    const src = await PDFDocument.create(); src.addPage(); src.addPage()
    const merged = await combineFiles([PNG_1PX, Buffer.from(await src.save()), Buffer.from('not a file')])
    expect(merged.ext).toBe('pdf')
    expect(merged.skipped).toBe(1)
    expect((await PDFDocument.load(merged.buffer)).getPageCount()).toBe(3)
  })
})

describe.skipIf(skipIntegration())('WhatsApp Flow endpoint', () => {
  let base, owner, request, cfg, saved, flow
  const phone = '972524445566'

  async function call(payload, { sign = true } = {}) {
    const { body, aesKey, iv } = encryptAsMeta(payload)
    const raw = JSON.stringify(body)
    const res = await fetch(`${base}/api/whatsapp/webhook/flow`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(sign ? { 'x-hub-signature-256': signWebhook(raw) } : {}) },
      body: raw,
    })
    return { status: res.status, json: res.status === 200 ? decryptResponse(await res.text(), aesKey, iv) : null }
  }

  beforeAll(async () => {
    cfg = (await import('../config.mjs')).config
    saved = { mode: cfg.whatsapp.uploadMode, flow: { ...cfg.whatsapp.flow } }
    Object.assign(cfg.whatsapp, { uploadMode: 'flow' })
    Object.assign(cfg.whatsapp.flow, { id: 'test-flow', privateKey, template: 'sadir_document_request_flow' })
    flow = await import('../messaging/whatsappFlow.mjs')
    base = await startApp()
    owner = await newOwner(base)
    const required = await documentTypeId(owner, 'Payslip')
    const optional = await documentTypeId(owner, 'Bank letter')
    request = (await owner.post('/api/requests', {
      newClient: { name: 'Dana Levi', phone: '0524445566' }, title: 'Mortgage',
      items: [{ documentTypeId: required }, { documentTypeId: optional, required: false }],
    })).data.request
  })
  afterAll(async () => {
    cfg.whatsapp.uploadMode = saved.mode
    Object.assign(cfg.whatsapp.flow, saved.flow)
    await stopApp()
  })

  it('answers health checks and refuses bad signatures or undecryptable bodies', async () => {
    expect((await call({ action: 'ping', version: '3.0' })).json).toEqual({ data: { status: 'active' } })
    expect((await call({ action: 'ping' }, { sign: false })).status).toBe(432)
    const raw = JSON.stringify({ encrypted_aes_key: 'AAAA', encrypted_flow_data: 'AAAA', initial_vector: 'AAAA' })
    const res = await fetch(`${base}/api/whatsapp/webhook/flow`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signWebhook(raw) }, body: raw })
    expect(res.status).toBe(421)
  })

  it('walks the client through the request, one screen per document', async () => {
    const token = flow.signFlowToken({ caseId: request.id, phone })
    const init = (await call({ action: 'INIT', version: '3.0', flow_token: token })).json
    expect(init.screen).toBe('WELCOME')
    expect(init.data.intro).toContain('Mortgage')

    const first = (await call({ action: 'data_exchange', screen: 'WELCOME', flow_token: token, data: { start: 'Office' } })).json
    expect(first.screen).toBe('DOC')
    expect(first.data.heading).toBe('Payslip')
    expect(first.data.can_skip).toBe(false)

    const empty = (await call({ action: 'data_exchange', screen: 'DOC', flow_token: token, data: { doc_id: first.data.doc_id, sent_count: 0, photos: [] } })).json
    expect(empty.screen).toBe('DOC')
    expect(empty.data.error_message).toBeTruthy()

    const asFile = (await call({ action: 'data_exchange', screen: 'DOC', flow_token: token, data: { use_file: first.data.doc_id, doc_id: first.data.doc_id, sent_count: 0 } })).json
    expect(asFile.screen).toBe('DOC_FILE')

    const second = (await call({ action: 'data_exchange', screen: 'DOC_FILE', flow_token: token, data: { skip: first.data.doc_id, doc_id: first.data.doc_id, sent_count: 0 } })).json
    expect(second.screen).toBe('DOC_FILE')
    expect(second.data.heading).toBe('Bank letter')
    expect(second.data.can_skip).toBe(true)

    const done = (await call({ action: 'data_exchange', screen: 'DOC_FILE', flow_token: token, data: { skip: second.data.doc_id, doc_id: second.data.doc_id, sent_count: 0 } })).json
    expect(done.screen).toBe('DONE')
  })

  it('stores uploaded pages in the background as one PDF on the document', async () => {
    const token = flow.signFlowToken({ caseId: request.id, phone })
    const docId = request.requiredDocuments.find((d) => d.name === 'Payslip').id
    const pages = [encryptMedia(PNG_1PX), encryptMedia(PNG_1PX)]
    const realFetch = globalThis.fetch
    globalThis.fetch = (url, opts) => {
      const m = String(url).match(/^https:\/\/mmg\.whatsapp\.net\/(\d)$/)
      return m ? Promise.resolve(new Response(pages[Number(m[1])].cdnFile)) : realFetch(url, opts)
    }
    try {
      const photos = pages.map((p, i) => ({ media_id: `m${i}`, cdn_url: `https://mmg.whatsapp.net/${i}`, file_name: `p${i}.png`, encryption_metadata: p.meta }))
      const res = (await call({ action: 'data_exchange', screen: 'DOC', flow_token: token, data: { doc_id: docId, sent_count: 0, photos } })).json
      expect(res.data.heading).toBe('Bank letter')
      expect(res.data.sent_count).toBe(1)
      await new Promise((r) => setTimeout(r, 800))
    } finally {
      globalThis.fetch = realFetch
    }
    const { queryOne } = await import('../db/pool.mjs')
    const doc = await queryOne('SELECT status, file_name, file_type FROM case_documents WHERE id = $1', [docId])
    expect(doc.status).toBe('uploaded')
    expect(doc.file_name).toMatch(/\.pdf$/)
  })

  it('starts from the welcome screen even when WhatsApp drops the command key', async () => {
    const token = flow.signFlowToken({ caseId: request.id, phone })
    const res = (await call({ action: 'data_exchange', screen: 'WELCOME', flow_token: token, data: {} })).json
    expect(['DOC', 'DOC_FILE', 'DONE']).toContain(res.screen)
    expect(res.screen).not.toBe('WELCOME')
  })

  it('shows a closing screen for forged or expired tokens', async () => {
    const forged = flow.signFlowToken({ caseId: request.id, phone }).replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'))
    expect((await call({ action: 'INIT', flow_token: forged })).json.screen).toBe('DONE')
    const expired = flow.signFlowToken({ caseId: request.id, phone }, -1)
    expect((await call({ action: 'INIT', flow_token: expired })).json.data.heading).toContain('פג תוקף')
  })

  it('falls back to the regular template when the FLOW template is rejected by Meta', async () => {
    const { config } = await import('../config.mjs')
    const realFetch = globalThis.fetch
    const sent = []
    config.whatsapp.mode = 'cloud'
    globalThis.fetch = async (url, opts) => {
      if (!String(url).includes('graph.facebook.com')) return realFetch(url, opts)
      const body = JSON.parse(opts.body)
      sent.push(body.template?.name)
      return body.template?.name === 'sadir_document_request_flow'
        ? new Response(JSON.stringify({ error: { message: '(#132001) Template name does not exist in the translation', code: 132001 } }), { status: 404 })
        : new Response(JSON.stringify({ messages: [{ id: 'wamid.ok' }] }))
    }
    try {
      const res = await owner.post(`/api/requests/${request.id}/send`, { channel: 'whatsapp', kind: 'reminder' })
      expect(res.status).toBe(200)
    } finally {
      globalThis.fetch = realFetch
      config.whatsapp.mode = 'log'
    }
    expect(sent).toEqual(['sadir_document_request_flow', config.whatsapp.templates.documentReminder])
  })

  it('sends the request template with a FLOW button and opens the Flow from the bot', async () => {
    const { sentLog } = await import('../messaging/whatsapp.mjs')
    const before = sentLog.length
    expect((await owner.post(`/api/requests/${request.id}/send`, { channel: 'whatsapp', kind: 'initial' })).status).toBe(200)
    const tpl = sentLog.slice(before).find((m) => m.to === phone)
    expect(tpl.payload.template.name).toBe('sadir_document_request_flow')
    const btn = tpl.payload.template.components.find((c) => c.type === 'button')
    expect(btn.sub_type).toBe('flow')
    expect(flow.verifyFlowToken(btn.parameters[0].action.flow_token)).toEqual({ caseId: request.id, phone })

    const raw = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: phone, id: 'f1', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'docs' } } }] } }] }] })
    await fetch(`${base}/api/whatsapp/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signWebhook(raw) }, body: raw })
    await new Promise((r) => setTimeout(r, 300))
    const msg = sentLog.slice(before).filter((m) => m.to === phone).at(-1)
    expect(msg.payload.interactive.type).toBe('flow')
    expect(msg.payload.interactive.action.parameters.flow_id).toBe('test-flow')
  })
})
