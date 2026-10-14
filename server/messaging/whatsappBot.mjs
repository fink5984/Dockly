/**
 * WhatsApp bot: in-chat document collection and support relay.
 *
 * Flow (unchanged for clients):
 *  1. Staff sends the request template; its quick-reply button carries show_docs_<caseId>
 *  2. Client taps it → interactive list of missing documents
 *  3. Client picks a document → bot asks for the file
 *  4. Client sends an image/document → stored through the shared upload pipeline
 *  5. "תפריט"/"menu" shows the list again; "תמיכה"/"support" opens a staff chat
 *
 * Hardening vs. the previous version:
 *  - webhook bodies are authenticated with X-Hub-Signature-256
 *  - case and document ids from button payloads are checked against the
 *    sender's conversation/phone before use (audit B6)
 *  - delivery `statuses` callbacks update message status
 */
import { query, queryOne } from '../db/pool.mjs'
import { config } from '../config.mjs'
import { logger } from '../lib/logger.mjs'
import { safeEqual } from '../lib/crypto.mjs'
import { publish } from '../lib/events.mjs'
import { logActivity, notifyWorkspace } from '../lib/activity.mjs'
import { sendWhatsApp, textPayload, markRead, downloadMedia, verifyWebhookSignature } from './whatsapp.mjs'
import { applyDeliveryStatus } from './index.mjs'
import { normalizePhone } from './phone.mjs'
import { ingestUpload } from '../domain/requests.mjs'
import { NEEDS_UPLOAD } from '../domain/requestStatus.mjs'

const MENU_WORDS = ['תפריט', 'menu', 'מסמכים', 'documents', 'רשימה', 'list', 'start', 'hi', 'שלום']
const BACK_WORDS = ['חזור', 'back', 'תפריט', 'menu', 'מסמכים', 'documents', 'רשימה', 'list']
const SUPPORT_WORDS = ['תמיכה', 'support', 'עזרה', 'help']
const STATUS_WORDS = ['סטטוס', 'status']

const SUPPORT_INTRO = '💬 *מצב תמיכה*\n\nכתוב את ההודעה שלך והצוות יקבל התראה ויענה לך ישירות כאן.\n\n💡 כתוב *חזור* כדי לחזור לתפריט המסמכים.'

// ── send helpers ────────────────────────────────────────────
async function reply(to, text, ctx) {
  const r = await sendWhatsApp(to, textPayload(text))
  if (ctx?.workspace_id) await logMessage(ctx, 'outbound', to, 'text', text, r)
  return r
}

async function replyButtons(to, text, buttons, ctx) {
  const r = await sendWhatsApp(to, { type: 'interactive', interactive: { type: 'button', body: { text }, action: { buttons } } })
  if (ctx?.workspace_id) await logMessage(ctx, 'outbound', to, 'interactive', text, r)
  return r
}

async function logMessage(ctx, direction, phone, type, content, result, metadata) {
  await query(
    `INSERT INTO whatsapp_messages (workspace_id, case_id, client_id, direction, phone_number, message_type, content, status, wa_message_id, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [ctx.workspace_id, ctx.case_id || null, ctx.client_id || null, direction, phone, type, String(content).slice(0, 2000),
      direction === 'inbound' ? 'received' : result?.ok ? 'sent' : 'failed', result?.messageId || null, metadata ? JSON.stringify(metadata) : null],
  ).catch((err) => logger.warn('wa_log_failed', { err }))
}

// ── state ──────────────────────────────────────────────────
const getState = (phone) => queryOne('SELECT * FROM whatsapp_conversation_state WHERE phone_number = $1', [phone])

async function setAwaiting(phone, docId, docName) {
  await query(
    'UPDATE whatsapp_conversation_state SET awaiting_document_id = $2, awaiting_document_name = $3, updated_at = now() WHERE phone_number = $1',
    [phone, docId, docName],
  )
}

/**
 * Resolve a case the sender may act on. The case must be the one in their
 * conversation state, or belong to a client whose phone matches the sender.
 */
async function authorizeCase(phone, caseId) {
  if (!/^[0-9a-f-]{36}$/i.test(caseId)) return null
  const c = await queryOne(
    `SELECT c.id AS case_id, c.workspace_id, c.client_id, cl.phone FROM cases c JOIN clients cl ON cl.id = c.client_id WHERE c.id = $1`,
    [caseId],
  )
  if (!c) return null
  const state = await getState(phone)
  if (state?.case_id === c.case_id || normalizePhone(c.phone) === phone) {
    await query(
      `INSERT INTO whatsapp_conversation_state (phone_number, case_id, client_id, workspace_id, updated_at)
       VALUES ($1,$2,$3,$4,now())
       ON CONFLICT (phone_number) DO UPDATE SET case_id = EXCLUDED.case_id, client_id = EXCLUDED.client_id,
         workspace_id = EXCLUDED.workspace_id, awaiting_document_id = NULL, awaiting_document_name = NULL, updated_at = now()`,
      [phone, c.case_id, c.client_id, c.workspace_id],
    )
    return getState(phone)
  }
  logger.warn('wa_case_not_authorized', { phone: phone.slice(0, 5) + '…' })
  return null
}

const pendingDocuments = (caseId) => query(
  `SELECT cd.id, cd.status, cd.is_required, COALESCE(cd.custom_name, dt.name) AS name
     FROM case_documents cd LEFT JOIN document_types dt ON dt.id = cd.document_type_id
    WHERE cd.case_id = $1 AND cd.status = ANY($2::text[]) ORDER BY cd.sort_order`,
  [caseId, [...NEEDS_UPLOAD]],
)

async function sendDocumentList(phone, state) {
  const docs = await pendingDocuments(state.case_id)
  if (docs.length === 0) {
    await reply(phone, '🎉 כל הכבוד! כל המסמכים הועלו בהצלחה.\nאין מסמכים נוספים להעלאה.', state)
    return
  }
  const rows = docs.slice(0, 10).map((d) => ({
    id: `upload_${d.id}`,
    title: (d.name || 'מסמך').slice(0, 24),
    description: d.status === 'rejected' ? '🔁 יש להעלות מחדש' : d.is_required ? '⚠️ חובה' : '📎 רשות',
  }))
  const r = await sendWhatsApp(phone, {
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: `📋 *מסמכים להעלאה (${docs.length}):*\n\nבחר מסמך מהרשימה כדי להעלות אותו.\nלאחר הבחירה, שלח את הקובץ (תמונה או מסמך).` },
      action: { button: '📋 בחר מסמך', sections: [{ title: 'מסמכים נדרשים', rows }] },
    },
  })
  await logMessage(state, 'outbound', phone, 'interactive_list', `Document list (${docs.length} pending)`, r)
}

async function handleDocumentSelected(phone, docId) {
  const state = await getState(phone)
  if (!state) return reply(phone, '❌ לא נמצא תיק פעיל. בקש מהמשרד לשלוח לך הודעה חדשה.')
  const doc = await queryOne(
    `SELECT cd.id, COALESCE(cd.custom_name, dt.name) AS name, cd.rejection_reason
       FROM case_documents cd LEFT JOIN document_types dt ON dt.id = cd.document_type_id
      WHERE cd.id = $1 AND cd.case_id = $2`,
    [docId, state.case_id],
  )
  if (!doc) return reply(phone, '❌ המסמך לא נמצא. נסה שוב.', state)
  await setAwaiting(phone, doc.id, doc.name || 'מסמך')
  const reason = doc.rejection_reason ? `\n\n❗ הסיבה שהמסמך הקודם לא התקבל: ${doc.rejection_reason}` : ''
  await reply(phone, `📎 *${doc.name || 'מסמך'}*${reason}\n\nשלח את הקובץ עכשיו — תמונה 📷 או מסמך PDF 📄`, state)
}

async function handleMedia(phone, media, fileName) {
  const state = await getState(phone)
  if (!state) return reply(phone, '❌ לא נמצא תיק פעיל. בקש מהמשרד לשלוח לך הודעה חדשה.')
  if (!state.awaiting_document_id) {
    await reply(phone, '⚠️ קודם צריך לבחור איזה מסמך אתה מעלה.\nבחר מהרשימה:', state)
    return sendDocumentList(phone, state)
  }
  const file = await downloadMedia(media.id)
  if (!file) return reply(phone, '❌ לא הצלחנו להוריד את הקובץ. נסה לשלוח שוב.', state)

  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'application/pdf': 'pdf' }[file.mimeType] || 'bin'
  const name = fileName || `${state.awaiting_document_name || 'document'}.${ext}`
  try {
    await ingestUpload({
      workspaceId: state.workspace_id,
      caseId: state.case_id,
      caseDocumentId: state.awaiting_document_id,
      buffer: file.buffer,
      fileName: name,
      via: 'whatsapp',
      actor: { type: 'client' },
    })
  } catch (err) {
    logger.warn('wa_upload_rejected', { code: err.code })
    const msg = err.code === 'file_type_not_allowed' || err.code === 'unsupported_file_type'
      ? '❌ סוג הקובץ לא נתמך עבור מסמך זה. שלח תמונה או PDF.'
      : err.code === 'file_too_large' ? '❌ הקובץ גדול מדי. נסה לשלוח קובץ קטן יותר.' : '❌ שגיאה בעיבוד הקובץ. נסה שוב.'
    return reply(phone, msg, state)
  }
  await logMessage(state, 'inbound', phone, 'media', `Uploaded: ${state.awaiting_document_name}`, null, { docId: state.awaiting_document_id })
  const docName = state.awaiting_document_name
  await setAwaiting(phone, null, null)
  const remaining = await pendingDocuments(state.case_id)
  if (remaining.length === 0) {
    await reply(phone, `✅ *${docName}* הועלה בהצלחה!\n\n🎉 מעולה! כל המסמכים הועלו!\nתודה רבה! 🙏`, state)
  } else {
    await replyButtons(phone, `✅ *${docName}* הועלה בהצלחה!\n\n📄 נותרו עוד *${remaining.length}* מסמכים להעלאה.`,
      [{ type: 'reply', reply: { id: `show_docs_${state.case_id}`, title: '📄 המשך להעלות' } }], state)
  }
}

// ── support relay ──────────────────────────────────────────
async function findOrCreateSupportRequest(state) {
  const existing = await queryOne(
    `SELECT id FROM support_requests WHERE case_id = $1 AND status NOT IN ('closed','resolved') ORDER BY created_at DESC LIMIT 1`,
    [state.case_id],
  )
  if (existing) return existing.id
  const client = await queryOne('SELECT name FROM clients WHERE id = $1', [state.client_id])
  const created = await queryOne(
    `INSERT INTO support_requests (case_id, client_id, subject, status, issue_description, opened_at)
     VALUES ($1,$2,$3,'open','פנייה מוואטסאפ',now()) RETURNING id`,
    [state.case_id, state.client_id, `שיחת תמיכה – ${client?.name || ''}`],
  )
  return created.id
}

async function enterSupport(phone, state) {
  const id = await findOrCreateSupportRequest(state)
  await query(
    `UPDATE whatsapp_conversation_state SET support_mode = true, support_request_id = $2, awaiting_document_id = NULL, awaiting_document_name = NULL, updated_at = now() WHERE phone_number = $1`,
    [phone, id],
  )
  await reply(phone, SUPPORT_INTRO, state)
  publish(state.workspace_id, 'support', { caseId: state.case_id })
}

async function exitSupport(phone) {
  await query('UPDATE whatsapp_conversation_state SET support_mode = false, support_request_id = NULL, updated_at = now() WHERE phone_number = $1', [phone])
}

async function relayToSupport(phone, state, text, messageId) {
  const sr = await queryOne('SELECT id FROM support_requests WHERE id = $1', [state.support_request_id])
  if (!sr) {
    await exitSupport(phone)
    await reply(phone, '⚠️ השיחה הקודמת הסתיימה. חוזרים לתפריט.', state)
    return sendDocumentList(phone, state)
  }
  const client = await queryOne('SELECT name FROM clients WHERE id = $1', [state.client_id])
  const prior = await queryOne(`SELECT 1 FROM support_messages WHERE request_id = $1 AND sender_type = 'client' LIMIT 1`, [sr.id])
  await query(
    `INSERT INTO support_messages (request_id, sender_type, sender_name, content, whatsapp_message_id) VALUES ($1,'client',$2,$3,$4)`,
    [sr.id, client?.name || '', text.slice(0, 4000), messageId],
  )
  await query(`UPDATE support_requests SET status = 'waiting-for-staff' WHERE id = $1`, [sr.id])
  await logMessage(state, 'inbound', phone, 'support_chat', text, null, { supportRequestId: sr.id })
  publish(state.workspace_id, 'support', { caseId: state.case_id })
  await notifyWorkspace({ workspaceId: state.workspace_id, type: 'info', title: `${client?.name || ''}: new support message`, template: 'support_message', params: { client: client?.name || '' }, message: text.slice(0, 140), actionUrl: `/app/requests/${state.case_id}?panel=support` })
  if (!prior) await reply(phone, '✉️ ההודעה שלך נשלחה לצוות. נחזור אליך בהקדם.\n💡 כתוב *חזור* לחזור לתפריט המסמכים.', state)
}

async function handleText(phone, text, messageId) {
  const normalized = text.trim().toLowerCase()
  const state = await getState(phone)

  if (state?.support_mode && BACK_WORDS.includes(normalized)) {
    await exitSupport(phone)
    await reply(phone, '✅ יצאת ממצב תמיכה. חוזרים לתפריט הרגיל.', state)
    return sendDocumentList(phone, state)
  }
  if (state?.support_mode && state.support_request_id) return relayToSupport(phone, state, text.trim(), messageId)

  if (SUPPORT_WORDS.includes(normalized)) {
    if (!state) return reply(phone, 'אין כרגע תיק פעיל. בקש מהמשרד לשלוח לך הודעה חדשה.')
    return enterSupport(phone, state)
  }
  if (MENU_WORDS.includes(normalized)) {
    if (!state) return reply(phone, 'שלום! 👋\nאין כרגע תיק פעיל. בקש מהמשרד לשלוח לך הודעה חדשה.')
    return sendDocumentList(phone, state)
  }
  if (STATUS_WORDS.includes(normalized)) {
    if (!state) return reply(phone, 'אין תיק פעיל.')
    const all = await query(
      `SELECT cd.status, COALESCE(cd.custom_name, dt.name) AS name FROM case_documents cd LEFT JOIN document_types dt ON dt.id = cd.document_type_id WHERE cd.case_id = $1 ORDER BY cd.sort_order`,
      [state.case_id],
    )
    const pending = all.filter((d) => NEEDS_UPLOAD.has(d.status))
    const done = all.filter((d) => !NEEDS_UPLOAD.has(d.status))
    let msg = '📊 *סטטוס מסמכים:*\n\n'
    if (done.length) msg += `✅ התקבלו (${done.length}):\n${done.map((d) => `  • ${d.name}`).join('\n')}\n`
    if (pending.length) msg += `\n⏳ ממתינים (${pending.length}):\n${pending.map((d) => `  • ${d.name}`).join('\n')}`
    else msg += '\n🎉 כל המסמכים הועלו!'
    return reply(phone, msg, state)
  }
  if (!state) return reply(phone, 'שלום! 👋\nאני הבוט של Sadir.\nאין כרגע תיק פעיל. בקש מהמשרד לשלוח לך הודעה חדשה.')
  if (state.awaiting_document_id) {
    return reply(phone, `📎 אני מחכה שתשלח את הקובץ עבור *${state.awaiting_document_name}*.\nשלח תמונה 📷 או מסמך PDF 📄.\n\n💡 כתוב *תפריט* לרשימת המסמכים\n💡 כתוב *תמיכה* לפנייה לצוות`, state)
  }
  return replyButtons(phone, '👋 שלום! אני הבוט של Sadir.\n\n💡 לחץ על הכפתור כדי לראות את המסמכים.\n📞 כתוב *תמיכה* לשיחה עם הצוות.', [
    { type: 'reply', reply: { id: `show_docs_${state.case_id}`, title: '📄 הצג מסמכים' } },
    { type: 'reply', reply: { id: `support_${state.case_id}`, title: '💬 תמיכה' } },
  ], state)
}

async function handlePayload(phone, payload) {
  if (payload.startsWith('show_docs_')) {
    const state = await authorizeCase(phone, payload.slice('show_docs_'.length))
    if (state) await sendDocumentList(phone, state)
    return
  }
  if (payload.startsWith('support_')) {
    const state = await authorizeCase(phone, payload.slice('support_'.length))
    if (state) await enterSupport(phone, state)
    return
  }
  if (payload === 'exit_support') {
    await exitSupport(phone)
    const state = await getState(phone)
    if (state) await sendDocumentList(phone, state)
  }
}

async function handleMessage(msg) {
  const phone = String(msg.from || '').replace(/\D/g, '')
  if (!phone) return
  const state = await getState(phone)
  if (!state?.support_mode) markRead(msg.id, true)

  switch (msg.type) {
    case 'interactive': {
      const i = msg.interactive
      if (i?.type === 'button_reply') return handlePayload(phone, i.button_reply.id || '')
      if (i?.type === 'list_reply' && (i.list_reply.id || '').startsWith('upload_')) return handleDocumentSelected(phone, i.list_reply.id.slice('upload_'.length))
      return
    }
    case 'button':
      return handlePayload(phone, msg.button?.payload || '')
    case 'image':
    case 'document':
      return handleMedia(phone, msg[msg.type], msg[msg.type]?.filename || null)
    case 'text':
      return handleText(phone, msg.text?.body || '', msg.id)
    default:
      logger.info('wa_unhandled_type', { type: msg.type })
  }
}

// ── Express handlers ───────────────────────────────────────
export function handleVerification(req, res) {
  const mode = req.query['hub.mode']
  const token = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']
  if (mode === 'subscribe' && config.whatsapp.verifyToken && typeof token === 'string' && safeEqual(token, config.whatsapp.verifyToken)) {
    return res.status(200).type('text/plain').send(String(challenge ?? ''))
  }
  return res.sendStatus(403)
}

export async function handleIncoming(req, res) {
  const signed = verifyWebhookSignature(req.rawBody, req.get('x-hub-signature-256'))
  if (!signed) {
    if (process.env.WHATSAPP_ALLOW_UNSIGNED_WEBHOOKS === 'true') {
      logger.warn('wa_webhook_unsigned_accepted', { note: 'WHATSAPP_ALLOW_UNSIGNED_WEBHOOKS=true — set WHATSAPP_APP_SECRET and remove this flag' })
    } else {
      logger.warn('wa_webhook_bad_signature')
      return res.sendStatus(401)
    }
  }
  res.sendStatus(200) // acknowledge fast; Meta retries slow endpoints

  try {
    for (const entry of req.body?.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value || {}
        for (const st of value.statuses || []) {
          await applyDeliveryStatus(st.id, st.status, st.errors?.[0]?.title).catch((err) => logger.warn('wa_status_failed', { err }))
        }
        for (const msg of value.messages || []) {
          await handleMessage(msg).catch((err) => logger.error('wa_message_failed', { type: msg.type, err }))
        }
      }
    }
  } catch (err) {
    logger.error('wa_webhook_failed', { err })
  }
}

/** Staff reply in a support conversation → WhatsApp text (24h window is open). */
export async function sendSupportReply({ workspaceId, supportRequestId, sender, content }) {
  const sr = await queryOne(
    `SELECT sr.id, sr.case_id, sr.client_id, c.workspace_id, cl.phone, cl.name AS client_name
       FROM support_requests sr JOIN cases c ON c.id = sr.case_id JOIN clients cl ON cl.id = sr.client_id
      WHERE sr.id = $1 AND c.workspace_id = $2`,
    [supportRequestId, workspaceId],
  )
  if (!sr) return { ok: false, code: 'not_found' }
  const state = await queryOne('SELECT phone_number FROM whatsapp_conversation_state WHERE support_request_id = $1 LIMIT 1', [sr.id])
  const phone = state?.phone_number || normalizePhone(sr.phone)
  if (!phone) return { ok: false, code: 'invalid_phone', error: 'The client has no valid phone number' }

  const msg = await queryOne(
    `INSERT INTO support_messages (request_id, sender_type, sender_name, content, is_read) VALUES ($1,'staff',$2,$3,true) RETURNING id`,
    [sr.id, sender.name, content],
  )
  await query(`UPDATE support_requests SET status = 'waiting-for-client' WHERE id = $1 AND status NOT IN ('resolved','closed')`, [sr.id])
  const result = await sendWhatsApp(phone, textPayload(content))
  if (result.messageId) await query('UPDATE support_messages SET whatsapp_message_id = $2 WHERE id = $1', [msg.id, result.messageId])
  await logMessage({ workspace_id: workspaceId, case_id: sr.case_id, client_id: sr.client_id }, 'outbound', phone, 'text', content, result, { supportRequestId: sr.id })
  await logActivity({
    workspaceId, type: 'support_reply', description: 'Support reply sent',
    actor: { type: 'user', id: sender.id, name: sender.name }, clientId: sr.client_id, clientName: sr.client_name, caseId: sr.case_id,
  })
  publish(workspaceId, 'support', { caseId: sr.case_id })
  return result.ok ? { ok: true, simulated: Boolean(result.simulated) } : { ok: false, code: 'send_failed', error: result.error }
}

export async function markSupportRead({ workspaceId, supportRequestId }) {
  const rows = await query(
    `UPDATE support_messages sm SET is_read = true
       FROM support_requests sr JOIN cases c ON c.id = sr.case_id
      WHERE sm.request_id = sr.id AND sr.id = $1 AND c.workspace_id = $2 AND sm.sender_type = 'client' AND NOT sm.is_read
      RETURNING sm.whatsapp_message_id`,
    [supportRequestId, workspaceId],
  )
  await Promise.all(rows.filter((r) => r.whatsapp_message_id).map((r) => markRead(r.whatsapp_message_id)))
  publish(workspaceId, 'support', {})
  return rows.length
}
