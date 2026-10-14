/**
 * Signature request lifecycle on the server.
 *
 * Integrity model (simple electronic signature — see SECURITY_REVIEW.md):
 *  - the original file's SHA-256 is recorded at creation
 *  - field values are validated server-side; the signer never uploads a PDF
 *  - the signed PDF is generated here, hashed, and stored under a new key
 *    (the original is never overwritten)
 *  - every lifecycle step is appended to signature_events, each entry
 *    hashing the previous one, so edits to history are detectable
 *  - a signing certificate PDF can be produced from the record at any time
 */
import { createHash } from 'crypto'
import { query, queryOne, withTransaction } from '../db/pool.mjs'
import { storage, keys } from '../storage.mjs'
import { badRequest, conflict, gone, notFound } from '../lib/http.mjs'
import { logActivity, notifyWorkspace } from '../lib/activity.mjs'
import { publish } from '../lib/events.mjs'
import { recordMilestone } from '../lib/funnel.mjs'
import { stampPdf, buildCertificate } from './pdf.mjs'

export const CONSENT_VERSION = '2026-10'
export const CONSENT_TEXT = {
  en: 'I agree to sign this document electronically, and I understand my electronic signature has the same intent as my handwritten signature.',
  he: 'אני מסכים/ה לחתום על מסמך זה באופן אלקטרוני, ומבין/ה שלחתימתי האלקטרונית אותה כוונה כמו לחתימה בכתב יד.',
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

/** JSON with recursively sorted keys (JSONB does not preserve key order). */
export function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`
  return JSON.stringify(v ?? null)
}

function canonical(e) {
  return stableStringify([e.request_id, e.event, e.actor, e.ip || null, e.user_agent || null, e.details || {}, e.created_at])
}

/** Append an event to the hash chain. Must run inside a transaction. */
export async function appendEvent(tx, { requestId, workspaceId, event, actor, ip = null, userAgent = null, details = {} }) {
  // Serialize writers per request so the chain stays linear.
  await tx.query('SELECT id FROM signature_requests WHERE id = $1 FOR UPDATE', [requestId])
  const prev = await tx.queryOne('SELECT hash FROM signature_events WHERE request_id = $1 ORDER BY id DESC LIMIT 1', [requestId])
  const createdAt = new Date().toISOString()
  const prevHash = prev?.hash || null
  userAgent = userAgent ? userAgent.slice(0, 400) : null
  const hash = sha256((prevHash || '') + canonical({ request_id: requestId, event, actor, ip, user_agent: userAgent, details, created_at: createdAt }))
  await tx.query(
    `INSERT INTO signature_events (request_id, workspace_id, event, actor, ip, user_agent, details, prev_hash, hash, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [requestId, workspaceId, event, actor, ip, userAgent, JSON.stringify(details), prevHash, hash, createdAt],
  )
  return hash
}

/** Recompute the chain and report whether it is intact. */
export async function verifyEventChain(requestId) {
  const events = await query('SELECT * FROM signature_events WHERE request_id = $1 ORDER BY id', [requestId])
  let prev = null
  for (const e of events) {
    const expected = sha256((prev || '') + canonical({ ...e, created_at: new Date(e.created_at).toISOString() }))
    if (e.prev_hash !== prev || e.hash !== expected) return { intact: false, brokenAt: e.id, events }
    prev = e.hash
  }
  return { intact: true, events }
}

/** Load a request by public token for the signer. Throws 404/410 as appropriate. */
export async function loadByToken(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) throw notFound('invalid_link', 'This link is not valid')
  const r = await queryOne(
    `SELECT s.*, cl.name AS client_name, cl.email AS client_email, cl.phone AS client_phone,
            w.name AS ws_name, w.default_language, w.brand_color, w.logo_storage_key, w.logo_url, w.id AS ws_id
       FROM signature_requests s JOIN clients cl ON cl.id = s.client_id JOIN workspaces w ON w.id = s.workspace_id
      WHERE s.public_token = $1 AND s.deleted_at IS NULL`,
    [token],
  )
  if (!r) throw notFound('invalid_link', 'This link is not valid')
  return r
}

export function effectiveStatus(r) {
  if (['pending', 'viewed'].includes(r.status) && r.expires_at && new Date(r.expires_at) < new Date()) return 'expired'
  return r.status
}

async function loadFields(requestId) {
  return query('SELECT * FROM signature_fields WHERE request_id = $1 ORDER BY doc_index, page, sort_order', [requestId])
}

async function loadExtraDocs(requestId) {
  return query('SELECT * FROM signature_documents WHERE request_id = $1 ORDER BY sort_order, created_at', [requestId])
}

const MAX_VALUE = { signature: 600_000, initials: 300_000, text: 500, name: 200, date: 20, checkbox: 5 }

/** Validate submitted values against the request's fields. */
export function validateFieldValues(fields, submitted) {
  const byId = new Map(fields.map((f) => [f.id, f]))
  const values = new Map()
  for (const item of submitted || []) {
    const f = byId.get(item?.fieldId)
    if (!f) throw badRequest('unknown_field', 'A submitted field does not belong to this document')
    const v = typeof item.value === 'string' ? item.value.trim() : ''
    if (!v) continue
    if (v.length > (MAX_VALUE[f.type] || 500)) throw badRequest('value_too_long', 'A field value is too long')
    if ((f.type === 'signature' || f.type === 'initials') && !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(v)) {
      // Initials may also be typed text.
      if (f.type === 'signature') throw badRequest('invalid_signature', 'Signature image is invalid')
    }
    if (f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw badRequest('invalid_date', 'Date is invalid')
    if (f.type === 'checkbox' && v !== 'true') continue
    values.set(f.id, v)
  }
  const missing = fields.filter((f) => f.required && !values.has(f.id))
  if (missing.length) throw badRequest('required_fields_missing', 'Please complete all required fields', { fieldIds: missing.map((f) => f.id) })
  return values
}

/** Signer opened the document. Idempotent: only the first view is an event. */
export async function recordView(token, { ip, userAgent }) {
  const r = await loadByToken(token)
  if (r.status !== 'pending') return
  await withTransaction(async (tx) => {
    const updated = await tx.queryOne(`UPDATE signature_requests SET status = 'viewed', viewed_at = now() WHERE id = $1 AND status = 'pending' RETURNING id`, [r.id])
    if (updated) await appendEvent(tx, { requestId: r.id, workspaceId: r.workspace_id, event: 'viewed', actor: 'signer', ip, userAgent })
  })
  publish(r.workspace_id, 'signatures', { id: r.id })
}

/**
 * Complete signing. Generates signed PDFs server-side; the request is marked
 * signed only after every signed file is stored.
 */
export async function completeSigning(token, { signerName, consent, language, values: submitted }, { ip, userAgent }) {
  const r = await loadByToken(token)
  const status = effectiveStatus(r)
  if (status === 'signed') throw conflict('already_signed', 'This document was already signed')
  if (status === 'expired') throw gone('expired', 'This signing link has expired')
  if (status === 'cancelled' || status === 'declined') throw gone(status, 'This signing request is no longer active')
  if (consent !== true) throw badRequest('consent_required', 'Please confirm your consent to sign electronically')
  const name = String(signerName || '').trim().slice(0, 120)
  if (name.length < 2) throw badRequest('signer_name_required', 'Please enter your full name')

  const fields = await loadFields(r.id)
  const values = validateFieldValues(fields, submitted)
  const extras = await loadExtraDocs(r.id)
  const lang = language === 'he' ? 'he' : 'en'
  const reference = `Dockly · ${r.id} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`

  // Generate every signed file before touching request state.
  const outputs = []
  const docs = [{ index: 0, key: r.document_storage_path, type: r.document_file_type, name: r.document_file_name, extraId: null }]
  extras.forEach((d, i) => docs.push({ index: i + 1, key: d.storage_path, type: d.file_type, name: d.file_name, extraId: d.id }))
  for (const d of docs) {
    const docFields = fields.filter((f) => (f.doc_index ?? 0) === d.index).map((f) => ({ ...f, value: values.get(f.id) }))
    const original = (await storage.get(d.key)).buffer
    const originalHash = sha256(original)
    if (d.index === 0 && r.original_sha256 && r.original_sha256 !== originalHash) {
      throw conflict('document_changed', 'The document changed after it was sent and cannot be signed')
    }
    const isPdf = (d.type || '').includes('pdf') || original.subarray(0, 1024).toString('latin1').includes('%PDF-')
    if (!isPdf) {
      outputs.push({ ...d, originalHash, signedKey: null, signedHash: null })
      continue
    }
    const signed = await stampPdf(original, docFields, { canvasWidth: r.canvas_width, reference, language: lang === 'he' ? 'he-IL' : 'en-GB' })
    const signedKey = keys.signatureFile(r.workspace_id, r.id, d.name.replace(/\.pdf$/i, '') + '-signed.pdf')
    await storage.put(signedKey, signed, 'application/pdf')
    outputs.push({ ...d, originalHash, signedKey, signedHash: sha256(signed) })
  }

  const main = outputs[0]
  const consentText = CONSENT_TEXT[lang]
  try {
    await withTransaction(async (tx) => {
      const locked = await tx.queryOne('SELECT status FROM signature_requests WHERE id = $1 FOR UPDATE', [r.id])
      if (!['pending', 'viewed'].includes(locked.status)) throw conflict('already_signed', 'This document was already signed')
      for (const f of fields) {
        await tx.query('UPDATE signature_fields SET value = $2 WHERE id = $1', [f.id, values.get(f.id) ?? null])
      }
      for (const o of outputs.slice(1)) {
        await tx.query('UPDATE signature_documents SET signed_storage_path = $2, original_sha256 = $3, signed_sha256 = $4 WHERE id = $1',
          [o.extraId, o.signedKey, o.originalHash, o.signedHash])
      }
      await tx.query(
        `UPDATE signature_requests SET status = 'signed', signed_at = now(), signed_ip = $2, signed_user_agent = $3,
           signed_document_path = $4, signed_sha256 = $5, original_sha256 = COALESCE(original_sha256, $6),
           signer_name = $7, consent_text = $8, consented_at = now(), language = COALESCE(language, $9)
         WHERE id = $1`,
        [r.id, ip, userAgent?.slice(0, 400) || null, main.signedKey, main.signedHash, main.originalHash, name, consentText, lang],
      )
      await appendEvent(tx, { requestId: r.id, workspaceId: r.workspace_id, event: 'consented', actor: 'signer', ip, userAgent, details: { consentVersion: CONSENT_VERSION, language: lang } })
      await appendEvent(tx, {
        requestId: r.id, workspaceId: r.workspace_id, event: 'signed', actor: 'signer', ip, userAgent,
        details: { signerName: name, fieldCount: values.size, originalSha256: main.originalHash, signedSha256: main.signedHash },
      })
      await appendEvent(tx, {
        requestId: r.id, workspaceId: r.workspace_id, event: 'completed_pdf', actor: 'system',
        details: { documents: outputs.map((o) => ({ index: o.index, signedSha256: o.signedHash })) },
      })
    })
  } catch (err) {
    await storage.removeMany(outputs.map((o) => o.signedKey).filter(Boolean)).catch(() => {})
    throw err
  }

  await logActivity({
    workspaceId: r.workspace_id, type: 'signature_signed', description: `${r.title} signed`,
    actor: { type: 'client', name, id: r.client_id }, clientId: r.client_id, clientName: r.client_name,
    caseId: r.case_id || undefined, metadata: { signatureRequestId: r.id },
  })
  await notifyWorkspace({ workspaceId: r.workspace_id, type: 'success', title: `${name} signed "${r.title}"`, actionUrl: `/app/signatures/${r.id}` })
  publish(r.workspace_id, 'signatures', { id: r.id })
  await recordMilestone(r.workspace_id, 'first_signature_completed')
  return { signedAt: new Date().toISOString() }
}

export async function declineSigning(token, { reason }, { ip, userAgent }) {
  const r = await loadByToken(token)
  const status = effectiveStatus(r)
  if (!['pending', 'viewed'].includes(status)) throw conflict('not_pending', 'This request can no longer be declined')
  const why = String(reason || '').trim().slice(0, 1000)
  await withTransaction(async (tx) => {
    await tx.query(`UPDATE signature_requests SET status = 'declined', declined_at = now(), decline_reason = $2 WHERE id = $1`, [r.id, why || null])
    await appendEvent(tx, { requestId: r.id, workspaceId: r.workspace_id, event: 'declined', actor: 'signer', ip, userAgent, details: { reason: why } })
  })
  await logActivity({
    workspaceId: r.workspace_id, type: 'signature_declined', description: `${r.title} declined`,
    actor: { type: 'client', name: r.client_name, id: r.client_id }, clientId: r.client_id, clientName: r.client_name, metadata: { reason: why },
  })
  await notifyWorkspace({ workspaceId: r.workspace_id, type: 'warning', title: `${r.client_name} declined "${r.title}"`, message: why, actionUrl: `/app/signatures/${r.id}` })
  publish(r.workspace_id, 'signatures', { id: r.id })
}

/** Build (and cache in storage) the signing certificate for a request. */
export async function certificateFor(workspaceId, requestId, language = 'en') {
  const r = await queryOne(
    `SELECT s.*, cl.name AS client_name, cl.email AS client_email, cl.phone AS client_phone, w.name AS ws_name
       FROM signature_requests s JOIN clients cl ON cl.id = s.client_id JOIN workspaces w ON w.id = s.workspace_id
      WHERE s.id = $1 AND s.workspace_id = $2`,
    [requestId, workspaceId],
  )
  if (!r) throw notFound()
  const { events } = await verifyEventChain(requestId)
  const actorIds = [...new Set(events.filter((e) => e.actor.startsWith('user:')).map((e) => e.actor.slice(5)))]
  const names = actorIds.length ? await query('SELECT id, name FROM profiles WHERE id = ANY($1::uuid[])', [actorIds]) : []
  const nameMap = new Map(names.map((n) => [`user:${n.id}`, n.name]))
  const extras = await loadExtraDocs(requestId)
  return buildCertificate({
    id: r.id, title: r.title, workspaceName: r.ws_name, status: r.status,
    signerName: r.signer_name, clientName: r.client_name, signerEmail: r.client_email, signerPhone: r.client_phone,
    ip: r.signed_ip, userAgent: r.signed_user_agent, consentText: r.consent_text,
    consentedAt: r.consented_at ? new Date(r.consented_at).toISOString() : null,
    originalSha256: r.original_sha256, signedSha256: r.signed_sha256,
    extraDocuments: extras.map((d) => ({ fileName: d.file_name, originalSha256: d.original_sha256, signedSha256: d.signed_sha256 })),
  }, events.map((e) => ({ ...e, actor_name: nameMap.get(e.actor) })), language)
}
