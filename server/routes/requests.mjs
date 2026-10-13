/**
 * Document requests ("cases" in the database).
 */
import { Router } from 'express'
import { z } from 'zod'
import { config } from '../config.mjs'
import { query, queryOne, withTransaction } from '../db/pool.mjs'
import { parse, badRequest, notFound, conflict, requireUuid, HttpError } from '../lib/http.mjs'
import { requireAuth, requireWrite, requireRole } from '../middleware/auth.mjs'
import { storage } from '../storage.mjs'
import { randomToken } from '../lib/crypto.mjs'
import { contentDisposition } from '../lib/files.mjs'
import { buildZip } from '../lib/zip.mjs'
import { logActivity } from '../lib/activity.mjs'
import { publish } from '../lib/events.mjs'
import { rateLimit } from '../lib/rateLimit.mjs'
import { singleFile } from '../lib/upload.mjs'
import { getRequest, serializeRequest, recomputeRequestStatus, ingestUpload, assertDocumentTypes, DOC_SELECT } from '../domain/requests.mjs'
import { reviewTransition, canonicalDocStatus, summarizeDocuments } from '../domain/requestStatus.mjs'
import { sendRequestMessage } from '../messaging/index.mjs'
import { escapeLike } from './clients.mjs'
import { serializeTemplate } from './library.mjs'

const router = Router()
router.use(requireAuth)

const actorOf = (req) => ({ type: 'user', id: req.user.id, name: req.user.name })

// ── List ──────────────────────────────────────────────────
const SORTS = {
  created: 'c.created_at DESC',
  updated: 'COALESCE(c.last_activity_date, c.updated_at) DESC',
  deadline: 'c.deadline ASC NULLS LAST',
  client: 'cl.name ASC',
  title: 'COALESCE(c.title, c.case_type) ASC',
}

router.get('/', async (req, res) => {
  const q = req.query
  const params = [req.user.workspaceId]
  const where = ['c.workspace_id = $1']
  const search = typeof q.search === 'string' ? q.search.trim().slice(0, 100) : ''
  if (search) {
    params.push(`%${escapeLike(search)}%`)
    where.push(`(COALESCE(c.title, c.case_type) ILIKE $${params.length} OR cl.name ILIKE $${params.length})`)
  }
  if (typeof q.clientId === 'string' && q.clientId) {
    params.push(requireUuid(q.clientId))
    where.push(`c.client_id = $${params.length}`)
  }
  const status = typeof q.status === 'string' ? q.status : ''
  if (status === 'open') where.push(`c.status IN ('new','waiting-for-client','partial-submission','delayed')`)
  else if (status === 'overdue') where.push(`c.deadline < now() AND c.status NOT IN ('completed','closed')`)
  else if (status === 'needs-review') where.push(`EXISTS (SELECT 1 FROM case_documents d WHERE d.case_id = c.id AND d.status IN ('uploaded','received','under-review'))`)
  else if (['new', 'waiting-for-client', 'partial-submission', 'completed', 'closed'].includes(status)) {
    params.push(status)
    where.push(status === 'waiting-for-client' ? `c.status IN ('waiting-for-client','delayed')` : `c.status = $${params.length}`)
    if (status === 'waiting-for-client') params.pop()
  }
  const sort = SORTS[q.sort] || SORTS.created
  const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 50))
  const page = Math.max(1, Number(q.page) || 1)

  const whereSql = where.join(' AND ')
  const totalRow = await queryOne(`SELECT count(*)::int AS n FROM cases c JOIN clients cl ON cl.id = c.client_id WHERE ${whereSql}`, params)
  const rows = await query(
    `SELECT c.*, cl.name AS client_name, cl.phone AS client_phone, cl.email AS client_email
       FROM cases c JOIN clients cl ON cl.id = c.client_id
      WHERE ${whereSql} ORDER BY ${sort} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    params,
  )
  const ids = rows.map((r) => r.id)
  const docs = ids.length
    ? await query(
      `SELECT ${q.include === 'documents' ? DOC_SELECT : 'cd.case_id, cd.status, cd.is_required'}
         FROM case_documents cd LEFT JOIN document_types dt ON dt.id = cd.document_type_id
        WHERE cd.case_id = ANY($1::uuid[]) ORDER BY cd.sort_order, cd.created_at`,
      [ids],
    )
    : []
  const byCase = new Map()
  for (const d of docs) {
    if (!byCase.has(d.case_id)) byCase.set(d.case_id, [])
    byCase.get(d.case_id).push(d)
  }
  const items = rows.map((r) => {
    const s = serializeRequest(r, byCase.get(r.id) || [])
    if (q.include !== 'documents') s.requiredDocuments = []
    return s
  })
  const counts = await query(
    `SELECT CASE WHEN status = 'delayed' THEN 'waiting-for-client' ELSE status END AS status, count(*)::int AS n
       FROM cases WHERE workspace_id = $1 GROUP BY 1`,
    [req.user.workspaceId],
  )
  res.json({ items, total: totalRow.n, page, pageSize, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) })
})

// ── Create ────────────────────────────────────────────────
const itemSchema = z.object({
  documentTypeId: z.string().uuid(),
  required: z.boolean().default(true),
  note: z.string().max(500).optional().default(''),
})
const createSchema = z.object({
  clientId: z.string().uuid().optional(),
  newClient: z.object({
    name: z.string().trim().min(1).max(160),
    phone: z.string().trim().max(40).optional().default(''),
    email: z.string().trim().max(254).optional().default(''),
  }).optional(),
  title: z.string().trim().min(1).max(160),
  instructions: z.string().max(4000).optional().default(''),
  notes: z.string().max(4000).optional().default(''),
  deadline: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).nullable().optional(),
  language: z.enum(['en', 'he']).nullable().optional(),
  remindersEnabled: z.boolean().optional().default(true),
  items: z.array(itemSchema).min(1, 'Choose at least one document').max(60),
  send: z.object({ channel: z.enum(['whatsapp', 'email']) }).nullable().optional(),
})

router.post('/', requireWrite, async (req, res) => {
  const b = parse(createSchema, req.body)
  if (!b.clientId && !b.newClient) throw badRequest('client_required', 'Choose or create a client')
  await assertDocumentTypes(req.user.workspaceId, b.items.map((i) => i.documentTypeId))

  const created = await withTransaction(async (tx) => {
    let clientId = b.clientId
    let clientName
    if (clientId) {
      const c = await tx.queryOne('SELECT id, name FROM clients WHERE id = $1 AND workspace_id = $2', [clientId, req.user.workspaceId])
      if (!c) throw notFound('client_not_found', 'Client not found')
      clientName = c.name
    } else {
      const c = await tx.queryOne(
        `INSERT INTO clients (workspace_id, name, phone, email, assigned_owner, status) VALUES ($1,$2,$3,$4,$5,'active') RETURNING id, name`,
        [req.user.workspaceId, b.newClient.name, b.newClient.phone, b.newClient.email, req.user.name],
      )
      clientId = c.id
      clientName = c.name
    }
    const row = await tx.queryOne(
      `INSERT INTO cases (workspace_id, client_id, case_type, title, status, assigned_owner, deadline, notes, instructions, language,
                          reminders_enabled, public_token, created_by, last_activity_date)
       VALUES ($1,$2,$3,$3,'new',$4,$5,$6,$7,$8,$9,$10,$11,now()) RETURNING id`,
      [req.user.workspaceId, clientId, b.title, req.user.name, b.deadline || null, b.notes || null, b.instructions || null,
        b.language || null, b.remindersEnabled, randomToken(32), req.user.id],
    )
    let i = 0
    for (const item of b.items) {
      await tx.query(
        `INSERT INTO case_documents (case_id, document_type_id, is_required, status, case_notes, sort_order) VALUES ($1,$2,$3,'missing',$4,$5)`,
        [row.id, item.documentTypeId, item.required, item.note || null, i++],
      )
    }
    return { id: row.id, clientId, clientName, newClient: !b.clientId }
  })

  if (created.newClient) {
    await logActivity({ workspaceId: req.user.workspaceId, type: 'client_created', description: `Client ${created.clientName} created`, actor: actorOf(req), clientId: created.clientId, clientName: created.clientName })
  }
  await logActivity({
    workspaceId: req.user.workspaceId, type: 'request_created', description: `Request "${b.title}" created`,
    actor: actorOf(req), clientId: created.clientId, clientName: created.clientName, caseId: created.id, metadata: { items: b.items.length },
  })

  let send = null
  if (b.send) {
    send = await sendRequestMessage({
      workspaceId: req.user.workspaceId, caseId: created.id, kind: 'request_initial', channel: b.send.channel, actor: req.user,
      idempotencyKey: `request_initial:${created.id}`,
    })
  }
  publish(req.user.workspaceId, 'requests', { caseId: created.id })
  const { request } = await getRequest(req.user.workspaceId, created.id)
  res.status(201).json({ request, send })
})

// ── Read ──────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const { request } = await getRequest(req.user.workspaceId, requireUuid(req.params.id))
  res.json(request)
})

// ── Update ────────────────────────────────────────────────
router.patch('/:id', requireWrite, async (req, res) => {
  const id = requireUuid(req.params.id)
  const b = parse(z.object({
    title: z.string().trim().min(1).max(160).optional(),
    instructions: z.string().max(4000).optional(),
    notes: z.string().max(4000).nullable().optional(),
    deadline: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).nullable().optional(),
    language: z.enum(['en', 'he']).nullable().optional(),
    assignedOwner: z.string().trim().max(120).optional(),
    remindersEnabled: z.boolean().optional(),
    action: z.enum(['close', 'reopen']).optional(),
  }), req.body)
  const { row } = await getRequest(req.user.workspaceId, id)
  const sets = []
  const vals = [id, req.user.workspaceId]
  const add = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`) }
  if (b.title !== undefined) { add('title', b.title); add('case_type', b.title) }
  if (b.instructions !== undefined) add('instructions', b.instructions)
  if (b.notes !== undefined) add('notes', b.notes)
  if (b.deadline !== undefined) add('deadline', b.deadline)
  if (b.language !== undefined) add('language', b.language)
  if (b.assignedOwner !== undefined) add('assigned_owner', b.assignedOwner)
  if (b.remindersEnabled !== undefined) add('reminders_enabled', b.remindersEnabled)
  if (b.action === 'close') { add('status', 'closed'); sets.push('closed_at = now()') }
  if (sets.length) await query(`UPDATE cases SET ${sets.join(', ')}, last_activity_date = now() WHERE id = $1 AND workspace_id = $2`, vals)
  if (b.action === 'reopen' && row.status === 'closed') {
    await query(`UPDATE cases SET status = 'waiting-for-client', closed_at = NULL WHERE id = $1`, [id])
    await recomputeRequestStatus({ query, queryOne }, id)
  }
  if (b.action) {
    await logActivity({ workspaceId: req.user.workspaceId, type: b.action === 'close' ? 'request_closed' : 'request_reopened', description: `Request ${b.action === 'close' ? 'closed' : 'reopened'}`, actor: actorOf(req), clientId: row.client_id, clientName: row.client_name, caseId: id })
  } else if (sets.length) {
    await logActivity({ workspaceId: req.user.workspaceId, type: 'request_updated', description: 'Request details updated', actor: actorOf(req), clientId: row.client_id, clientName: row.client_name, caseId: id, metadata: { fields: Object.keys(b) } })
  }
  publish(req.user.workspaceId, 'requests', { caseId: id })
  res.json((await getRequest(req.user.workspaceId, id)).request)
})

// ── Delete ────────────────────────────────────────────────
router.delete('/:id', requireRole('admin'), async (req, res) => {
  const id = requireUuid(req.params.id)
  const { row } = await getRequest(req.user.workspaceId, id)
  const files = await query(
    `SELECT storage_key AS k FROM case_document_files WHERE case_id = $1
     UNION SELECT storage_path FROM case_documents WHERE case_id = $1 AND storage_path IS NOT NULL AND storage_path <> ''`,
    [id],
  )
  await withTransaction(async (tx) => {
    await tx.query('UPDATE signature_requests SET case_id = NULL WHERE case_id = $1', [id])
    await tx.query('DELETE FROM cases WHERE id = $1 AND workspace_id = $2', [id, req.user.workspaceId])
  })
  // Remove stored files after the rows are gone (best effort; logged on failure).
  await storage.removeMany(files.map((f) => f.k).filter(Boolean)).catch(() => {})
  await logActivity({ workspaceId: req.user.workspaceId, type: 'request_deleted', description: `Request "${row.title || row.case_type}" deleted`, actor: actorOf(req), clientId: row.client_id, clientName: row.client_name })
  publish(req.user.workspaceId, 'requests', { caseId: id })
  res.json({ ok: true })
})

// ── Duplicate / save as template ──────────────────────────
router.post('/:id/duplicate', requireWrite, async (req, res) => {
  const id = requireUuid(req.params.id)
  const b = parse(z.object({ clientId: z.string().uuid().optional() }), req.body || {})
  const { row, docs } = await getRequest(req.user.workspaceId, id)
  const clientId = b.clientId || row.client_id
  if (b.clientId && !(await queryOne('SELECT 1 FROM clients WHERE id = $1 AND workspace_id = $2', [clientId, req.user.workspaceId]))) {
    throw notFound('client_not_found', 'Client not found')
  }
  const newId = await withTransaction(async (tx) => {
    const c = await tx.queryOne(
      `INSERT INTO cases (workspace_id, client_id, case_type, title, status, assigned_owner, notes, instructions, language, reminders_enabled, public_token, created_by, last_activity_date)
       VALUES ($1,$2,$3,$3,'new',$4,$5,$6,$7,$8,$9,$10,now()) RETURNING id`,
      [req.user.workspaceId, clientId, row.title || row.case_type, req.user.name, row.notes, row.instructions, row.language, row.reminders_enabled ?? true, randomToken(32), req.user.id],
    )
    for (const d of docs) {
      await tx.query(
        `INSERT INTO case_documents (case_id, document_type_id, is_required, status, case_notes, custom_name, sort_order) VALUES ($1,$2,$3,'missing',$4,$5,$6)`,
        [c.id, d.document_type_id, d.is_required, d.case_notes, d.custom_name, d.sort_order],
      )
    }
    return c.id
  })
  await logActivity({ workspaceId: req.user.workspaceId, type: 'request_created', description: `Request duplicated from "${row.title || row.case_type}"`, actor: actorOf(req), clientId, caseId: newId })
  publish(req.user.workspaceId, 'requests', { caseId: newId })
  res.status(201).json((await getRequest(req.user.workspaceId, newId)).request)
})

router.post('/:id/save-as-template', requireWrite, async (req, res) => {
  const id = requireUuid(req.params.id)
  const b = parse(z.object({ name: z.string().trim().min(1).max(120) }), req.body)
  const { row, docs } = await getRequest(req.user.workspaceId, id)
  const items = docs.map((d) => ({ documentTypeId: d.document_type_id, required: d.is_required, note: d.case_notes || '' }))
  const t = await queryOne(
    `INSERT INTO request_templates (workspace_id, name, default_title, instructions, items, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [req.user.workspaceId, b.name, row.title || row.case_type, row.instructions || '', JSON.stringify(items), req.user.id],
  )
  publish(req.user.workspaceId, 'templates')
  res.status(201).json(serializeTemplate(t))
})

// ── Document slots ────────────────────────────────────────
async function loadSlot(req) {
  const caseId = requireUuid(req.params.id)
  const docId = requireUuid(req.params.docId)
  const slot = await queryOne(
    `SELECT cd.*, c.workspace_id, c.client_id, c.status AS case_status, cl.name AS client_name, COALESCE(cd.custom_name, dt.name) AS doc_name
       FROM case_documents cd JOIN cases c ON c.id = cd.case_id JOIN clients cl ON cl.id = c.client_id
       LEFT JOIN document_types dt ON dt.id = cd.document_type_id
      WHERE cd.id = $1 AND cd.case_id = $2 AND c.workspace_id = $3`,
    [docId, caseId, req.user.workspaceId],
  )
  if (!slot) throw notFound('document_not_found', 'Document not found')
  return slot
}

router.post('/:id/documents', requireWrite, async (req, res) => {
  const id = requireUuid(req.params.id)
  const b = parse(z.object({
    documentTypeId: z.string().uuid(), required: z.boolean().default(true), note: z.string().max(500).optional(), customName: z.string().trim().max(120).optional(),
  }), req.body)
  const { row } = await getRequest(req.user.workspaceId, id)
  await assertDocumentTypes(req.user.workspaceId, [b.documentTypeId])
  await query(
    `INSERT INTO case_documents (case_id, document_type_id, is_required, status, case_notes, custom_name, sort_order)
     VALUES ($1,$2,$3,'missing',$4,$5,(SELECT COALESCE(max(sort_order),-1)+1 FROM case_documents WHERE case_id = $1))`,
    [id, b.documentTypeId, b.required, b.note || null, b.customName || null],
  )
  await recomputeRequestStatus({ query, queryOne }, id)
  await logActivity({ workspaceId: req.user.workspaceId, type: 'document_added', description: 'Document added to request', actor: actorOf(req), clientId: row.client_id, clientName: row.client_name, caseId: id })
  publish(req.user.workspaceId, 'requests', { caseId: id })
  res.status(201).json((await getRequest(req.user.workspaceId, id)).request)
})

router.patch('/:id/documents/:docId', requireWrite, async (req, res) => {
  const slot = await loadSlot(req)
  const b = parse(z.object({
    required: z.boolean().optional(), clientNote: z.string().max(500).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(), customName: z.string().trim().max(120).nullable().optional(),
  }), req.body)
  await query(
    `UPDATE case_documents SET is_required = COALESCE($2, is_required),
       case_notes = CASE WHEN $3::boolean THEN $4 ELSE case_notes END,
       notes = CASE WHEN $5::boolean THEN $6 ELSE notes END,
       custom_name = CASE WHEN $7::boolean THEN $8 ELSE custom_name END
     WHERE id = $1`,
    [slot.id, b.required ?? null, b.clientNote !== undefined, b.clientNote ?? null, b.notes !== undefined, b.notes ?? null, b.customName !== undefined, b.customName || null],
  )
  await recomputeRequestStatus({ query, queryOne }, slot.case_id)
  publish(req.user.workspaceId, 'requests', { caseId: slot.case_id })
  res.json((await getRequest(req.user.workspaceId, slot.case_id)).request)
})

router.delete('/:id/documents/:docId', requireWrite, async (req, res) => {
  const slot = await loadSlot(req)
  const files = await query('SELECT storage_key FROM case_document_files WHERE case_document_id = $1', [slot.id])
  await query('DELETE FROM case_documents WHERE id = $1', [slot.id])
  await storage.removeMany([...files.map((f) => f.storage_key), slot.storage_path].filter(Boolean)).catch(() => {})
  await recomputeRequestStatus({ query, queryOne }, slot.case_id)
  await logActivity({ workspaceId: req.user.workspaceId, type: 'document_removed', description: `${slot.doc_name} removed from request`, actor: actorOf(req), clientId: slot.client_id, clientName: slot.client_name, caseId: slot.case_id })
  publish(req.user.workspaceId, 'requests', { caseId: slot.case_id })
  res.json((await getRequest(req.user.workspaceId, slot.case_id)).request)
})

/** Review: approve / reject (with reason) / reopen. Files are never deleted by review. */
router.post('/:id/documents/:docId/review', requireWrite, async (req, res) => {
  const slot = await loadSlot(req)
  const b = parse(z.object({
    action: z.enum(['approve', 'reject', 'reopen']),
    reason: z.string().trim().max(500).optional(),
    notifyClient: z.boolean().optional().default(true),
    channel: z.enum(['whatsapp', 'email']).optional().default('whatsapp'),
  }), req.body)
  const next = reviewTransition(slot.status, b.action)
  if (!next) throw conflict('invalid_transition', `Cannot ${b.action} a document that is ${canonicalDocStatus(slot.status)}`)
  if (b.action === 'reject' && (!b.reason || b.reason.length < 3)) throw badRequest('reason_required', 'Tell the client what needs to change')

  await withTransaction(async (tx) => {
    await tx.query(
      `UPDATE case_documents SET status = $2, rejection_reason = $3, reviewed_by = $4, reviewed_at = now() WHERE id = $1`,
      [slot.id, next, b.action === 'reject' ? b.reason : null, req.user.name],
    )
    if (slot.current_file_id) {
      await tx.query(
        `UPDATE case_document_files SET review_status = $2, review_reason = $3, reviewed_by = $4, reviewed_at = now() WHERE id = $1`,
        [slot.current_file_id, next === 'uploaded' ? 'pending' : next, b.action === 'reject' ? b.reason : null, req.user.id],
      )
    }
    await recomputeRequestStatus(tx, slot.case_id)
  })
  await logActivity({
    workspaceId: req.user.workspaceId,
    type: b.action === 'approve' ? 'document_approved' : b.action === 'reject' ? 'document_rejected' : 'document_reopened',
    description: `${slot.doc_name} ${b.action === 'approve' ? 'approved' : b.action === 'reject' ? 'rejected' : 'reopened for review'}`,
    actor: actorOf(req), clientId: slot.client_id, clientName: slot.client_name, caseId: slot.case_id, documentId: slot.id,
    metadata: b.reason ? { reason: b.reason, docName: slot.doc_name } : { docName: slot.doc_name },
  })
  let notify = null
  if (b.action === 'reject' && b.notifyClient) {
    notify = await sendRequestMessage({
      workspaceId: req.user.workspaceId, caseId: slot.case_id, kind: 'document_rejected', channel: b.channel, actor: req.user,
      idempotencyKey: `document_rejected:${slot.id}:${slot.current_file_id || Date.now()}`,
    })
  }
  publish(req.user.workspaceId, 'requests', { caseId: slot.case_id })
  res.json({ request: (await getRequest(req.user.workspaceId, slot.case_id)).request, notify })
})

/** Staff upload on the client's behalf. */
router.post('/:id/documents/:docId/upload', requireWrite, singleFile(), async (req, res) => {
  const slot = await loadSlot(req)
  if (!req.file) throw badRequest('file_required', 'Choose a file')
  await ingestUpload({
    workspaceId: req.user.workspaceId, caseId: slot.case_id, caseDocumentId: slot.id, buffer: req.file.buffer,
    fileName: req.file.originalname, via: 'staff', actor: actorOf(req), enforceClientRules: false,
  })
  res.json((await getRequest(req.user.workspaceId, slot.case_id)).request)
})

/** Short-lived URL for the current file or a specific version. */
router.get('/:id/documents/:docId/file', async (req, res) => {
  const slot = await loadSlot(req)
  let key = slot.storage_path
  let name = slot.file_name || 'document'
  let mime = slot.file_type || undefined
  if (typeof req.query.version === 'string' && req.query.version) {
    const v = await queryOne('SELECT storage_key, file_name, mime_type FROM case_document_files WHERE id = $1 AND case_document_id = $2', [requireUuid(req.query.version), slot.id])
    if (!v) throw notFound()
    key = v.storage_key
    name = v.file_name
    mime = v.mime_type
  }
  if (!key) throw notFound('no_file', 'No file uploaded yet')
  const disposition = req.query.disposition === 'attachment' ? 'attachment' : 'inline'
  const url = await storage.url(key, { fileName: name, disposition, contentType: mime })
  res.json({ url, fileName: name, mimeType: mime, expiresIn: 300 })
})

router.get('/:id/documents/:docId/versions', async (req, res) => {
  const slot = await loadSlot(req)
  const rows = await query(
    `SELECT f.id, f.file_name, f.mime_type, f.size_bytes, f.sha256, f.uploaded_via, f.review_status, f.review_reason, f.reviewed_at, f.created_at, p.name AS reviewer
       FROM case_document_files f LEFT JOIN profiles p ON p.id = f.reviewed_by
      WHERE f.case_document_id = $1 ORDER BY f.created_at DESC`,
    [slot.id],
  )
  res.json(rows.map((v) => ({
    id: v.id, fileName: v.file_name, mimeType: v.mime_type, size: v.size_bytes, sha256: v.sha256, via: v.uploaded_via,
    reviewStatus: v.review_status, reviewReason: v.review_reason || undefined, reviewedAt: v.reviewed_at || undefined,
    reviewer: v.reviewer || undefined, createdAt: v.created_at, isCurrent: v.id === slot.current_file_id,
  })))
})

// ── Sending & portal link ─────────────────────────────────
router.post('/:id/send', requireWrite, rateLimit({ name: 'send', limit: 30, windowMs: 60 * 60 * 1000, key: (req) => req.user.id }), async (req, res) => {
  const id = requireUuid(req.params.id)
  const b = parse(z.object({ channel: z.enum(['whatsapp', 'email']), kind: z.enum(['initial', 'reminder']) }), req.body)
  await getRequest(req.user.workspaceId, id)
  const result = await sendRequestMessage({
    workspaceId: req.user.workspaceId, caseId: id, kind: b.kind === 'initial' ? 'request_initial' : 'request_reminder',
    channel: b.channel, actor: req.user,
  })
  if (!result.ok) throw new HttpError(result.code === 'send_failed' ? 502 : 400, result.code, result.error || 'Message was not sent', { deliveryId: result.deliveryId })
  res.json(result)
})

/** Mark as shared manually (e.g. link copied into an email) so status moves to waiting. */
router.post('/:id/mark-sent', requireWrite, async (req, res) => {
  const id = requireUuid(req.params.id)
  const { row } = await getRequest(req.user.workspaceId, id)
  await query('UPDATE cases SET sent_at = COALESCE(sent_at, now()) WHERE id = $1', [id])
  await recomputeRequestStatus({ query, queryOne }, id)
  await logActivity({ workspaceId: req.user.workspaceId, type: 'request_sent', description: 'Portal link shared manually', actor: actorOf(req), clientId: row.client_id, clientName: row.client_name, caseId: id, metadata: { channel: 'link' } })
  publish(req.user.workspaceId, 'requests', { caseId: id })
  res.json((await getRequest(req.user.workspaceId, id)).request)
})

router.post('/:id/portal-link', requireWrite, async (req, res) => {
  const id = requireUuid(req.params.id)
  const b = parse(z.object({ action: z.enum(['regenerate', 'enable', 'disable']) }), req.body)
  const { row } = await getRequest(req.user.workspaceId, id)
  if (b.action === 'regenerate') {
    await query('UPDATE cases SET public_token = $2, portal_enabled = true WHERE id = $1', [id, randomToken(32)])
    // Old expiring upload tokens for this request are revoked as well.
    await query(`UPDATE client_upload_tokens SET expires_at = now() WHERE case_id = $1 AND expires_at > now()`, [id])
  } else {
    await query('UPDATE cases SET portal_enabled = $2 WHERE id = $1', [id, b.action === 'enable'])
  }
  await logActivity({ workspaceId: req.user.workspaceId, type: 'portal_link_changed', description: `Client link ${b.action}d`, actor: actorOf(req), clientId: row.client_id, clientName: row.client_name, caseId: id })
  publish(req.user.workspaceId, 'requests', { caseId: id })
  res.json((await getRequest(req.user.workspaceId, id)).request)
})

router.get('/:id/communications', async (req, res) => {
  const id = requireUuid(req.params.id)
  await getRequest(req.user.workspaceId, id)
  const deliveries = await query(
    `SELECT id, channel, kind, recipient, status, error, triggered_by, created_at, updated_at FROM message_deliveries
      WHERE case_id = $1 AND workspace_id = $2 ORDER BY created_at DESC LIMIT 100`,
    [id, req.user.workspaceId],
  )
  const messages = await query(
    `SELECT id, direction, message_type, content, status, error_message, created_at FROM whatsapp_messages
      WHERE case_id = $1 AND workspace_id = $2 ORDER BY created_at DESC LIMIT 100`,
    [id, req.user.workspaceId],
  )
  res.json({
    deliveries: deliveries.map((d) => ({ id: d.id, channel: d.channel, kind: d.kind, recipient: d.recipient, status: d.status, error: d.error || undefined, triggeredBy: d.triggered_by, createdAt: d.created_at, updatedAt: d.updated_at })),
    messages: messages.map((m) => ({ id: m.id, direction: m.direction, type: m.message_type, content: m.content, status: m.status, error: m.error_message || undefined, createdAt: m.created_at })),
  })
})

router.post('/:id/notes', requireWrite, async (req, res) => {
  const id = requireUuid(req.params.id)
  const b = parse(z.object({ text: z.string().trim().min(1).max(4000) }), req.body)
  const { row } = await getRequest(req.user.workspaceId, id)
  await logActivity({ workspaceId: req.user.workspaceId, type: 'note_added', description: b.text, actor: actorOf(req), clientId: row.client_id, clientName: row.client_name, caseId: id })
  await query('UPDATE cases SET last_activity_date = now() WHERE id = $1', [id])
  res.status(201).json({ ok: true })
})

/** ZIP of every current file in the request (capped at 200 MB). */
router.get('/:id/download-all', async (req, res) => {
  const id = requireUuid(req.params.id)
  const { row, docs } = await getRequest(req.user.workspaceId, id)
  const withFiles = docs.filter((d) => d.storage_path)
  if (!withFiles.length) throw notFound('no_files', 'No files to download yet')
  const total = withFiles.reduce((n, d) => n + Number(d.file_size || 0), 0)
  if (total > 200 * 1024 * 1024) throw new HttpError(413, 'too_large', 'Too many files to bundle at once; download them individually')
  const entries = []
  for (const d of withFiles) {
    const { buffer } = await storage.get(d.storage_path)
    const label = (d.custom_name || d.type_name || 'document').replace(/[\\/:*?"<>|]/g, '_')
    entries.push({ name: `${label} - ${d.file_name || 'file'}`, data: buffer, date: d.uploaded_at ? new Date(d.uploaded_at) : new Date() })
  }
  const zip = buildZip(entries)
  const name = `${row.client_name} - ${row.title || row.case_type}.zip`
  await logActivity({ workspaceId: req.user.workspaceId, type: 'documents_downloaded', description: `Downloaded ${entries.length} file(s)`, actor: actorOf(req), clientId: row.client_id, clientName: row.client_name, caseId: id })
  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', contentDisposition(name, 'attachment'))
  res.setHeader('Cache-Control', 'no-store')
  res.send(zip)
})

export { summarizeDocuments }
export default router
