import { Router } from 'express'
import { z } from 'zod'
import { query, queryOne } from '../db/pool.mjs'
import { parse, notFound, conflict, requireUuid } from '../lib/http.mjs'
import { requireAuth, requireWrite, requireRole } from '../middleware/auth.mjs'
import { logActivity } from '../lib/activity.mjs'
import { publish } from '../lib/events.mjs'
import { normalizePhone } from '../messaging/phone.mjs'
import { summarizeDocuments } from '../domain/requestStatus.mjs'

const router = Router()
router.use(requireAuth)

export function serializeClient(c) {
  return {
    id: c.id,
    workspaceId: c.workspace_id,
    name: c.name,
    fullName: c.name,
    email: c.email,
    phone: c.phone,
    phoneValid: Boolean(normalizePhone(c.phone)),
    company: c.company || undefined,
    notes: c.notes || undefined,
    status: c.status,
    assignedOwner: c.assigned_owner,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    stats: c.request_count !== undefined ? {
      requests: c.request_count,
      openRequests: c.open_request_count,
      signatures: c.signature_count,
      lastActivityAt: c.last_activity_at || undefined,
    } : undefined,
  }
}

export const escapeLike = (s) => s.replace(/[\\%_]/g, (m) => `\\${m}`)

router.get('/', async (req, res) => {
  const q = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : ''
  const status = typeof req.query.status === 'string' ? req.query.status : ''
  const params = [req.user.workspaceId]
  let where = 'c.workspace_id = $1'
  if (q) {
    params.push(`%${escapeLike(q)}%`)
    where += ` AND (c.name ILIKE $${params.length} OR c.email ILIKE $${params.length} OR c.phone ILIKE $${params.length} OR c.company ILIKE $${params.length})`
  }
  if (['active', 'inactive', 'archived'].includes(status)) {
    params.push(status)
    where += ` AND c.status = $${params.length}`
  }
  const rows = await query(
    `SELECT c.*,
       (SELECT count(*)::int FROM cases x WHERE x.client_id = c.id) AS request_count,
       (SELECT count(*)::int FROM cases x WHERE x.client_id = c.id AND x.status NOT IN ('completed','closed')) AS open_request_count,
       (SELECT count(*)::int FROM signature_requests s WHERE s.client_id = c.id AND s.deleted_at IS NULL) AS signature_count,
       GREATEST(c.updated_at, (SELECT max(x.last_activity_date) FROM cases x WHERE x.client_id = c.id)) AS last_activity_at
     FROM clients c WHERE ${where} ORDER BY c.created_at DESC LIMIT 1000`,
    params,
  )
  res.json(rows.map(serializeClient))
})

router.get('/:id', async (req, res) => {
  const c = await queryOne('SELECT * FROM clients WHERE id = $1 AND workspace_id = $2', [requireUuid(req.params.id), req.user.workspaceId])
  if (!c) throw notFound('client_not_found', 'Client not found')
  res.json(serializeClient(c))
})

/** Everything on the client profile in one call. */
router.get('/:id/overview', async (req, res) => {
  const id = requireUuid(req.params.id)
  const c = await queryOne('SELECT * FROM clients WHERE id = $1 AND workspace_id = $2', [id, req.user.workspaceId])
  if (!c) throw notFound('client_not_found', 'Client not found')
  const cases = await query(
    `SELECT c.id, COALESCE(c.title, c.case_type) AS title, c.status, c.deadline, c.created_at, c.last_activity_date,
            json_agg(json_build_object('status', d.status, 'is_required', d.is_required)) FILTER (WHERE d.id IS NOT NULL) AS docs
       FROM cases c LEFT JOIN case_documents d ON d.case_id = c.id
      WHERE c.client_id = $1 AND c.workspace_id = $2 GROUP BY c.id ORDER BY c.created_at DESC`,
    [id, req.user.workspaceId],
  )
  const signatures = await query(
    `SELECT id, title, status, created_at, signed_at, expires_at FROM signature_requests
      WHERE client_id = $1 AND workspace_id = $2 AND deleted_at IS NULL ORDER BY created_at DESC`,
    [id, req.user.workspaceId],
  )
  const documents = await query(
    `SELECT cd.id, cd.case_id, COALESCE(cd.custom_name, dt.name) AS name, cd.status, cd.file_name, cd.file_type, cd.file_size, cd.uploaded_at
       FROM case_documents cd JOIN cases c ON c.id = cd.case_id LEFT JOIN document_types dt ON dt.id = cd.document_type_id
      WHERE c.client_id = $1 AND c.workspace_id = $2 AND cd.storage_path IS NOT NULL AND cd.storage_path <> ''
      ORDER BY cd.uploaded_at DESC NULLS LAST LIMIT 200`,
    [id, req.user.workspaceId],
  )
  const messages = await query(
    `SELECT id, direction, message_type, content, status, created_at FROM whatsapp_messages
      WHERE client_id = $1 AND workspace_id = $2 ORDER BY created_at DESC LIMIT 50`,
    [id, req.user.workspaceId],
  )
  res.json({
    client: serializeClient(c),
    requests: cases.map((r) => ({
      id: r.id, title: r.title, status: r.status, deadline: r.deadline || undefined, createdAt: r.created_at,
      lastActivityDate: r.last_activity_date || undefined, progress: summarizeDocuments(r.docs || []),
    })),
    signatures: signatures.map((s) => ({ id: s.id, title: s.title, status: s.status, createdAt: s.created_at, signedAt: s.signed_at || undefined, expiresAt: s.expires_at || undefined })),
    documents: documents.map((d) => ({ id: d.id, requestId: d.case_id, name: d.name, status: d.status, fileName: d.file_name, fileType: d.file_type, fileSize: d.file_size, uploadedAt: d.uploaded_at })),
    messages: messages.map((m) => ({ id: m.id, direction: m.direction, type: m.message_type, content: m.content, status: m.status, createdAt: m.created_at })),
  })
})

const clientBody = z.object({
  name: z.string().trim().min(1).max(160),
  email: z.string().trim().max(254).refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Invalid email').optional().default(''),
  phone: z.string().trim().max(40).optional().default(''),
  company: z.string().trim().max(160).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  assignedOwner: z.string().trim().max(120).optional(),
  status: z.enum(['active', 'inactive', 'archived']).optional(),
})

router.post('/', requireWrite, async (req, res) => {
  const b = parse(clientBody, req.body)
  const c = await queryOne(
    `INSERT INTO clients (workspace_id, name, email, phone, company, notes, assigned_owner, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'active') RETURNING *`,
    [req.user.workspaceId, b.name, b.email, b.phone, b.company ?? null, b.notes ?? null, b.assignedOwner ?? req.user.name],
  )
  await logActivity({ workspaceId: req.user.workspaceId, type: 'client_created', description: `Client ${b.name} created`, actor: { type: 'user', id: req.user.id, name: req.user.name }, clientId: c.id, clientName: c.name })
  publish(req.user.workspaceId, 'clients', { clientId: c.id })
  res.status(201).json(serializeClient(c))
})

router.patch('/:id', requireWrite, async (req, res) => {
  const b = parse(clientBody.partial(), req.body)
  const id = requireUuid(req.params.id)
  const map = { name: 'name', email: 'email', phone: 'phone', company: 'company', notes: 'notes', assignedOwner: 'assigned_owner', status: 'status' }
  const sets = []
  const vals = [id, req.user.workspaceId]
  for (const [k, col] of Object.entries(map)) {
    if (b[k] !== undefined) { vals.push(b[k]); sets.push(`${col} = $${vals.length}`) }
  }
  const c = sets.length
    ? await queryOne(`UPDATE clients SET ${sets.join(', ')} WHERE id = $1 AND workspace_id = $2 RETURNING *`, vals)
    : await queryOne('SELECT * FROM clients WHERE id = $1 AND workspace_id = $2', [id, req.user.workspaceId])
  if (!c) throw notFound('client_not_found', 'Client not found')
  publish(req.user.workspaceId, 'clients', { clientId: c.id })
  res.json(serializeClient(c))
})

router.delete('/:id', requireRole('admin'), async (req, res) => {
  const id = requireUuid(req.params.id)
  const c = await queryOne('SELECT id, name FROM clients WHERE id = $1 AND workspace_id = $2', [id, req.user.workspaceId])
  if (!c) throw notFound('client_not_found', 'Client not found')
  const deps = await queryOne(
    `SELECT (SELECT count(*)::int FROM cases WHERE client_id = $1) AS requests,
            (SELECT count(*)::int FROM signature_requests WHERE client_id = $1) AS signatures`,
    [id],
  )
  if (deps.requests > 0 || deps.signatures > 0) {
    // Deleting would cascade into documents and the signature audit trail.
    throw conflict('client_has_records', 'This client has requests or signatures. Archive the client instead.', deps)
  }
  await query('DELETE FROM clients WHERE id = $1 AND workspace_id = $2', [id, req.user.workspaceId])
  await logActivity({ workspaceId: req.user.workspaceId, type: 'client_deleted', description: `Client ${c.name} deleted`, actor: { type: 'user', id: req.user.id, name: req.user.name } })
  publish(req.user.workspaceId, 'clients', { clientId: id })
  res.json({ ok: true })
})

export default router
