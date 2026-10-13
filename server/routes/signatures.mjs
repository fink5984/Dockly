import { Router } from 'express'
import { z } from 'zod'
import { createHash } from 'crypto'
import { query, queryOne, withTransaction } from '../db/pool.mjs'
import { parse, badRequest, notFound, conflict, requireUuid, HttpError } from '../lib/http.mjs'
import { requireAuth, requireWrite, requireRole } from '../middleware/auth.mjs'
import { storage, keys, isWorkspaceKey } from '../storage.mjs'
import { validateUpload, cleanDisplayName, contentDisposition } from '../lib/files.mjs'
import { singleFile } from '../lib/upload.mjs'
import { randomToken } from '../lib/crypto.mjs'
import { logActivity } from '../lib/activity.mjs'
import { publish } from '../lib/events.mjs'
import { appendEvent, verifyEventChain, certificateFor, effectiveStatus } from '../signing/service.mjs'
import { pdfPageCount, imageToPdf } from '../signing/pdf.mjs'
import { sendSignatureMessage } from '../messaging/index.mjs'

const router = Router()
router.use(requireAuth)
const actorOf = (req) => ({ type: 'user', id: req.user.id, name: req.user.name })

export function serializeField(f) {
  return {
    id: f.id, requestId: f.request_id, type: f.type, label: f.label, page: f.page, x: f.x, y: f.y,
    width: f.width, height: f.height, required: f.required, value: f.value ?? undefined, sortOrder: f.sort_order, docIndex: f.doc_index ?? 0,
  }
}

export function serializeSignature(r, fields = [], extras = []) {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    clientId: r.client_id,
    clientName: r.client_name || '',
    caseId: r.case_id || undefined,
    title: r.title,
    description: r.description || undefined,
    status: effectiveStatus(r),
    publicToken: r.public_token,
    documentFileName: r.document_file_name,
    documentFileType: r.document_file_type,
    documentFileSize: r.document_file_size,
    canvasWidth: r.canvas_width ?? undefined,
    fields: fields.map(serializeField),
    documents: extras.map((d) => ({ id: d.id, fileName: d.file_name, fileType: d.file_type, fileSize: d.file_size, hasSigned: Boolean(d.signed_storage_path) })),
    signedAt: r.signed_at || undefined,
    signedIp: r.signed_ip || undefined,
    signerName: r.signer_name || undefined,
    hasSignedDocument: Boolean(r.signed_document_path),
    viewedAt: r.viewed_at || undefined,
    declinedAt: r.declined_at || undefined,
    declineReason: r.decline_reason || undefined,
    expiresAt: r.expires_at || undefined,
    originalSha256: r.original_sha256 || undefined,
    signedSha256: r.signed_sha256 || undefined,
    lastReminderAt: r.last_reminder_at || undefined,
    reminderCount: r.reminder_count ?? 0,
    language: r.language || undefined,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

async function loadRequest(req, id = req.params.id) {
  const r = await queryOne(
    `SELECT s.*, cl.name AS client_name FROM signature_requests s JOIN clients cl ON cl.id = s.client_id
      WHERE s.id = $1 AND s.workspace_id = $2 AND s.deleted_at IS NULL`,
    [requireUuid(id), req.user.workspaceId],
  )
  if (!r) throw notFound('signature_not_found', 'Signature request not found')
  return r
}

async function fullRequest(req, id) {
  const r = await loadRequest(req, id)
  const fields = await query('SELECT * FROM signature_fields WHERE request_id = $1 ORDER BY doc_index, page, sort_order', [r.id])
  const extras = await query('SELECT * FROM signature_documents WHERE request_id = $1 ORDER BY sort_order, created_at', [r.id])
  return serializeSignature(r, fields, extras)
}

router.get('/', async (req, res) => {
  const params = [req.user.workspaceId]
  let where = 's.workspace_id = $1 AND s.deleted_at IS NULL'
  if (typeof req.query.clientId === 'string' && req.query.clientId) {
    params.push(requireUuid(req.query.clientId))
    where += ` AND s.client_id = $${params.length}`
  }
  const rows = await query(
    `SELECT s.*, cl.name AS client_name,
            (SELECT count(*)::int FROM signature_fields f WHERE f.request_id = s.id) AS field_count
       FROM signature_requests s JOIN clients cl ON cl.id = s.client_id
      WHERE ${where} ORDER BY s.created_at DESC LIMIT 500`,
    params,
  )
  res.json(rows.map((r) => ({ ...serializeSignature(r), fieldCount: r.field_count })))
})

router.get('/:id', async (req, res) => {
  res.json(await fullRequest(req))
})

/** Step 1: upload a document to sign. Returns an opaque key used in step 2. */
router.post('/uploads', requireWrite, singleFile(), async (req, res) => {
  if (!req.file) throw badRequest('file_required', 'Choose a file')
  const name = cleanDisplayName(req.file.originalname)
  const check = validateUpload({ buffer: req.file.buffer, fileName: name, allowedFormats: ['pdf', 'jpg', 'png'], maxBytes: 25 * 1024 * 1024 })
  if (!check.ok) throw new HttpError(415, check.code, 'Upload a PDF (or a JPG/PNG image)')
  // Images are wrapped in a single-page PDF so every signable document is a PDF.
  let bytes = req.file.buffer
  let fileName = name
  if (check.kind !== 'pdf') {
    bytes = await imageToPdf(req.file.buffer, check.kind)
    fileName = name.replace(/\.[^.]+$/, '') + '.pdf'
  }
  let pages
  try {
    pages = await pdfPageCount(bytes)
  } catch {
    throw new HttpError(415, 'pdf_unreadable', 'This PDF is encrypted or damaged and cannot be signed')
  }
  const key = keys.signatureFile(req.user.workspaceId, 'uploads', fileName)
  await storage.put(key, bytes, 'application/pdf')
  res.status(201).json({
    key, fileName, fileType: 'application/pdf', fileSize: bytes.length, pages,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  })
})

const fieldSchema = z.object({
  type: z.enum(['signature', 'date', 'name', 'text', 'initials', 'checkbox']),
  label: z.string().max(120).optional().default(''),
  page: z.number().int().min(1).max(2000),
  x: z.number().min(0).max(20000),
  y: z.number().min(0).max(40000),
  width: z.number().min(8).max(5000),
  height: z.number().min(8).max(5000),
  required: z.boolean().default(true),
  sortOrder: z.number().int().optional(),
  docIndex: z.number().int().min(0).max(20).default(0),
})
const docRef = z.object({ key: z.string().min(10).max(600), fileName: z.string().max(200), fileType: z.string().max(120), fileSize: z.number().int().min(0) })

router.post('/', requireWrite, async (req, res) => {
  const b = parse(z.object({
    clientId: z.string().uuid(),
    caseId: z.string().uuid().nullable().optional(),
    title: z.string().trim().min(1).max(200),
    description: z.string().max(2000).nullable().optional(),
    document: docRef,
    extraDocuments: z.array(docRef).max(10).optional().default([]),
    canvasWidth: z.number().min(100).max(5000),
    fields: z.array(fieldSchema).min(1, 'Place at least one field').max(300),
    expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
    language: z.enum(['en', 'he']).nullable().optional(),
    send: z.object({ channel: z.enum(['email', 'whatsapp']) }).nullable().optional(),
  }), req.body)
  if (!(await queryOne('SELECT 1 FROM clients WHERE id = $1 AND workspace_id = $2', [b.clientId, req.user.workspaceId]))) throw notFound('client_not_found', 'Client not found')
  if (b.caseId && !(await queryOne('SELECT 1 FROM cases WHERE id = $1 AND workspace_id = $2', [b.caseId, req.user.workspaceId]))) throw notFound('request_not_found', 'Request not found')
  // Only files this workspace uploaded can be attached.
  for (const d of [b.document, ...b.extraDocuments]) {
    if (!isWorkspaceKey(d.key, req.user.workspaceId) || !d.key.includes('/signatures/uploads/')) throw badRequest('invalid_document', 'Unknown document')
  }
  if (b.fields.some((f) => f.docIndex > b.extraDocuments.length)) throw badRequest('invalid_field', 'A field refers to a missing document')

  const original = (await storage.get(b.document.key)).buffer
  const originalSha = createHash('sha256').update(original).digest('hex')

  const id = await withTransaction(async (tx) => {
    const r = await tx.queryOne(
      `INSERT INTO signature_requests (workspace_id, client_id, case_id, title, description, status, public_token,
          document_file_name, document_storage_path, document_file_type, document_file_size, canvas_width, expires_at,
          created_by, original_sha256, language)
       VALUES ($1,$2,$3,$4,$5,'pending',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [req.user.workspaceId, b.clientId, b.caseId || null, b.title, b.description || null, randomToken(32),
        cleanDisplayName(b.document.fileName), b.document.key, b.document.fileType, b.document.fileSize, Math.round(b.canvasWidth),
        b.expiresAt || null, req.user.id, originalSha, b.language || null],
    )
    let i = 0
    for (const f of b.fields) {
      await tx.query(
        `INSERT INTO signature_fields (request_id, type, label, page, x, y, width, height, required, sort_order, doc_index)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [r.id, f.type, f.label, f.page, f.x, f.y, f.width, f.height, f.required, f.sortOrder ?? i, f.docIndex],
      )
      i++
    }
    let j = 0
    for (const d of b.extraDocuments) {
      const bytes = (await storage.get(d.key)).buffer
      await tx.query(
        `INSERT INTO signature_documents (request_id, file_name, storage_path, file_type, file_size, sort_order, original_sha256) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [r.id, cleanDisplayName(d.fileName), d.key, d.fileType, d.fileSize, j++, createHash('sha256').update(bytes).digest('hex')],
      )
    }
    await appendEvent(tx, { requestId: r.id, workspaceId: req.user.workspaceId, event: 'created', actor: `user:${req.user.id}`, details: { originalSha256: originalSha, fields: b.fields.length } })
    return r.id
  })

  const client = await queryOne('SELECT name FROM clients WHERE id = $1', [b.clientId])
  await logActivity({ workspaceId: req.user.workspaceId, type: 'signature_created', description: `Signature request "${b.title}" created`, actor: actorOf(req), clientId: b.clientId, clientName: client?.name, caseId: b.caseId || undefined, metadata: { signatureRequestId: id } })
  let send = null
  if (b.send) {
    send = await sendSignatureMessage({ workspaceId: req.user.workspaceId, requestId: id, kind: 'signature_request', channel: b.send.channel, idempotencyKey: `signature_request:${id}` })
    if (send.ok) await withTransaction((tx) => appendEvent(tx, { requestId: id, workspaceId: req.user.workspaceId, event: 'sent', actor: `user:${req.user.id}`, details: { channel: b.send.channel } }))
  }
  publish(req.user.workspaceId, 'signatures', { id })
  res.status(201).json({ request: await fullRequest(req, id), send })
})

/** Short-lived URL to the original or signed file. ?doc=main|<extraId>&variant=original|signed */
router.get('/:id/file', async (req, res) => {
  const r = await loadRequest(req)
  const variant = req.query.variant === 'signed' ? 'signed' : 'original'
  let key
  let name
  let type
  if (!req.query.doc || req.query.doc === 'main') {
    key = variant === 'signed' ? r.signed_document_path : r.document_storage_path
    name = variant === 'signed' ? r.document_file_name.replace(/(\.pdf)?$/i, ' (signed).pdf') : r.document_file_name
    type = variant === 'signed' ? 'application/pdf' : r.document_file_type
  } else {
    const d = await queryOne('SELECT * FROM signature_documents WHERE id = $1 AND request_id = $2', [requireUuid(req.query.doc), r.id])
    if (!d) throw notFound()
    key = variant === 'signed' ? d.signed_storage_path : d.storage_path
    name = variant === 'signed' ? d.file_name.replace(/(\.pdf)?$/i, ' (signed).pdf') : d.file_name
    type = variant === 'signed' ? 'application/pdf' : d.file_type
  }
  if (!key) throw notFound('no_file', variant === 'signed' ? 'The signed document is not available' : 'File not found')
  const disposition = req.query.disposition === 'attachment' ? 'attachment' : 'inline'
  if (variant === 'signed' && disposition === 'attachment') {
    await withTransaction((tx) => appendEvent(tx, { requestId: r.id, workspaceId: r.workspace_id, event: 'downloaded', actor: `user:${req.user.id}` }))
  }
  res.json({ url: await storage.url(key, { fileName: name, disposition, contentType: type }), fileName: name })
})

router.get('/:id/events', async (req, res) => {
  const r = await loadRequest(req)
  const { intact, events } = await verifyEventChain(r.id)
  const userIds = [...new Set(events.filter((e) => e.actor.startsWith('user:')).map((e) => e.actor.slice(5)))]
  const users = userIds.length ? await query('SELECT id, name FROM profiles WHERE id = ANY($1::uuid[])', [userIds]) : []
  const names = new Map(users.map((u) => [`user:${u.id}`, u.name]))
  res.json({
    intact,
    events: events.map((e) => ({
      id: e.id, event: e.event, actor: e.actor === 'signer' ? 'signer' : e.actor === 'system' ? 'system' : 'user',
      actorName: e.actor === 'signer' ? (r.signer_name || r.client_name) : names.get(e.actor) || undefined,
      ip: e.ip || undefined, userAgent: e.user_agent || undefined, details: e.details, hash: e.hash, createdAt: e.created_at,
    })),
  })
})

router.get('/:id/certificate', async (req, res) => {
  const r = await loadRequest(req)
  const lang = req.query.lang === 'he' ? 'he' : 'en'
  const pdf = await certificateFor(req.user.workspaceId, r.id, lang)
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', contentDisposition(`${r.title} - certificate.pdf`, req.query.disposition === 'inline' ? 'inline' : 'attachment'))
  res.setHeader('Cache-Control', 'no-store')
  res.send(pdf)
})

router.post('/:id/send', requireWrite, async (req, res) => {
  const r = await loadRequest(req)
  const b = parse(z.object({ channel: z.enum(['email', 'whatsapp']), kind: z.enum(['request', 'reminder']).default('request') }), req.body)
  const result = await sendSignatureMessage({
    workspaceId: req.user.workspaceId, requestId: r.id, kind: b.kind === 'reminder' ? 'signature_reminder' : 'signature_request', channel: b.channel,
  })
  if (!result.ok) throw new HttpError(result.code === 'send_failed' ? 502 : 400, result.code, result.error || 'Message was not sent')
  await withTransaction((tx) => appendEvent(tx, {
    requestId: r.id, workspaceId: r.workspace_id, event: b.kind === 'reminder' ? 'reminder_sent' : 'sent', actor: `user:${req.user.id}`, details: { channel: b.channel },
  }))
  res.json(result)
})

router.post('/:id/cancel', requireWrite, async (req, res) => {
  const r = await loadRequest(req)
  if (!['pending', 'viewed', 'draft'].includes(r.status)) throw conflict('not_cancellable', 'Only unsigned requests can be cancelled')
  await withTransaction(async (tx) => {
    await tx.query(`UPDATE signature_requests SET status = 'cancelled' WHERE id = $1`, [r.id])
    await appendEvent(tx, { requestId: r.id, workspaceId: r.workspace_id, event: 'cancelled', actor: `user:${req.user.id}` })
  })
  await logActivity({ workspaceId: req.user.workspaceId, type: 'signature_cancelled', description: `"${r.title}" cancelled`, actor: actorOf(req), clientId: r.client_id, clientName: r.client_name })
  publish(req.user.workspaceId, 'signatures', { id: r.id })
  res.json(await fullRequest(req))
})

/** Archive (soft delete). The audit trail and files are retained. */
router.delete('/:id', requireRole('admin'), async (req, res) => {
  const r = await loadRequest(req)
  await query('UPDATE signature_requests SET deleted_at = now() WHERE id = $1', [r.id])
  await logActivity({ workspaceId: req.user.workspaceId, type: 'signature_archived', description: `"${r.title}" archived`, actor: actorOf(req), clientId: r.client_id, clientName: r.client_name })
  publish(req.user.workspaceId, 'signatures', { id: r.id })
  res.json({ ok: true })
})

export default router
