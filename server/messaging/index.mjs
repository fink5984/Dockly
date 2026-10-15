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
import { flowEnabled, flowTemplateButton } from './whatsappFlow.mjs'
import { sendEmail, renderEmail, emailStatus } from './email.mjs'
import { recomputeRequestStatus } from '../domain/requests.mjs'
import { NEEDS_UPLOAD, canonicalDocStatus } from '../domain/requestStatus.mjs'
import { logoUrlOf } from '../routes/workspace.mjs'
import { messagingAllowed } from '../billing/access.mjs'

// Client messages (WhatsApp costs money) aren't sent from read-only workspaces (trial ended, suspended, cancelled).
const INACTIVE = Object.freeze({ ok: false, code: 'subscription_inactive', error: 'Messages are paused until the workspace has an active plan' })

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
    hello: (n) => `Hi ${n},`,
    count: (n) => (n === 1 ? 'one document' : `${n} documents`),
    missing: (n) => (n === 1 ? 'One document is still missing' : `${n} documents are still missing`),
    initial: {
      subject: (x) => `${x.ws}: documents needed for ${x.title}`,
      eyebrow: 'Document request',
      heading: (x) => `${x.ws} needs ${COPY.en.count(x.n)} from you`,
      body: (x) => `To move forward with **${x.title}**, please upload the documents below. It takes a few minutes, works from your phone and needs no account.`,
      preheader: (x) => `${COPY.en.count(x.n)} to upload · a few minutes from your phone`,
      cta: 'Upload documents',
      itemsTitle: 'What we need',
    },
    reminder: {
      subject: (x) => `Reminder: ${COPY.en.missing(x.n).toLowerCase()} for ${x.title}`,
      eyebrow: 'Reminder',
      heading: (x) => COPY.en.missing(x.n),
      body: (x) => `We're almost there with **${x.title}**. Only the documents below are left.`,
      preheader: (x) => `${COPY.en.missing(x.n)} · finish in a few minutes`,
      cta: 'Finish uploading',
      itemsTitle: 'Still missing',
    },
    rejected: {
      subject: (x) => `${x.ws}: a document needs to be replaced (${x.title})`,
      eyebrow: 'Action needed',
      heading: (x) => (x.r > 1 ? `${x.r} documents need to be replaced` : 'One document needs to be replaced'),
      body: (x) => `We reviewed what you sent for **${x.title}**. Below is what needs replacing and why; it only takes a minute.`,
      preheader: () => 'See what needs replacing and upload a new copy',
      cta: 'Upload a replacement',
      itemsTitle: 'What to replace',
    },
    notAccepted: (r) => `Not accepted: ${r}`,
    optional: 'Optional',
    more: (n) => `and ${n} more`,
    progress: (d, t) => `${d} of ${t} documents received`,
    deadline: (d) => `📅 Please upload by **${d}**`,
    trust: ['🔒 Secure upload', '📱 Works on your phone', '✋ No account needed'],
    sign: {
      subject: (ws) => `${ws} sent you a document to sign`,
      eyebrow: 'Signature request',
      reminderEyebrow: 'Reminder',
      heading: 'A document is waiting for your signature',
      body: (ws, title) => `**${ws}** asked you to review and sign **${title}**. Signing takes a minute and works from your phone.`,
      cta: 'Review and sign',
      trust: ['🔒 Secure signing', '📱 Works on your phone', '✋ No account needed'],
    },
    footer: (ws) => `This message was sent on behalf of **${ws}**. If you weren't expecting it, you can ignore it.`,
  },
  he: {
    hello: (n) => `שלום ${n},`,
    count: (n) => (n === 1 ? 'מסמך אחד' : `${n} מסמכים`),
    missing: (n) => (n === 1 ? 'חסר עוד מסמך אחד' : `חסרים עוד ${n} מסמכים`),
    initial: {
      subject: (x) => `${x.ws} | בקשת מסמכים: ${x.title}`,
      eyebrow: 'בקשת מסמכים',
      heading: (x) => `נשמח לקבל ממך ${COPY.he.count(x.n)}`,
      body: (x) => `**${x.ws}** ביקשו ${COPY.he.count(x.n)} עבור **${x.title}**. ההעלאה לוקחת כמה דקות, עובדת מהטלפון ולא דורשת הרשמה.`,
      preheader: (x) => `${COPY.he.count(x.n)} להעלאה · כמה דקות מהטלפון`,
      cta: 'להעלאת המסמכים',
      itemsTitle: 'מה צריך להעלות',
    },
    reminder: {
      subject: (x) => `תזכורת: ${COPY.he.missing(x.n)} · ${x.title}`,
      eyebrow: 'תזכורת',
      heading: (x) => COPY.he.missing(x.n),
      body: (x) => `כדי להתקדם עם **${x.title}**, נשאר רק להעלות את ${x.n === 1 ? 'המסמך' : 'המסמכים'} שברשימה.`,
      preheader: (x) => `${COPY.he.missing(x.n)} · אפשר להשלים בכמה דקות מהטלפון`,
      cta: 'להשלמת המסמכים',
      itemsTitle: 'מה עוד חסר',
    },
    rejected: {
      subject: (x) => `${x.ws} | נדרשת החלפת מסמך · ${x.title}`,
      eyebrow: 'נדרש עדכון',
      heading: (x) => (x.r > 1 ? `${x.r} מסמכים צריכים החלפה` : 'אחד המסמכים צריך החלפה'),
      body: (x) => `עברנו על המסמכים ששלחת עבור **${x.title}**. ברשימה מופיע מה צריך להחליף ולמה, וזה לוקח רק דקה.`,
      preheader: () => 'מה צריך להחליף, ואיך מעלים מסמך חלופי',
      cta: 'להעלאת מסמך חלופי',
      itemsTitle: 'מה צריך להחליף',
    },
    notAccepted: (r) => `לא התקבל: ${r}`,
    optional: 'רשות',
    more: (n) => `ועוד ${n} מסמכים`,
    progress: (d, t) => `התקבלו ${d} מתוך ${t} מסמכים`,
    deadline: (d) => `📅 מועד אחרון להעלאה: **${d}**`,
    trust: ['🔒 העלאה מאובטחת', '📱 עובד מהטלפון', '✋ בלי הרשמה'],
    sign: {
      subject: (ws) => `${ws} שלחו לך מסמך לחתימה`,
      eyebrow: 'מסמך לחתימה',
      reminderEyebrow: 'תזכורת',
      heading: 'מסמך מחכה לחתימה שלך',
      body: (ws, title) => `**${ws}** ביקשו ממך לעיין ולחתום על **${title}**. החתימה לוקחת דקה ועובדת גם מהטלפון.`,
      cta: 'לעיון וחתימה',
      trust: ['🔒 חתימה מאובטחת', '📱 עובד מהטלפון', '✋ בלי הרשמה'],
    },
    footer: (ws) => `ההודעה נשלחה עבור **${ws}**. אם לא ציפית לה, אפשר להתעלם ממנה.`,
  },
}

const MAX_EMAIL_ITEMS = 8

/** Absolute logo URL for emails, when the workspace has one. */
function emailLogo(w) {
  const url = logoUrlOf({ id: w.ws_id, logo_url: w.logo_url, logo_storage_key: w.logo_storage_key, updated_at: w.ws_updated_at })
  if (!url) return undefined
  return url.startsWith('/') ? `${config.appBaseUrl}${url}` : url
}

/** Subject + rendered body for a request email (initial, reminder or rejection notice). */
export function buildRequestEmail({ c, docs, kind, lang, url }) {
  const copy = COPY[lang]
  const variant = kind === 'request_reminder' ? copy.reminder : kind === 'document_rejected' ? copy.rejected : copy.initial
  const pending = docs.filter((d) => NEEDS_UPLOAD.has(d.status))
  const rejected = pending.filter((d) => canonicalDocStatus(d.status) === 'rejected')
  const listed = kind === 'document_rejected' && rejected.length ? rejected : pending
  const x = { ws: c.ws_name, title: c.title, n: pending.length, r: rejected.length }

  const items = listed.slice(0, MAX_EMAIL_ITEMS).map((d) => {
    const isRejected = canonicalDocStatus(d.status) === 'rejected'
    return {
      title: d.name,
      note: isRejected ? copy.notAccepted(d.rejection_reason || '—') : d.is_required ? '' : copy.optional,
      tone: isRejected ? 'warn' : undefined,
    }
  })
  if (listed.length > MAX_EMAIL_ITEMS) items.push({ title: copy.more(listed.length - MAX_EMAIL_ITEMS) })

  const received = docs.length - pending.length
  const rendered = renderEmail({
    language: lang,
    brandName: c.ws_name,
    brandColor: c.brand_color || undefined,
    logoUrl: emailLogo(c),
    eyebrow: variant.eyebrow,
    heading: variant.heading(x),
    preheader: variant.preheader(x),
    paragraphs: [copy.hello(c.client_name), variant.body(x)],
    progress: kind !== 'request_initial' && received > 0 ? { done: received, total: docs.length, label: copy.progress(received, docs.length) } : undefined,
    itemsTitle: variant.itemsTitle,
    items,
    meta: c.deadline ? [copy.deadline(new Date(c.deadline).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-GB', { timeZone: 'Asia/Jerusalem' }))] : [],
    ctaLabel: variant.cta,
    ctaUrl: url,
    trust: copy.trust,
    footer: copy.footer(c.ws_name),
  })
  return { subject: variant.subject(x), ...rendered }
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
  if (!(await messagingAllowed(p.workspaceId))) return INACTIVE
  const c = await queryOne(
    `SELECT c.id, c.workspace_id, c.client_id, c.status, c.sent_at, COALESCE(c.title, c.case_type) AS title, c.language,
            cl.name AS client_name, cl.phone AS client_phone, cl.email AS client_email,
            c.deadline, w.name AS ws_name, w.default_language, w.brand_color,
            w.id AS ws_id, w.logo_url, w.logo_storage_key, w.updated_at AS ws_updated_at
       FROM cases c JOIN clients cl ON cl.id = c.client_id JOIN workspaces w ON w.id = c.workspace_id
      WHERE c.id = $1 AND c.workspace_id = $2`,
    [p.caseId, p.workspaceId],
  )
  if (!c) return { ok: false, code: 'request_not_found' }
  const docs = await query(
    `SELECT cd.status, cd.is_required, cd.rejection_reason, COALESCE(cd.custom_name, dt.name, 'Document') AS name
       FROM case_documents cd LEFT JOIN document_types dt ON dt.id = cd.document_type_id
      WHERE cd.case_id = $1 ORDER BY cd.sort_order, cd.id`,
    [p.caseId],
  )
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
    // Template contract (approved in Meta): {{1}} client name, {{2}} pending count, {{3}} title.
    // Chat mode: quick-reply button 0 payload opens the in-chat document list.
    // Flow mode: one FLOW template for every kind; its button opens the upload form.
    const params = [c.client_name, String(pending), c.title]
    let flowTemplate = flowEnabled() && config.whatsapp.flow.template
    if (flowTemplate) {
      result = await sendWhatsApp(recipient, templatePayload(flowTemplate, config.whatsapp.flow.templateLang, params, [], [flowTemplateButton({ caseId: c.id, phone: recipient })]))
      // A missing / unapproved FLOW template must not cost the client their message.
      if (!result.ok) {
        logger.warn('wa_flow_template_failed', { template: flowTemplate, error: result.error })
        flowTemplate = ''
      }
    }
    if (!flowTemplate) result = await sendWhatsApp(recipient, templatePayload(template, t.lang, params, [`show_docs_${c.id}`]))
    await query(
      `INSERT INTO whatsapp_messages (workspace_id, case_id, client_id, direction, phone_number, message_type, content, status, wa_message_id, template_name, error_message, metadata)
       VALUES ($1,$2,$3,'outbound',$4,'template',$5,$6,$7,$8,$9,$10)`,
      [p.workspaceId, c.id, c.client_id, recipient, `${p.kind}: ${c.title}`, result.ok ? (result.simulated ? 'pending' : 'sent') : 'failed',
        result.messageId || null, flowTemplate || template, result.ok ? null : result.error, JSON.stringify({ kind: p.kind, pending, deliveryId })],
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
    const { subject, html, text } = buildRequestEmail({ c, docs, kind: p.kind, lang, url: `${config.appBaseUrl}/p/${token}` })
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
  if (!(await messagingAllowed(p.workspaceId))) return INACTIVE
  const r = await queryOne(
    `SELECT s.id, s.workspace_id, s.client_id, s.title, s.public_token, s.language, s.status,
            cl.name AS client_name, cl.phone AS client_phone, cl.email AS client_email,
            w.name AS ws_name, w.default_language, w.brand_color,
            w.id AS ws_id, w.logo_url, w.logo_storage_key, w.updated_at AS ws_updated_at
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
      language: lang, brandName: r.ws_name, brandColor: r.brand_color || undefined, logoUrl: emailLogo(r),
      eyebrow: p.kind === 'signature_reminder' ? copy.sign.reminderEyebrow : copy.sign.eyebrow,
      heading: copy.sign.heading,
      paragraphs: [copy.hello(r.client_name), copy.sign.body(r.ws_name, r.title)],
      ctaLabel: copy.sign.cta, ctaUrl: link, trust: copy.sign.trust, footer: copy.footer(r.ws_name),
    })
    result = await sendEmail({ to: recipient, subject: copy.sign.subject(r.ws_name), html, text })
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
