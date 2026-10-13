/**
 * Outbound client communication: request invitations, reminders, rejection
 * notices and signature requests over WhatsApp or email.
 *
 * Every send creates a message_deliveries row first. An idempotency key
 * (unique) makes retries and scheduled reminders safe: the same logical
 * message is never sent twice. Status only advances to `accepted` when the
 * provider accepted the message; `delivered`/`read` arrive later via webhook.
 */
import { query, queryOne } from '../db/pool.mjs'
import { config } from '../config.mjs'
import { randomToken } from '../lib/crypto.mjs'
import { logActivity } from '../lib/activity.mjs'
import { publish } from '../lib/events.mjs'
import { logger } from '../lib/logger.mjs'
import { normalizePhone } from './phone.mjs'
import { sendWhatsApp, templatePayload, whatsappStatus } from './whatsapp.mjs'
import { sendEmail, renderEmail, emailStatus } from './email.mjs'
import { recomputeRequestStatus } from '../domain/requests.mjs'
import { NEEDS_UPLOAD } from '../domain/requestStatus.mjs'

export function channelStatus() {
  return { whatsapp: whatsappStatus(), email: emailStatus() }
}

async function createDelivery(d) {
  const row = await queryOne(
    `INSERT INTO message_deliveries
       (workspace_id, channel, kind, case_id, signature_request_id, client_id, recipient, status, idempotency_key, triggered_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'queued',$8,$9)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [d.workspaceId, d.channel, d.kind, d.caseId || null, d.signatureRequestId || null, d.clientId || null, d.recipient, d.idempotencyKey || null, d.triggeredBy || 'user'],
  )
  return row?.id || null
}

async function finishDelivery(id, result) {
  await query(
    `UPDATE message_deliveries SET status = $2, provider_message_id = $3, error = $4, attempts = attempts + 1 WHERE id = $1`,
    [id, result.ok ? (result.simulated ? 'skipped' : 'accepted') : 'failed', result.messageId || null, result.ok ? (result.simulated ? 'simulated (WhatsApp not configured)' : null) : result.error || 'failed'],
  )
}

/** Ensure a request has a public portal token; returns it. */
export async function ensurePortalToken(caseId) {
  const row = await queryOne('SELECT public_token FROM cases WHERE id = $1', [caseId])
  if (row?.public_token) return row.public_token
  const token = randomToken(32)
  await query('UPDATE cases SET public_token = $2 WHERE id = $1 AND public_token IS NULL', [caseId, token])
  return (await queryOne('SELECT public_token FROM cases WHERE id = $1', [caseId])).public_token
}

const COPY = {
  en: {
    initialSubject: (ws) => `${ws} needs a few documents from you`,
    reminderSubject: (ws) => `Reminder: documents for ${ws}`,
    rejectedSubject: (ws) => `${ws}: a document needs to be replaced`,
    hello: (n) => `Hi ${n},`,
    initialBody: (ws, title, n) => `${ws} asked you to upload ${n} document(s) for "${title}". It takes a few minutes and works from your phone — no account needed.`,
    reminderBody: (title, n) => `${n} document(s) for "${title}" are still missing.`,
    rejectedBody: (title) => `One of the documents you sent for "${title}" couldn't be accepted. Please open the link to see why and upload a replacement.`,
    cta: 'Upload documents',
    signSubject: (ws) => `${ws} sent you a document to sign`,
    signBody: (ws, title) => `${ws} asked you to review and sign "${title}".`,
    signCta: 'Review and sign',
    footer: 'Sent with Dockly. If you weren\'t expecting this, you can ignore it.',
  },
  he: {
    initialSubject: (ws) => `${ws} מבקשים ממך מספר מסמכים`,
    reminderSubject: (ws) => `תזכורת: מסמכים עבור ${ws}`,
    rejectedSubject: (ws) => `${ws}: יש להחליף מסמך`,
    hello: (n) => `שלום ${n},`,
    initialBody: (ws, title, n) => `${ws} ביקשו ממך להעלות ${n} מסמכים עבור "${title}". זה לוקח כמה דקות ועובד מהטלפון — בלי צורך בהרשמה.`,
    reminderBody: (title, n) => `עדיין חסרים ${n} מסמכים עבור "${title}".`,
    rejectedBody: (title) => `אחד המסמכים ששלחת עבור "${title}" לא התקבל. פתחו את הקישור כדי לראות את הסיבה ולהעלות מסמך חלופי.`,
    cta: 'להעלאת המסמכים',
    signSubject: (ws) => `${ws} שלחו לך מסמך לחתימה`,
    signBody: (ws, title) => `${ws} ביקשו ממך לעיין ולחתום על "${title}".`,
    signCta: 'לעיון וחתימה',
    footer: 'נשלח באמצעות Dockly. אם לא ציפית להודעה זו, ניתן להתעלם ממנה.',
  },
}

/**
 * Send a request-related message to the request's client.
 * @param {object} p
 * @param {string} p.workspaceId
 * @param {string} p.caseId
 * @param {'request_initial'|'request_reminder'|'document_rejected'} p.kind
 * @param {'whatsapp'|'email'} [p.channel]
 * @param {'user'|'automation'} [p.triggeredBy]
 * @param {{ id: string, name: string }} [p.actor]
 * @param {string} [p.idempotencyKey]
 * @returns {Promise<{ ok: boolean, code?: string, error?: string, deliveryId?: string, simulated?: boolean }>}
 */
export async function sendRequestMessage(p) {
  const c = await queryOne(
    `SELECT c.id, c.workspace_id, c.client_id, c.status, c.sent_at, COALESCE(c.title, c.case_type) AS title, c.language,
            cl.name AS client_name, cl.phone AS client_phone, cl.email AS client_email,
            w.name AS ws_name, w.default_language, w.brand_color
       FROM cases c JOIN clients cl ON cl.id = c.client_id JOIN workspaces w ON w.id = c.workspace_id
      WHERE c.id = $1 AND c.workspace_id = $2`,
    [p.caseId, p.workspaceId],
  )
  if (!c) return { ok: false, code: 'request_not_found' }
  const docs = await query('SELECT status, is_required FROM case_documents WHERE case_id = $1', [p.caseId])
  const pending = docs.filter((d) => NEEDS_UPLOAD.has(d.status)).length
  const channel = p.channel || 'whatsapp'
  const lang = c.language === 'he' || c.language === 'en' ? c.language : c.default_language === 'he' ? 'he' : 'en'

  let recipient
  if (channel === 'whatsapp') {
    recipient = normalizePhone(c.client_phone)
    if (!recipient) return { ok: false, code: 'invalid_phone', error: 'The client has no valid phone number' }
  } else {
    if (!emailStatus().configured) return { ok: false, code: 'email_not_configured', error: 'Email sending is not configured' }
    recipient = c.client_email
    if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return { ok: false, code: 'invalid_email', error: 'The client has no valid email address' }
  }

  const deliveryId = await createDelivery({
    workspaceId: p.workspaceId, channel, kind: p.kind, caseId: p.caseId, clientId: c.client_id,
    recipient, idempotencyKey: p.idempotencyKey, triggeredBy: p.triggeredBy,
  })
  if (!deliveryId) return { ok: false, code: 'duplicate', error: 'This message was already sent' }

  let result
  if (channel === 'whatsapp') {
    const t = config.whatsapp.templates
    const template = p.kind === 'request_reminder' ? t.documentReminder : p.kind === 'document_rejected' ? t.documentRejected : t.documentRequest
    // Template contract (approved in Meta): {{1}} client name, {{2}} pending count, {{3}} title;
    // quick-reply button 0 payload opens the in-chat document list.
    result = await sendWhatsApp(recipient, templatePayload(template, t.lang, [c.client_name, String(pending), c.title], [`show_docs_${c.id}`]))
    await query(
      `INSERT INTO whatsapp_messages (workspace_id, case_id, client_id, direction, phone_number, message_type, content, status, wa_message_id, template_name, error_message, metadata)
       VALUES ($1,$2,$3,'outbound',$4,'template',$5,$6,$7,$8,$9,$10)`,
      [p.workspaceId, c.id, c.client_id, recipient, `${p.kind}: ${c.title}`, result.ok ? (result.simulated ? 'pending' : 'sent') : 'failed',
        result.messageId || null, template, result.ok ? null : result.error, JSON.stringify({ kind: p.kind, pending, deliveryId })],
    )
    if (result.ok) {
      await query(
        `INSERT INTO whatsapp_conversation_state (phone_number, case_id, client_id, workspace_id, awaiting_document_id, awaiting_document_name, updated_at)
         VALUES ($1,$2,$3,$4,NULL,NULL,now())
         ON CONFLICT (phone_number) DO UPDATE SET case_id = EXCLUDED.case_id, client_id = EXCLUDED.client_id,
           workspace_id = EXCLUDED.workspace_id, awaiting_document_id = NULL, awaiting_document_name = NULL, updated_at = now()`,
        [recipient, c.id, c.client_id, p.workspaceId],
      )
    }
  } else {
    const token = await ensurePortalToken(c.id)
    const copy = COPY[lang]
    const subject = p.kind === 'request_reminder' ? copy.reminderSubject(c.ws_name) : p.kind === 'document_rejected' ? copy.rejectedSubject(c.ws_name) : copy.initialSubject(c.ws_name)
    const body = p.kind === 'request_reminder' ? copy.reminderBody(c.title, pending) : p.kind === 'document_rejected' ? copy.rejectedBody(c.title) : copy.initialBody(c.ws_name, c.title, pending)
    const { html, text } = renderEmail({
      language: lang, brandName: c.ws_name, brandColor: c.brand_color || undefined, heading: subject,
      paragraphs: [copy.hello(c.client_name), body], ctaLabel: copy.cta, ctaUrl: `${config.appBaseUrl}/p/${token}`, footer: copy.footer,
    })
    result = await sendEmail({ to: recipient, subject, html, text })
  }

  await finishDelivery(deliveryId, result)

  if (result.ok) {
    if (p.kind === 'request_initial' || !c.sent_at) {
      await query('UPDATE cases SET sent_at = COALESCE(sent_at, now()) WHERE id = $1', [c.id])
      await recomputeRequestStatus({ query, queryOne }, c.id)
    }
    if (p.kind === 'request_reminder') {
      await query('UPDATE cases SET last_reminder_at = now(), reminder_count = reminder_count + 1 WHERE id = $1', [c.id])
    }
  }

  await logActivity({
    workspaceId: p.workspaceId,
    type: p.kind === 'request_reminder' ? 'reminder_sent' : p.kind === 'document_rejected' ? 'rejection_notice_sent' : 'request_sent',
    description: result.ok ? `${channel} message ${result.simulated ? 'simulated' : 'accepted'}` : `${channel} message failed: ${result.error}`,
    actor: p.triggeredBy === 'automation' ? { type: 'system', name: 'Automation' } : { type: 'user', id: p.actor?.id, name: p.actor?.name },
    clientId: c.client_id,
    clientName: c.client_name,
    caseId: c.id,
    metadata: { channel, ok: result.ok, simulated: Boolean(result.simulated), deliveryId },
  })
  publish(p.workspaceId, 'requests', { caseId: c.id })

  if (!result.ok) return { ok: false, code: 'send_failed', error: result.error, deliveryId }
  return { ok: true, deliveryId, simulated: Boolean(result.simulated) }
}

/**
 * Send a signing invitation or reminder.
 * WhatsApp requires an approved template (WA_TEMPLATE_SIGNATURE_REQUEST with
 * {{1}} name, {{2}} title, {{3}} link); without it only email/link apply.
 */
export async function sendSignatureMessage(p) {
  const r = await queryOne(
    `SELECT s.id, s.workspace_id, s.client_id, s.title, s.public_token, s.language, s.status,
            cl.name AS client_name, cl.phone AS client_phone, cl.email AS client_email,
            w.name AS ws_name, w.default_language, w.brand_color
       FROM signature_requests s JOIN clients cl ON cl.id = s.client_id JOIN workspaces w ON w.id = s.workspace_id
      WHERE s.id = $1 AND s.workspace_id = $2 AND s.deleted_at IS NULL`,
    [p.requestId, p.workspaceId],
  )
  if (!r) return { ok: false, code: 'not_found' }
  if (!['pending', 'viewed'].includes(r.status)) return { ok: false, code: 'not_pending', error: 'This request is not awaiting a signature' }
  const lang = r.language === 'he' || r.language === 'en' ? r.language : r.default_language === 'he' ? 'he' : 'en'
  const link = `${config.appBaseUrl}/sign/${r.public_token}`
  const channel = p.channel || 'email'

  let recipient
  if (channel === 'whatsapp') {
    if (!config.whatsapp.templates.signatureRequest) return { ok: false, code: 'whatsapp_template_missing', error: 'No approved WhatsApp template for signature requests is configured' }
    recipient = normalizePhone(r.client_phone)
    if (!recipient) return { ok: false, code: 'invalid_phone', error: 'The client has no valid phone number' }
  } else {
    if (!emailStatus().configured) return { ok: false, code: 'email_not_configured', error: 'Email sending is not configured' }
    recipient = r.client_email
    if (!recipient) return { ok: false, code: 'invalid_email', error: 'The client has no email address' }
  }

  const deliveryId = await createDelivery({
    workspaceId: p.workspaceId, channel, kind: p.kind, signatureRequestId: r.id, clientId: r.client_id,
    recipient, idempotencyKey: p.idempotencyKey, triggeredBy: p.triggeredBy,
  })
  if (!deliveryId) return { ok: false, code: 'duplicate' }

  let result
  if (channel === 'whatsapp') {
    result = await sendWhatsApp(recipient, templatePayload(config.whatsapp.templates.signatureRequest, config.whatsapp.templates.lang, [r.client_name, r.title, link]))
  } else {
    const copy = COPY[lang]
    const { html, text } = renderEmail({
      language: lang, brandName: r.ws_name, brandColor: r.brand_color || undefined, heading: copy.signSubject(r.ws_name),
      paragraphs: [copy.hello(r.client_name), copy.signBody(r.ws_name, r.title)], ctaLabel: copy.signCta, ctaUrl: link, footer: copy.footer,
    })
    result = await sendEmail({ to: recipient, subject: copy.signSubject(r.ws_name), html, text })
  }
  await finishDelivery(deliveryId, result)
  if (result.ok && p.kind === 'signature_reminder') {
    await query('UPDATE signature_requests SET last_reminder_at = now(), reminder_count = reminder_count + 1 WHERE id = $1', [r.id])
  }
  publish(p.workspaceId, 'signatures', { id: r.id })
  if (!result.ok) return { ok: false, code: 'send_failed', error: result.error, deliveryId }
  return { ok: true, deliveryId, simulated: Boolean(result.simulated) }
}

/** Apply a provider status callback (WhatsApp `statuses` webhook). */
export async function applyDeliveryStatus(providerMessageId, status, error) {
  const map = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed' }
  const s = map[status]
  if (!s || !providerMessageId) return
  // Never move backwards (e.g. a late 'sent' after 'read').
  const rank = { queued: 0, skipped: 0, accepted: 1, sent: 2, delivered: 3, read: 4, failed: 5 }
  const rows = await query(
    `UPDATE message_deliveries SET status = $2, error = COALESCE($3, error)
      WHERE provider_message_id = $1 AND (CASE status ${Object.entries(rank).map(([k, v]) => `WHEN '${k}' THEN ${v}`).join(' ')} ELSE 0 END) < $4
      RETURNING workspace_id, case_id`,
    [providerMessageId, s, error || null, rank[s]],
  )
  await query('UPDATE whatsapp_messages SET status = $2, error_message = COALESCE($3, error_message) WHERE wa_message_id = $1', [providerMessageId, s, error || null])
  for (const r of rows) publish(r.workspace_id, 'requests', { caseId: r.case_id })
  if (rows.length === 0) logger.info('delivery_status_unmatched', { status: s })
}
