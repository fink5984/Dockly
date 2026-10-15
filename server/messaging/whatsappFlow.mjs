/**
 * WhatsApp Flow endpoint: the client fills a form inside WhatsApp, one
 * screen per missing document, instead of chatting with the bot.
 *
 * - One published Flow serves every request; the signed `flow_token`
 *   (case + phone + expiry) tells the endpoint which request is open.
 *   Nothing is created per request, so nothing has to be cleaned up: an
 *   expired token, a closed request or a finished one opens a closing screen.
 * - Uploaded media is acknowledged immediately (Meta expects < 1s) and
 *   downloaded, decrypted, merged and stored in the background through the
 *   same pipeline as the bot and the portal. Failures are reported in chat.
 * - Enabled with WHATSAPP_UPLOAD_MODE=flow (+ flow id and private key);
 *   otherwise the in-chat bot is used unchanged.
 */
import { createHmac } from 'crypto'
import { PDFDocument } from 'pdf-lib'
import { query, queryOne } from '../db/pool.mjs'
import { config } from '../config.mjs'
import { logger } from '../lib/logger.mjs'
import { safeEqual } from '../lib/crypto.mjs'
import { sendWhatsApp, textPayload, verifyWebhookSignature } from './whatsapp.mjs'
import { decryptFlowRequest, encryptFlowResponse, decryptFlowMedia, FlowCryptoError } from './flowCrypto.mjs'
import { FLOW_SCREENS as S } from './documentsFlow.mjs'
import { ingestUpload } from '../domain/requests.mjs'
import { NEEDS_UPLOAD, canonicalDocStatus } from '../domain/requestStatus.mjs'

const TOKEN_TTL_DAYS = 30

export function flowEnabled() {
  const wa = config.whatsapp
  return wa.uploadMode === 'flow' && Boolean(wa.flow.id && wa.flow.privateKey)
}

// ── flow_token ─────────────────────────────────────────────
const tokenSig = (body) => createHmac('sha256', `wa-flow:${config.sessionSecret}`).update(body).digest('base64url').slice(0, 32)

export function signFlowToken({ caseId, phone }, ttlDays = TOKEN_TTL_DAYS) {
  const exp = Math.floor(Date.now() / 1000) + ttlDays * 86400
  const body = Buffer.from(`${caseId}.${phone}.${exp}`).toString('base64url')
  return `${body}.${tokenSig(body)}`
}

/** @returns {{ caseId: string, phone: string } | null} */
export function verifyFlowToken(token) {
  if (typeof token !== 'string') return null
  const [body, sig] = token.split('.')
  if (!body || !sig || !safeEqual(sig, tokenSig(body))) return null
  const [caseId, phone, exp] = Buffer.from(body, 'base64url').toString('utf8').split('.')
  if (!caseId || !phone || !(Number(exp) * 1000 > Date.now())) return null
  return { caseId, phone }
}

// ── sending ────────────────────────────────────────────────
/** Interactive message that opens the Flow (inside the 24h window). */
export function flowMessagePayload({ caseId, phone, header, body, footer }) {
  return {
    type: 'interactive',
    interactive: {
      type: 'flow',
      ...(header ? { header: { type: 'text', text: header.slice(0, 60) } } : {}),
      body: { text: body.slice(0, 1024) },
      ...(footer ? { footer: { text: footer.slice(0, 60) } } : {}),
      action: {
        name: 'flow',
        parameters: {
          flow_message_version: '3',
          flow_id: config.whatsapp.flow.id,
          flow_token: signFlowToken({ caseId, phone }),
          flow_cta: 'העלאת מסמכים',
          flow_action: 'data_exchange',
        },
      },
    },
  }
}

/** Template button component that opens the Flow (business-initiated). */
export const flowTemplateButton = ({ caseId, phone }, index = 0) => ({
  type: 'button', sub_type: 'flow', index: String(index),
  parameters: [{ type: 'action', action: { flow_token: signFlowToken({ caseId, phone }) } }],
})

// ── case data ──────────────────────────────────────────────
async function loadCase(caseId) {
  const c = await queryOne(
    `SELECT c.id, c.workspace_id, c.client_id, c.status, COALESCE(c.title, c.case_type) AS title,
            cl.name AS client_name, w.name AS ws_name
       FROM cases c JOIN clients cl ON cl.id = c.client_id JOIN workspaces w ON w.id = c.workspace_id WHERE c.id = $1`,
    [caseId],
  )
  if (!c) return null
  const docs = await query(
    `SELECT cd.id, cd.status, cd.is_required, cd.rejection_reason, cd.case_notes,
            COALESCE(cd.custom_name, dt.name, 'מסמך') AS name, dt.helper_text, dt.allowed_formats
       FROM case_documents cd LEFT JOIN document_types dt ON dt.id = cd.document_type_id
      WHERE cd.case_id = $1 ORDER BY cd.sort_order, cd.id`,
    [caseId],
  )
  return { ...c, firstName: String(c.client_name || '').trim().split(/\s+/)[0], docs }
}

const isPending = (d) => NEEDS_UPLOAD.has(d.status)

/** First pending document after `afterId` in request order (from the start when absent). */
function nextPending(k, afterId) {
  const from = afterId ? k.docs.findIndex((d) => d.id === afterId) + 1 : 0
  return k.docs.slice(from).find(isPending) || null
}

const STATUS_ICON = { approved: '✅', uploaded: '🕓', rejected: '🔁', missing: '⏳' }

function welcomeScreen(k) {
  const pending = k.docs.filter(isPending)
  const received = k.docs.length - pending.length
  return {
    screen: S.welcome,
    data: {
      heading: (k.ws_name || 'העלאת מסמכים').slice(0, 80),
      intro: `שלום ${k.firstName || ''} 👋\nבקשת מסמכים: **${k.title}**\nהתקבלו ${received} מתוך ${k.docs.length}. נותרו **${pending.length}** להעלאה.`,
      docs_text: k.docs.map((d) => `${STATUS_ICON[canonicalDocStatus(d.status)]} ${d.name}${d.is_required ? '' : ' (רשות)'}`).join('\n'),
    },
  }
}

function prefersFiles(doc) {
  const f = doc.allowed_formats?.length ? doc.allowed_formats : ['pdf', 'jpg', 'png']
  return !f.some((x) => ['jpg', 'jpeg', 'png'].includes(x))
}

function docScreen(k, doc, sentCount, screen) {
  const pending = k.docs.filter(isPending)
  const index = pending.findIndex((d) => d.id === doc.id)
  const details = [
    doc.rejection_reason && canonicalDocStatus(doc.status) === 'rejected' ? `❗ **המסמך הקודם לא התקבל:** ${doc.rejection_reason}` : '',
    doc.case_notes ? `📝 **הערה מהמשרד:** ${doc.case_notes}` : '',
    doc.helper_text ? `ℹ️ ${doc.helper_text}` : '',
    doc.is_required ? 'מסמך חובה.' : 'מסמך רשות, אפשר לדלג.',
  ].filter(Boolean).join('\n\n')
  return {
    screen: screen || (prefersFiles(doc) ? S.file : S.photo),
    data: {
      doc_id: doc.id,
      heading: doc.name.slice(0, 80),
      details,
      progress: `מסמך ${index + 1} מתוך ${pending.length}`,
      can_skip: !doc.is_required,
      sent_count: sentCount,
    },
  }
}

function doneScreen(heading, summary) {
  return { screen: S.done, data: { heading, summary } }
}

function finishedScreen(k, sentCount) {
  const pending = k.docs.filter(isPending)
  const sentNow = sentCount ? `נשלחו עכשיו **${sentCount}** מסמכים, והם בדרך למשרד.\n\n` : ''
  const rest = pending.length > sentCount
    ? `נשארו מסמכים שדילגת עליהם. אפשר לחזור לטופס בכל זמן מההודעה בצ'אט.`
    : `${k.ws_name ? `הצוות של ${k.ws_name}` : 'הצוות'} יעבור על המסמכים, ואם יידרש משהו נוסף נעדכן בוואטסאפ.`
  return doneScreen('🎉 תודה!', `${sentNow}${rest}`)
}

// ── routing ────────────────────────────────────────────────
async function routeFlow(p) {
  if (p.action === 'ping') return { data: { status: 'active' } }
  if (p.data?.error) {
    logger.warn('wa_flow_client_error', { error: p.data.error, message: String(p.data.error_message || '').slice(0, 200) })
    return { data: { acknowledged: true } }
  }

  const token = verifyFlowToken(p.flow_token)
  if (!token) return doneScreen('⌛ הקישור פג תוקף', 'אפשר לכתוב לנו כאן בצ\'אט ונשלח קישור חדש.')
  const k = await loadCase(token.caseId)
  if (!k) return doneScreen('הבקשה לא נמצאה', 'אפשר לפנות למשרד לקבלת קישור חדש.')
  if (k.status === 'closed') return doneScreen('🔒 הבקשה נסגרה', 'אין צורך להעלות מסמכים נוספים. לשאלות אפשר לכתוב לנו בצ\'אט.')

  const action = p.action === 'data_exchange' ? p.data?.action : null
  if (!action) {
    // INIT / BACK
    return k.docs.some(isPending) ? welcomeScreen(k) : doneScreen('✅ הכול התקבל', 'כל המסמכים בבקשה הזו כבר התקבלו. תודה!')
  }

  const sentCount = Number(p.data.sent_count) || 0
  const current = p.data.doc_id ? k.docs.find((d) => d.id === p.data.doc_id) : null
  const keepScreen = p.screen === S.file ? S.file : undefined
  const next = (afterId, sent) => {
    const doc = nextPending(k, afterId)
    return doc ? docScreen(k, doc, sent, keepScreen) : finishedScreen(k, sent)
  }

  switch (action) {
    case 'start':
      return next(null, 0)
    case 'use_file':
      return current ? docScreen(k, current, sentCount, S.file) : next(null, sentCount)
    case 'skip':
      return next(current?.id, sentCount)
    case 'upload': {
      const files = Array.isArray(p.data.photos) ? p.data.photos : Array.isArray(p.data.files) ? p.data.files : []
      if (!current) return next(null, sentCount)
      if (files.length === 0) {
        const again = docScreen(k, current, sentCount, p.screen === S.file ? S.file : S.photo)
        return { ...again, data: { ...again.data, error_message: 'יש לצרף לפחות קובץ אחד, או לדלג על מסמך רשות.' } }
      }
      processUpload({ k, doc: current, files, phone: token.phone }).catch((err) => logger.error('wa_flow_upload_failed', { err }))
      return next(current.id, sentCount + 1)
    }
    default:
      return welcomeScreen(k)
  }
}

// ── media ──────────────────────────────────────────────────
const CDN_HOST = /(^|\.)(whatsapp\.net|fbcdn\.net|fbsbx\.com|facebook\.com)$/

async function downloadFlowFile(file) {
  const url = new URL(file.cdn_url)
  if (url.protocol !== 'https:' || !CDN_HOST.test(url.hostname)) throw new FlowCryptoError('bad_cdn_host')
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) })
  if (!res.ok) throw new Error(`cdn_${res.status}`)
  return decryptFlowMedia(Buffer.from(await res.arrayBuffer()), file.encryption_metadata)
}

function sniff(buf) {
  if (buf.subarray(0, 4).toString('latin1') === '%PDF') return 'pdf'
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  return null
}

const A4_WIDTH = 595

/**
 * One file per document: a single file is kept as-is; several pages
 * (images and/or PDFs) are merged into one PDF in the order sent.
 * @returns {Promise<{ buffer: Buffer, ext: string, skipped: number }>}
 */
export async function combineFiles(buffers) {
  if (buffers.length === 1) return { buffer: buffers[0], ext: sniff(buffers[0]) || 'bin', skipped: 0 }
  const pdf = await PDFDocument.create()
  let skipped = 0
  for (const buf of buffers) {
    const kind = sniff(buf)
    try {
      if (kind === 'pdf') {
        const src = await PDFDocument.load(buf, { ignoreEncryption: true })
        for (const page of await pdf.copyPages(src, src.getPageIndices())) pdf.addPage(page)
      } else if (kind === 'jpg' || kind === 'png') {
        const img = kind === 'jpg' ? await pdf.embedJpg(buf) : await pdf.embedPng(buf)
        const scale = Math.min(1, A4_WIDTH / img.width)
        const page = pdf.addPage([img.width * scale, img.height * scale])
        page.drawImage(img, { x: 0, y: 0, width: img.width * scale, height: img.height * scale })
      } else {
        skipped++
      }
    } catch {
      skipped++
    }
  }
  if (pdf.getPageCount() === 0) return { buffer: buffers[0], ext: sniff(buffers[0]) || 'bin', skipped: buffers.length - 1 }
  return { buffer: Buffer.from(await pdf.save()), ext: 'pdf', skipped }
}

const UPLOAD_ERRORS = {
  file_type_not_allowed: 'סוג הקובץ לא מתאים למסמך הזה',
  unsupported_file_type: 'סוג הקובץ לא נתמך',
  file_too_large: 'הקובץ גדול מדי',
  empty_file: 'הקובץ ריק',
}

async function tell(phone, k, text) {
  const r = await sendWhatsApp(phone, textPayload(text))
  await query(
    `INSERT INTO whatsapp_messages (workspace_id, case_id, client_id, direction, phone_number, message_type, content, status, wa_message_id)
     VALUES ($1,$2,$3,'outbound',$4,'text',$5,$6,$7)`,
    [k.workspace_id, k.id, k.client_id, phone, text.slice(0, 2000), r.ok ? 'sent' : 'failed', r.messageId || null],
  ).catch((err) => logger.warn('wa_log_failed', { err }))
}

async function processUpload({ k, doc, files, phone }) {
  let combined
  try {
    const buffers = []
    for (const f of files.slice(0, 10)) buffers.push(await downloadFlowFile(f))
    combined = await combineFiles(buffers)
  } catch (err) {
    logger.warn('wa_flow_media_failed', { code: err.message })
    return tell(phone, k, `❌ לא הצלחנו לקבל את *${doc.name}*. אפשר לנסות שוב מהטופס, או לשלוח את הקובץ כאן בצ'אט.`)
  }
  try {
    await ingestUpload({
      workspaceId: k.workspace_id,
      caseId: k.id,
      caseDocumentId: doc.id,
      buffer: combined.buffer,
      fileName: `${doc.name}.${combined.ext}`,
      via: 'whatsapp',
      actor: { type: 'client' },
    })
  } catch (err) {
    logger.warn('wa_flow_upload_rejected', { code: err.code })
    const reason = UPLOAD_ERRORS[err.code] || 'שגיאה בעיבוד הקובץ'
    return tell(phone, k, `❌ *${doc.name}* לא נשמר: ${reason}. אפשר לנסות שוב מהטופס, או לשלוח את הקובץ כאן בצ'אט.`)
  }
  if (combined.skipped) {
    await tell(phone, k, `⚠️ ב*${doc.name}* היו ${combined.skipped} קבצים בפורמט שלא הצלחנו לצרף. אם חסר משהו, אפשר לשלוח אותו שוב.`)
  }
}

// ── Express handler ────────────────────────────────────────
export async function handleFlowRequest(req, res) {
  if (!flowEnabled()) return res.sendStatus(404)
  if (!verifyWebhookSignature(req.rawBody, req.get('x-hub-signature-256'))) return res.sendStatus(432)
  let decrypted
  try {
    decrypted = decryptFlowRequest(req.body, config.whatsapp.flow.privateKey)
  } catch (err) {
    logger.warn('wa_flow_decrypt_failed', { code: err.message })
    return res.sendStatus(421) // client refetches our public key and retries
  }
  let response
  try {
    response = await routeFlow(decrypted.payload)
  } catch (err) {
    logger.error('wa_flow_route_failed', { err })
    response = doneScreen('משהו השתבש', 'אפשר לנסות שוב בעוד רגע, או לשלוח את המסמכים כאן בצ\'אט.')
  }
  res.type('text/plain').send(encryptFlowResponse(response, decrypted.aesKey, decrypted.iv))
}
