import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startApp, stopApp, newOwner, documentTypeId, signWebhook, skipIntegration } from './helpers.mjs'

async function postWebhook(base, payload, { sign = true } = {}) {
  const body = JSON.stringify(payload)
  return fetch(`${base}/api/whatsapp/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(sign ? { 'x-hub-signature-256': signWebhook(body) } : {}) },
    body,
  })
}
const wrap = (value) => ({ entry: [{ changes: [{ value }] }] })
const settle = () => new Promise((r) => setTimeout(r, 300))

describe.skipIf(skipIntegration())('WhatsApp webhook', () => {
  let base, owner, request, otherRequest
  beforeAll(async () => {
    base = await startApp()
    owner = await newOwner(base)
    const dt = await documentTypeId(owner, 'Payslip')
    request = (await owner.post('/api/requests', { newClient: { name: 'Avi', phone: '0521112233' }, title: 'Docs', items: [{ documentTypeId: dt }] })).data.request
    otherRequest = (await owner.post('/api/requests', { newClient: { name: 'Other', phone: '0539998877' }, title: 'Other', items: [{ documentTypeId: dt }] })).data.request
    await owner.post(`/api/requests/${request.id}/send`, { channel: 'whatsapp', kind: 'initial' })
  })
  afterAll(stopApp)

  it('completes the verification handshake only with the right token', async () => {
    const ok = await fetch(`${base}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=42`)
    expect(await ok.text()).toBe('42')
    const bad = await fetch(`${base}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=dockly-wa-verify-2026-secure&hub.challenge=42`)
    expect(bad.status).toBe(403)
  })

  it('rejects unsigned or wrongly signed webhooks', async () => {
    const payload = wrap({ messages: [{ from: '972521112233', id: 'm1', type: 'text', text: { body: 'menu' } }] })
    expect((await postWebhook(base, payload, { sign: false })).status).toBe(401)
    const res = await fetch(`${base}/api/whatsapp/webhook`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) }, body: JSON.stringify(payload),
    })
    expect(res.status).toBe(401)
  })

  it('sets the conversation when the request template is sent', async () => {
    const { queryOne } = await import('../db/pool.mjs')
    const st = await queryOne('SELECT case_id FROM whatsapp_conversation_state WHERE phone_number = $1', ['972521112233'])
    expect(st.case_id).toBe(request.id)
  })

  it('ignores button payloads for a case that is not the sender\'s', async () => {
    const res = await postWebhook(base, wrap({ messages: [{ from: '972521112233', id: 'm2', type: 'button', button: { payload: `show_docs_${otherRequest.id}` } }] }))
    expect(res.status).toBe(200)
    await settle()
    const { queryOne } = await import('../db/pool.mjs')
    const st = await queryOne('SELECT case_id FROM whatsapp_conversation_state WHERE phone_number = $1', ['972521112233'])
    expect(st.case_id).toBe(request.id)
  })

  it('ignores a document id from another case in a list reply (audit B6)', async () => {
    const foreignDoc = otherRequest.requiredDocuments[0].id
    await postWebhook(base, wrap({ messages: [{ from: '972521112233', id: 'm3', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: `upload_${foreignDoc}` } } }] }))
    await settle()
    const { queryOne } = await import('../db/pool.mjs')
    const st = await queryOne('SELECT awaiting_document_id FROM whatsapp_conversation_state WHERE phone_number = $1', ['972521112233'])
    expect(st.awaiting_document_id).toBeNull()
    const own = request.requiredDocuments[0].id
    await postWebhook(base, wrap({ messages: [{ from: '972521112233', id: 'm4', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: `upload_${own}` } } }] }))
    await settle()
    const st2 = await queryOne('SELECT awaiting_document_id FROM whatsapp_conversation_state WHERE phone_number = $1', ['972521112233'])
    expect(st2.awaiting_document_id).toBe(own)
  })

  it('answers "menu" with the branded menu and progress', async () => {
    const { sentLog } = await import('../messaging/whatsapp.mjs')
    const before = sentLog.length
    await postWebhook(base, wrap({ messages: [{ from: '972521112233', id: 'm7', type: 'text', text: { body: 'תפריט' } }] }))
    await settle()
    const menu = sentLog.slice(before).find((m) => m.to === '972521112233')
    expect(menu.payload.interactive.type).toBe('button')
    expect(menu.payload.interactive.body.text).toContain('0/1')
    expect(menu.payload.interactive.action.buttons.map((b) => b.reply.id)).toEqual(['docs', 'status', 'support'])
    for (const b of menu.payload.interactive.action.buttons) expect(b.reply.title.length).toBeLessThanOrEqual(20)
  })

  it('opens the document list and the status screen from menu buttons', async () => {
    const { sentLog } = await import('../messaging/whatsapp.mjs')
    const before = sentLog.length
    await postWebhook(base, wrap({ messages: [{ from: '972521112233', id: 'm8', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'docs' } } }] }))
    await settle()
    await postWebhook(base, wrap({ messages: [{ from: '972521112233', id: 'm9', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'status' } } }] }))
    await settle()
    const [list, status] = sentLog.slice(before).filter((m) => m.to === '972521112233')
    expect(list.payload.interactive.type).toBe('list')
    const rows = list.payload.interactive.action.sections.flatMap((s) => s.rows)
    expect(rows.map((r) => r.id)).toEqual([`upload_${request.requiredDocuments[0].id}`])
    expect(status.payload.interactive.header.text).toContain('סטטוס')
  })

  it('applies delivery statuses without moving backwards', async () => {
    const { query, queryOne } = await import('../db/pool.mjs')
    const d = await queryOne(`SELECT id FROM message_deliveries WHERE case_id = $1 LIMIT 1`, [request.id])
    await query(`UPDATE message_deliveries SET provider_message_id = 'wamid.TEST', status = 'accepted' WHERE id = $1`, [d.id])
    await postWebhook(base, wrap({ statuses: [{ id: 'wamid.TEST', status: 'read' }] }))
    await settle()
    await postWebhook(base, wrap({ statuses: [{ id: 'wamid.TEST', status: 'delivered' }] }))
    await settle()
    expect((await queryOne('SELECT status FROM message_deliveries WHERE id = $1', [d.id])).status).toBe('read')
  })

  it('relays support messages to staff and replies go back out', async () => {
    await postWebhook(base, wrap({ messages: [{ from: '972521112233', id: 'm5', type: 'text', text: { body: 'support' } }] }))
    await settle()
    await postWebhook(base, wrap({ messages: [{ from: '972521112233', id: 'm6', type: 'text', text: { body: 'I have a question' } }] }))
    await settle()
    const support = (await owner.get(`/api/support?caseId=${request.id}`)).data
    expect(support[0].status).toBe('waiting-for-staff')
    expect(support[0].messages.some((m) => m.content === 'I have a question')).toBe(true)
    const reply = await owner.post(`/api/support/${support[0].id}/reply`, { content: 'Happy to help' })
    expect(reply.status).toBe(200)
    const { sentLog } = await import('../messaging/whatsapp.mjs')
    expect(sentLog.some((m) => m.payload?.text?.body === 'Happy to help')).toBe(true)
  })
})
