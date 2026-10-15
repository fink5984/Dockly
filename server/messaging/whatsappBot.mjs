/**
 * WhatsApp bot: in-chat document collection and support relay.
 *
 * Flow:
 *  1. Staff sends the request template; its quick-reply button carries show_docs_<caseId>
 *  2. Client taps it → interactive list of missing documents (office name, progress bar)
 *  3. Client picks a document → bot explains what is needed and asks for the file
 *  4. Client sends an image/PDF → stored through the shared upload pipeline, and the
 *     bot offers the next document. A file sent before picking is attached directly
 *     when only one document is missing, otherwise the client picks its slot.
 *  5. Buttons (or "תפריט" / "סטטוס" / "תמיכה") open the menu, status and a staff chat
 *
 * With WHATSAPP_UPLOAD_MODE=flow the "upload documents" buttons open the
 * WhatsApp Flow form (whatsappFlow.mjs) instead of the list; everything else
 * here, including files sent in chat and "רשימה", keeps working as a fallback.
 *
 * Copy is gender-neutral Hebrew and respects Meta's interactive-message limits
 * (button title 20, list row title 24 / description 72, header/footer 60).
 *
 * Security:
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
import { applyDeliveryStatus, ensurePortalToken } from './index.mjs'
import { normalizePhone } from './phone.mjs'
import { flowEnabled, flowMessagePayload } from './whatsappFlow.mjs'
import { ingestUpload } from '../domain/requests.mjs'
import { NEEDS_UPLOAD, canonicalDocStatus } from '../domain/requestStatus.mjs'

const MENU_WORDS = ['תפריט', 'menu', 'start', 'hi', 'hello', 'שלום', 'היי']
const LIST_WORDS = ['מסמכים', 'documents', 'רשימה', 'list']
const BACK_WORDS = ['חזור', 'חזרה', 'back', ...MENU_WORDS, ...LIST_WORDS]
const SUPPORT_WORDS = ['תמיכה', 'support', 'עזרה', 'help', 'נציג']
const STATUS_WORDS = ['סטטוס', 'status']
const CANCEL_WORDS = ['ביטול', 'בטל', 'cancel']

/** Button / list-row ids that act on the sender's current conversation. */
const P = { docs: 'docs', status: 'status', support: 'support', exitSupport: 'exit_support', cancel: 'cancel_upload', later: 'later', portal: 'portal' }
const BTN = {
  docs: [P.docs, '📋 העלאת מסמכים'],
  otherDoc: [P.docs, '📋 מסמך אחר'],
  allDocs: [P.docs, '📋 כל המסמכים'],
  status: [P.status, '📊 סטטוס'],
  support: [P.support, '💬 נציג'],
  cancel: [P.cancel, '✖️ ביטול'],
  later: [P.later, '⏸️ אמשיך אחר כך'],
  backToMenu: [P.exitSupport, '↩️ חזרה לתפריט'],
}

const T = {
  footer: '🔒 העברת מסמכים מאובטחת',
  noCase: 'שלום 👋\nלא מצאנו בקשת מסמכים פעילה למספר הזה.\nאפשר לפנות למשרד ולבקש הודעה חדשה.',
  unsupported: '🙏 אפשר לשלוח כאן רק תמונות או קבצי PDF.\nלשיחה עם הצוות אפשר לכתוב *תמיכה*.',
  photoTip: '💡 כדאי לצלם ישר ובאור טוב, כך שכל הפרטים קריאים.',
  supportIntro: 'אפשר לכתוב כאן את ההודעה, והצוות יענה ישירות בצ\'אט הזה.',
  supportSent: '✉️ ההודעה הועברה לצוות. נחזור עם תשובה בהקדם.',
}

const clip = (s, n) => {
  const str = String(s ?? '')
  return str.length > n ? str.slice(0, n - 1) + '…' : str
}

function progressBar(done, total, size = 10) {
  const filled = total ? Math.round((done / total) * size) : 0
  return '▰'.repeat(filled) + '▱'.repeat(size - filled)
}

function formatsText(formats) {
  const f = formats?.length ? formats : ['pdf', 'jpg', 'png']
  const image = f.some((x) => ['jpg', 'jpeg', 'png', 'heic', 'webp'].includes(x))
  const pdf = f.includes('pdf')
  if (image && pdf) return 'תמונה 📷 או קובץ PDF 📄'
  if (pdf) return 'קובץ PDF 📄'
  if (image) return 'תמונה 📷'
  return `קובץ (${f.map((x) => x.toUpperCase()).join(' / ')})`
}

// ── send helpers ────────────────────────────────────────────
async function send(to, payload, ctx, type, content) {
  const r = await sendWhatsApp(to, payload)
  if (ctx?.workspace_id) await logMessage(ctx, 'outbound', to, type, content, r)
  return r
}

const reply = (to, text, ctx) => send(to, textPayload(text), ctx, 'text', text)

function interactive(type, { header, body, footer = T.footer, action }) {
  return {
    type: 'interactive',
    interactive: {
      type,
      ...(header ? { header: { type: 'text', text: clip(header, 60) } } : {}),
      body: { text: clip(body, 1024) },
      ...(footer ? { footer: { text: clip(footer, 60) } } : {}),
      action,
    },
  }
}

function replyButtons(to, ctx, { buttons, ...msg }) {
  const action = { buttons: buttons.map(([id, title]) => ({ type: 'reply', reply: { id, title: clip(title, 20) } })) }
  return send(to, interactive('button', { ...msg, action }), ctx, 'interactive', msg.body)
}

function replyList(to, ctx, { button, sections, ...msg }) {
  return send(to, interactive('list', { ...msg, action: { button: clip(button, 20), sections } }), ctx, 'interactive_list', msg.body)
}

function replyLink(to, ctx, { label, url, ...msg }) {
  const action = { name: 'cta_url', parameters: { display_text: clip(label, 20), url } }
  return send(to, interactive('cta_url', { ...msg, action }), ctx, 'interactive', msg.body)
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
         workspace_id = EXCLUDED.workspace_id, awaiting_document_id = NULL, awaiting_document_name = NULL,
         support_mode = false, support_request_id = NULL, updated_at = now()`,
      [phone, c.case_id, c.client_id, c.workspace_id],
    )
    return getState(phone)
  }
  logger.warn('wa_case_not_authorized', { phone: phone.slice(0, 5) + '…' })
  return null
}

const DOC_FIELDS = `cd.id, cd.status, cd.is_required, cd.rejection_reason, cd.case_notes,
  COALESCE(cd.custom_name, dt.name, 'מסמך') AS name, dt.helper_text, dt.allowed_formats`

/** Rejected documents first, then required, then optional (stable within a group). */
const docRank = (d) => (canonicalDocStatus(d.status) === 'rejected' ? 0 : d.is_required ? 1 : 2)

/** Everything a message about a case needs: names, documents, progress. */
async function loadCase(caseId) {
  const [c, docs] = await Promise.all([
    queryOne(
      `SELECT COALESCE(c.title, c.case_type) AS title, cl.name AS client_name, w.name AS ws_name
         FROM cases c JOIN clients cl ON cl.id = c.client_id JOIN workspaces w ON w.id = c.workspace_id WHERE c.id = $1`,
      [caseId],
    ),
    query(
      `SELECT ${DOC_FIELDS} FROM case_documents cd LEFT JOIN document_types dt ON dt.id = cd.document_type_id
        WHERE cd.case_id = $1 ORDER BY cd.sort_order`,
      [caseId],
    ),
  ])
  const pending = docs.filter((d) => NEEDS_UPLOAD.has(d.status)).sort((a, b) => docRank(a) - docRank(b))
  return {
    title: c?.title || '',
    firstName: String(c?.client_name || '').trim().split(/\s+/)[0],
    wsName: c?.ws_name || '',
    docs,
    pending,
    received: docs.length - pending.length,
  }
}

const greeting = (k) => (k.firstName ? `שלום ${k.firstName} 👋` : 'שלום 👋')
const progressLine = (k) => `${progressBar(k.received, k.docs.length)}  *${k.received}/${k.docs.length}* התקבלו`
const portalUrl = async (caseId) => `${config.appBaseUrl}/p/${await ensurePortalToken(caseId)}`

// ── screens ────────────────────────────────────────────────
async function showMenu(phone, state, intro) {
  const k = await loadCase(state.case_id)
  const done = k.pending.length === 0
  const body = [
    intro || greeting(k),
    `בקשת מסמכים: *${k.title}*\n${progressLine(k)}`,
    done ? '🎉 כל המסמכים התקבלו.' : `נותרו *${k.pending.length}* מסמכים להעלאה.`,
  ].join('\n\n')
  return replyButtons(phone, state, {
    header: k.wsName,
    body,
    buttons: done ? [BTN.status, BTN.support] : [BTN.docs, BTN.status, BTN.support],
  })
}

function docRow(d, mediaId) {
  const description = canonicalDocStatus(d.status) === 'rejected'
    ? (d.rejection_reason ? `לא התקבל: ${d.rejection_reason}` : 'נדרשת העלאה מחדש')
    : [d.is_required ? 'חובה' : 'רשות', d.case_notes || d.helper_text].filter(Boolean).join(' · ')
  return {
    id: mediaId ? `attach_${d.id}_${mediaId}` : `upload_${d.id}`,
    title: clip(d.name, 24),
    description: clip(description, 72),
  }
}

/**
 * The document picker. With `mediaId`, the client already sent a file and
 * picking a row attaches it instead of asking for it.
 */
async function sendDocumentList(phone, state, { k, mediaId, intro } = {}) {
  k ||= await loadCase(state.case_id)
  if (k.pending.length === 0) return sendCompletion(phone, state, k)

  // A list holds at most 10 rows; beyond that the last row links to the portal.
  const overflow = k.pending.length > 10
  const shown = overflow ? k.pending.slice(0, 9) : k.pending
  const sections = [['🔁 להעלאה מחדש', 0], ['חובה', 1], ['רשות', 2]]
    .map(([title, rank]) => ({ title, rows: shown.filter((d) => docRank(d) === rank).map((d) => docRow(d, mediaId)) }))
    .filter((s) => s.rows.length)
  if (overflow) {
    sections.push({ title: 'עוד', rows: [{ id: P.portal, title: `🌐 עוד ${k.pending.length - 9} מסמכים`, description: 'להמשך ההעלאה דרך האתר המאובטח' }] })
  }

  const body = mediaId
    ? `📥 *הקובץ התקבל.*\nלאיזה מסמך הוא שייך? יש לבחור מהרשימה 👇`
    : [
        intro || `${greeting(k)}\nבקשת מסמכים: *${k.title}*`,
        progressLine(k),
        `נותרו *${k.pending.length}* מסמכים. יש לבחור מסמך מהרשימה ולשלוח אותו כאן בצ'אט 👇`,
      ].join('\n\n')
  return replyList(phone, state, { header: k.wsName || 'מסמכים להעלאה', body, button: '📋 בחירת מסמך', sections })
}

/** Entry point for "upload documents": the Flow form when enabled, else the chat list. */
async function openUpload(phone, state) {
  if (!flowEnabled()) return sendDocumentList(phone, state)
  const k = await loadCase(state.case_id)
  if (k.pending.length === 0) return sendCompletion(phone, state, k)
  const body = `${greeting(k)}\nבקשת מסמכים: *${k.title}*\n${progressLine(k)}\n\nבלחיצה על הכפתור ייפתח טופס מאובטח: מסך לכל מסמך, עם צילום או צירוף קובץ.`
  return send(phone, flowMessagePayload({ caseId: state.case_id, phone, header: k.wsName, body, footer: T.footer }), state, 'interactive_flow', body)
}

/** The client submitted the Flow; files are still being stored in the background. */
async function handleFlowCompleted(phone) {
  const state = await getState(phone)
  if (!state) return
  await logMessage(state, 'inbound', phone, 'flow_reply', 'Flow completed')
  return replyButtons(phone, state, {
    header: '✅ הטופס נשלח',
    body: 'תודה! המסמכים בדרך למשרד.\nאם משהו לא יעבור, נעדכן כאן בצ\'אט.',
    buttons: [BTN.status, BTN.support],
  })
}

async function sendStatus(phone, state) {
  const k = await loadCase(state.case_id)
  const groups = { approved: [], uploaded: [], rejected: [], missing: [] }
  for (const d of k.docs) groups[canonicalDocStatus(d.status)].push(d.name)
  const block = (icon, label, names) => names.length ? `${icon} *${label} (${names.length})*\n${names.map((n) => `   • ${n}`).join('\n')}` : ''
  const body = [
    `*${k.title}*\n${progressLine(k)}`,
    block('✅', 'אושרו', groups.approved),
    block('🕓', 'בבדיקה', groups.uploaded),
    block('🔁', 'נדרשים מחדש', groups.rejected),
    block('⏳', 'חסרים', groups.missing),
  ].filter(Boolean).join('\n\n')
  return replyButtons(phone, state, {
    header: '📊 סטטוס המסמכים',
    body,
    buttons: k.pending.length ? [BTN.docs, BTN.support] : [BTN.support],
  })
}

async function sendCompletion(phone, state, k, prefix) {
  const team = k.wsName ? `הצוות של ${k.wsName}` : 'הצוות'
  const body = [
    prefix,
    `תודה${k.firstName ? ` ${k.firstName}` : ''}! כל המסמכים עבור *${k.title}* התקבלו.`,
    `${team} יעבור עליהם, ואם יידרש משהו נוסף נעדכן כאן.`,
  ].filter(Boolean).join('\n\n')
  return replyButtons(phone, state, { header: '🎉 הכול התקבל!', body, buttons: [BTN.status, BTN.support] })
}

async function sendPortalLink(phone, state, body) {
  return replyLink(phone, state, { body, label: '🌐 פתיחת הפורטל', url: await portalUrl(state.case_id) })
}

// ── documents ──────────────────────────────────────────────
const isUuid = (s) => /^[0-9a-f-]{36}$/i.test(s)

async function findDocument(caseId, docId) {
  if (!isUuid(docId)) return null
  return queryOne(
    `SELECT ${DOC_FIELDS} FROM case_documents cd LEFT JOIN document_types dt ON dt.id = cd.document_type_id
      WHERE cd.id = $1 AND cd.case_id = $2`,
    [docId, caseId],
  )
}

async function handleDocumentSelected(phone, state, docId) {
  const doc = await findDocument(state.case_id, docId)
  if (!doc) return sendDocumentList(phone, state, { intro: '❌ המסמך לא נמצא. אפשר לבחור מהרשימה המעודכנת:' })
  if (canonicalDocStatus(doc.status) === 'approved') {
    return sendDocumentList(phone, state, { intro: `✅ *${doc.name}* כבר אושר, אין צורך לשלוח אותו שוב.` })
  }
  await setAwaiting(phone, doc.id, doc.name)
  const body = [
    `*${doc.name}*`,
    doc.rejection_reason && canonicalDocStatus(doc.status) === 'rejected' ? `❗ *המסמך הקודם לא התקבל:*\n${doc.rejection_reason}` : '',
    doc.case_notes ? `📝 *הערה מהמשרד:*\n${doc.case_notes}` : '',
    doc.helper_text ? `ℹ️ ${doc.helper_text}` : '',
    `אפשר לשלוח עכשיו ${formatsText(doc.allowed_formats)} כאן בצ'אט.\n${T.photoTip}`,
  ].filter(Boolean).join('\n\n')
  return replyButtons(phone, state, { header: '📎 העלאת מסמך', body, buttons: [BTN.otherDoc, BTN.cancel] })
}

const UPLOAD_ERRORS = {
  file_type_not_allowed: '❌ סוג הקובץ לא מתאים למסמך הזה.',
  unsupported_file_type: '❌ סוג הקובץ לא נתמך. אפשר לשלוח תמונה או PDF.',
  file_too_large: '❌ הקובץ גדול מדי. אפשר לנסות קובץ קטן יותר.',
  empty_file: '❌ הקובץ ריק. אפשר לנסות לשלוח שוב.',
}

/** Download a client's media and store it on a document slot. */
async function uploadMedia(phone, state, doc, media, fileName) {
  const file = await downloadMedia(media.id)
  if (!file) {
    return replyButtons(phone, state, { body: '❌ לא הצלחנו לקבל את הקובץ. אפשר לנסות לשלוח שוב.', buttons: [BTN.otherDoc, BTN.cancel] })
  }
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'application/pdf': 'pdf' }[file.mimeType] || 'bin'
  try {
    await ingestUpload({
      workspaceId: state.workspace_id,
      caseId: state.case_id,
      caseDocumentId: doc.id,
      buffer: file.buffer,
      fileName: fileName || `${doc.name || 'document'}.${ext}`,
      via: 'whatsapp',
      actor: { type: 'client' },
    })
  } catch (err) {
    logger.warn('wa_upload_rejected', { code: err.code })
    if (err.code === 'request_closed' || err.code === 'already_approved') {
      await setAwaiting(phone, null, null)
      return reply(phone, err.code === 'request_closed'
        ? '🔒 הבקשה הזו כבר נסגרה. לשאלות אפשר לכתוב *תמיכה*.'
        : `✅ *${doc.name}* כבר אושר, אין צורך לשלוח אותו שוב.`, state)
    }
    // Keep waiting for this document so the client can simply resend.
    await setAwaiting(phone, doc.id, doc.name)
    const msg = UPLOAD_ERRORS[err.code] || '❌ שגיאה בעיבוד הקובץ. אפשר לנסות לשלוח שוב.'
    return replyButtons(phone, state, { body: `${msg}\n\nהמסמך: *${doc.name}*`, buttons: [BTN.otherDoc, BTN.cancel] })
  }
  await logMessage(state, 'inbound', phone, 'media', `Uploaded: ${doc.name}`, null, { docId: doc.id })
  await setAwaiting(phone, null, null)
  return afterUpload(phone, state, doc.name)
}

async function afterUpload(phone, state, docName) {
  const k = await loadCase(state.case_id)
  if (k.pending.length === 0) return sendCompletion(phone, state, k, `✅ *${docName}* התקבל.`)
  const next = k.pending[0]
  return replyButtons(phone, state, {
    body: `✅ *${docName}* התקבל, תודה!\n\n${progressLine(k)}\n\nהבא בתור: *${next.name}*`,
    buttons: [[`upload_${next.id}`, '⬆️ להעלות אותו'], BTN.allDocs, BTN.later],
  })
}

async function handleMedia(phone, media, fileName) {
  const state = await getState(phone)
  if (!state) return reply(phone, T.noCase)
  if (state.awaiting_document_id) {
    return uploadMedia(phone, state, { id: state.awaiting_document_id, name: state.awaiting_document_name }, media, fileName)
  }
  // A file sent without picking a document first.
  const k = await loadCase(state.case_id)
  if (k.pending.length === 0) return sendCompletion(phone, state, k)
  if (k.pending.length === 1) return uploadMedia(phone, state, k.pending[0], media, fileName)
  return sendDocumentList(phone, state, { k, mediaId: media.id })
}

/** List-row id `attach_<docId>_<mediaId>`: store a file the client sent before picking. */
async function attachMedia(phone, state, rest) {
  const doc = await findDocument(state.case_id, rest.slice(0, 36))
  const mediaId = rest.slice(37)
  if (!doc || !/^\d+$/.test(mediaId)) return sendDocumentList(phone, state)
  return uploadMedia(phone, state, doc, { id: mediaId }, null)
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
  await replyButtons(phone, state, { header: '💬 שיחה עם הצוות', body: T.supportIntro, buttons: [BTN.backToMenu] })
  publish(state.workspace_id, 'support', { caseId: state.case_id })
}

async function exitSupport(phone) {
  await query('UPDATE whatsapp_conversation_state SET support_mode = false, support_request_id = NULL, updated_at = now() WHERE phone_number = $1', [phone])
}

async function relayToSupport(phone, state, text, messageId) {
  const sr = await queryOne('SELECT id FROM support_requests WHERE id = $1', [state.support_request_id])
  if (!sr) {
    await exitSupport(phone)
    return showMenu(phone, state, '⚠️ השיחה הקודמת הסתיימה. חזרנו לתפריט הראשי.')
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
  if (!prior) await replyButtons(phone, state, { body: T.supportSent, buttons: [BTN.backToMenu] })
}

// ── inbound routing ────────────────────────────────────────
async function handleText(phone, text, messageId) {
  const normalized = text.trim().toLowerCase()
  const state = await getState(phone)

  if (state?.support_mode && BACK_WORDS.includes(normalized)) {
    await exitSupport(phone)
    return showMenu(phone, state, '↩️ חזרנו לתפריט הראשי.')
  }
  if (state?.support_mode && state.support_request_id) return relayToSupport(phone, state, text.trim(), messageId)
  if (!state) return reply(phone, T.noCase)

  if (SUPPORT_WORDS.includes(normalized)) return enterSupport(phone, state)
  if (STATUS_WORDS.includes(normalized)) return sendStatus(phone, state)
  if (LIST_WORDS.includes(normalized)) return sendDocumentList(phone, state)
  if (CANCEL_WORDS.includes(normalized) && state.awaiting_document_id) {
    await setAwaiting(phone, null, null)
    return showMenu(phone, state, '✖️ ההעלאה בוטלה.')
  }
  if (state.awaiting_document_id && !MENU_WORDS.includes(normalized)) {
    return replyButtons(phone, state, {
      body: `📎 מחכים לקובץ עבור *${state.awaiting_document_name}*.\nאפשר לשלוח תמונה 📷 או קובץ PDF 📄.`,
      buttons: [BTN.otherDoc, BTN.cancel, BTN.support],
    })
  }
  return showMenu(phone, state)
}

async function handlePayload(phone, id) {
  // Template and older buttons carry the case id; they also (re)bind the conversation.
  if (id.startsWith('show_docs_')) {
    const state = await authorizeCase(phone, id.slice('show_docs_'.length))
    if (state) await openUpload(phone, state)
    return
  }
  if (id.startsWith('support_')) {
    const state = await authorizeCase(phone, id.slice('support_'.length))
    if (state) await enterSupport(phone, state)
    return
  }

  let state = await getState(phone)
  if (!state) return reply(phone, T.noCase)
  if (state.support_mode && id !== P.support) {
    await exitSupport(phone)
    state = { ...state, support_mode: false, support_request_id: null }
  }

  if (id.startsWith('upload_')) return handleDocumentSelected(phone, state, id.slice('upload_'.length))
  if (id.startsWith('attach_')) return attachMedia(phone, state, id.slice('attach_'.length))
  switch (id) {
    case P.docs: return openUpload(phone, state)
    case P.status: return sendStatus(phone, state)
    case P.support: return state.support_mode ? undefined : enterSupport(phone, state)
    case P.exitSupport: return showMenu(phone, state, '↩️ חזרנו לתפריט הראשי.')
    case P.cancel:
      await setAwaiting(phone, null, null)
      return showMenu(phone, state, '✖️ ההעלאה בוטלה.')
    case P.later:
      return sendPortalLink(phone, state, 'אין בעיה 👌\nאפשר לחזור לכאן בכל זמן ולכתוב *תפריט*, או להמשיך מהמחשב דרך הקישור המאובטח.')
    case P.portal:
      return sendPortalLink(phone, state, 'אפשר להעלות את כל המסמכים גם דרך האתר המאובטח:')
    default:
      logger.info('wa_unknown_payload', { id: id.slice(0, 40) })
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
      if (i?.type === 'nfm_reply') return handleFlowCompleted(phone)
      const id = i?.type === 'button_reply' ? i.button_reply?.id : i?.type === 'list_reply' ? i.list_reply?.id : null
      return id ? handlePayload(phone, id) : undefined
    }
    case 'button':
      return handlePayload(phone, msg.button?.payload || '')
    case 'image':
    case 'document':
      return handleMedia(phone, msg[msg.type], msg[msg.type]?.filename || null)
    case 'text':
      return handleText(phone, msg.text?.body || '', msg.id)
    case 'audio':
    case 'video':
    case 'sticker':
    case 'location':
    case 'contacts':
      return reply(phone, T.unsupported, state)
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
