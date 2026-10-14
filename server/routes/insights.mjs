/**
 * Read models: dashboard, global search, activity feed, document library.
 * Every number here is computed from real rows — no placeholders.
 */
import { Router } from 'express'
import { query, queryOne } from '../db/pool.mjs'
import { requireAuth } from '../middleware/auth.mjs'
import { requireUuid } from '../lib/http.mjs'
import { escapeLike } from './clients.mjs'
import { storageUsedBytes } from '../billing/access.mjs'

const router = Router()
router.use(requireAuth)

router.get('/dashboard', async (req, res) => {
  const ws = req.user.workspaceId
  const k = await queryOne(
    `SELECT
       (SELECT count(*)::int FROM cases WHERE workspace_id = $1 AND status IN ('new','waiting-for-client','partial-submission','delayed')) AS active_requests,
       (SELECT count(*)::int FROM cases WHERE workspace_id = $1 AND status IN ('waiting-for-client','partial-submission','delayed')) AS awaiting_client,
       (SELECT count(*)::int FROM cases WHERE workspace_id = $1 AND status = 'new') AS drafts,
       (SELECT count(DISTINCT c.id)::int FROM cases c JOIN case_documents d ON d.case_id = c.id
          WHERE c.workspace_id = $1 AND c.status <> 'closed' AND d.status IN ('uploaded','received','under-review')) AS requests_needing_review,
       (SELECT count(*)::int FROM case_documents d JOIN cases c ON c.id = d.case_id
          WHERE c.workspace_id = $1 AND c.status <> 'closed' AND d.status IN ('uploaded','received','under-review')) AS documents_needing_review,
       (SELECT count(*)::int FROM cases WHERE workspace_id = $1 AND status = 'completed') AS completed_requests,
       (SELECT count(*)::int FROM cases WHERE workspace_id = $1 AND completed_at >= date_trunc('month', now())) AS completed_this_month,
       (SELECT count(*)::int FROM cases WHERE workspace_id = $1 AND deadline < now() AND status NOT IN ('completed','closed')) AS overdue,
       (SELECT count(*)::int FROM signature_requests WHERE workspace_id = $1 AND deleted_at IS NULL AND status IN ('pending','viewed') AND (expires_at IS NULL OR expires_at > now())) AS pending_signatures,
       (SELECT count(*)::int FROM signature_requests WHERE workspace_id = $1 AND deleted_at IS NULL AND status = 'signed') AS completed_signatures,
       (SELECT count(*)::int FROM signature_requests WHERE workspace_id = $1 AND deleted_at IS NULL AND signed_at >= date_trunc('month', now())) AS signed_this_month,
       (SELECT count(*)::int FROM clients WHERE workspace_id = $1 AND status = 'active') AS active_clients,
       (SELECT count(*)::int FROM support_requests sr JOIN cases c ON c.id = sr.case_id WHERE c.workspace_id = $1 AND sr.status = 'waiting-for-staff') AS support_waiting`,
    [ws],
  )

  // Prioritised, actionable items (each links somewhere real).
  const review = await query(
    `SELECT c.id, COALESCE(c.title, c.case_type) AS title, cl.name AS client_name, count(d.id)::int AS n, max(d.uploaded_at) AS at
       FROM cases c JOIN clients cl ON cl.id = c.client_id JOIN case_documents d ON d.case_id = c.id
      WHERE c.workspace_id = $1 AND c.status <> 'closed' AND d.status IN ('uploaded','received','under-review')
      GROUP BY c.id, cl.name ORDER BY max(d.uploaded_at) DESC NULLS LAST LIMIT 8`,
    [ws],
  )
  const overdue = await query(
    `SELECT c.id, COALESCE(c.title, c.case_type) AS title, cl.name AS client_name, c.deadline AS at
       FROM cases c JOIN clients cl ON cl.id = c.client_id
      WHERE c.workspace_id = $1 AND c.deadline < now() AND c.status NOT IN ('completed','closed')
      ORDER BY c.deadline ASC LIMIT 8`,
    [ws],
  )
  const stalled = await query(
    `SELECT c.id, COALESCE(c.title, c.case_type) AS title, cl.name AS client_name, COALESCE(c.last_activity_date, c.sent_at) AS at,
            (SELECT count(*)::int FROM case_documents d WHERE d.case_id = c.id AND d.status IN ('missing','pending-upload','rejected')) AS n
       FROM cases c JOIN clients cl ON cl.id = c.client_id
      WHERE c.workspace_id = $1 AND c.status IN ('waiting-for-client','partial-submission','delayed')
        AND COALESCE(c.last_activity_date, c.sent_at, c.created_at) < now() - interval '5 days'
        AND (c.deadline IS NULL OR c.deadline >= now())
      ORDER BY COALESCE(c.last_activity_date, c.sent_at, c.created_at) ASC LIMIT 8`,
    [ws],
  )
  const unsent = await query(
    `SELECT c.id, COALESCE(c.title, c.case_type) AS title, cl.name AS client_name, c.created_at AS at
       FROM cases c JOIN clients cl ON cl.id = c.client_id
      WHERE c.workspace_id = $1 AND c.status = 'new' AND c.sent_at IS NULL ORDER BY c.created_at DESC LIMIT 5`,
    [ws],
  )
  const signatures = await query(
    `SELECT s.id, s.title, cl.name AS client_name, s.created_at AS at, s.status
       FROM signature_requests s JOIN clients cl ON cl.id = s.client_id
      WHERE s.workspace_id = $1 AND s.deleted_at IS NULL AND s.status IN ('pending','viewed')
        AND (s.expires_at IS NULL OR s.expires_at > now()) AND s.created_at < now() - interval '2 days'
      ORDER BY s.created_at ASC LIMIT 6`,
    [ws],
  )
  const support = await query(
    `SELECT c.id, COALESCE(c.title, c.case_type) AS title, cl.name AS client_name, max(m.created_at) AS at
       FROM support_requests sr JOIN cases c ON c.id = sr.case_id JOIN clients cl ON cl.id = sr.client_id
       LEFT JOIN support_messages m ON m.request_id = sr.id
      WHERE c.workspace_id = $1 AND sr.status = 'waiting-for-staff' GROUP BY c.id, cl.name ORDER BY max(m.created_at) DESC NULLS LAST LIMIT 5`,
    [ws],
  )
  const actions = [
    ...support.map((r) => ({ kind: 'support', id: r.id, title: r.title, clientName: r.client_name, at: r.at, href: `/app/requests/${r.id}?panel=support` })),
    ...review.map((r) => ({ kind: 'review', id: r.id, title: r.title, clientName: r.client_name, count: r.n, at: r.at, href: `/app/requests/${r.id}` })),
    ...overdue.map((r) => ({ kind: 'overdue', id: r.id, title: r.title, clientName: r.client_name, at: r.at, href: `/app/requests/${r.id}` })),
    ...stalled.map((r) => ({ kind: 'stalled', id: r.id, title: r.title, clientName: r.client_name, count: r.n, at: r.at, href: `/app/requests/${r.id}` })),
    ...signatures.map((r) => ({ kind: 'signature', id: r.id, title: r.title, clientName: r.client_name, at: r.at, href: `/app/signatures/${r.id}` })),
    ...unsent.map((r) => ({ kind: 'unsent', id: r.id, title: r.title, clientName: r.client_name, at: r.at, href: `/app/requests/${r.id}` })),
  ]

  const pipeline = await query(
    `SELECT CASE WHEN status = 'delayed' THEN 'waiting-for-client' ELSE status END AS status, count(*)::int AS n
       FROM cases WHERE workspace_id = $1 GROUP BY 1`,
    [ws],
  )
  const trend = await query(
    `WITH weeks AS (SELECT generate_series(date_trunc('week', now()) - interval '7 weeks', date_trunc('week', now()), interval '1 week') AS wk)
     SELECT to_char(w.wk, 'YYYY-MM-DD') AS week,
       (SELECT count(*)::int FROM cases c WHERE c.workspace_id = $1 AND c.created_at >= w.wk AND c.created_at < w.wk + interval '1 week') AS created,
       (SELECT count(*)::int FROM cases c WHERE c.workspace_id = $1 AND c.completed_at >= w.wk AND c.completed_at < w.wk + interval '1 week') AS completed,
       (SELECT count(*)::int FROM case_document_files f WHERE f.workspace_id = $1 AND f.created_at >= w.wk AND f.created_at < w.wk + interval '1 week') AS uploads,
       (SELECT count(*)::int FROM signature_requests s WHERE s.workspace_id = $1 AND s.signed_at >= w.wk AND s.signed_at < w.wk + interval '1 week') AS signed
     FROM weeks w ORDER BY w.wk`,
    [ws],
  )
  const avg = await queryOne(
    `SELECT avg(extract(epoch FROM (completed_at - COALESCE(sent_at, created_at))) / 86400)::float AS days
       FROM cases WHERE workspace_id = $1 AND completed_at IS NOT NULL AND completed_at > now() - interval '90 days'`,
    [ws],
  )
  const onboarding = await queryOne(
    `SELECT
       EXISTS (SELECT 1 FROM clients WHERE workspace_id = $1) AS has_client,
       EXISTS (SELECT 1 FROM cases WHERE workspace_id = $1) AS has_request,
       EXISTS (SELECT 1 FROM cases WHERE workspace_id = $1 AND sent_at IS NOT NULL) AS has_sent,
       EXISTS (SELECT 1 FROM signature_requests WHERE workspace_id = $1) AS has_signature,
       EXISTS (SELECT 1 FROM workspaces WHERE id = $1 AND (logo_storage_key IS NOT NULL OR logo_url IS NOT NULL OR brand_color IS NOT NULL)) AS has_branding,
       EXISTS (SELECT 1 FROM request_templates WHERE workspace_id = $1) AS has_template`,
    [ws],
  )

  res.json({
    kpis: {
      activeRequests: k.active_requests,
      awaitingClient: k.awaiting_client,
      drafts: k.drafts,
      requestsNeedingReview: k.requests_needing_review,
      documentsNeedingReview: k.documents_needing_review,
      completedRequests: k.completed_requests,
      completedThisMonth: k.completed_this_month,
      overdue: k.overdue,
      pendingSignatures: k.pending_signatures,
      completedSignatures: k.completed_signatures,
      signedThisMonth: k.signed_this_month,
      activeClients: k.active_clients,
      supportWaiting: k.support_waiting,
      avgDaysToComplete: avg?.days != null ? Math.round(avg.days * 10) / 10 : null,
    },
    actions,
    pipeline: Object.fromEntries(pipeline.map((p) => [p.status, p.n])),
    trend: trend.map((t) => ({ week: t.week, created: t.created, completed: t.completed, uploads: t.uploads, signed: t.signed })),
    onboarding: {
      hasClient: onboarding.has_client, hasRequest: onboarding.has_request, hasSent: onboarding.has_sent,
      hasSignature: onboarding.has_signature, hasBranding: onboarding.has_branding, hasTemplate: onboarding.has_template,
    },
  })
})

router.get('/search', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : ''
  if (q.length < 2) return res.json({ clients: [], requests: [], signatures: [] })
  const like = `%${escapeLike(q)}%`
  const ws = req.user.workspaceId
  const [clients, requests, signatures] = await Promise.all([
    query(`SELECT id, name, email, phone FROM clients WHERE workspace_id = $1 AND (name ILIKE $2 OR email ILIKE $2 OR phone ILIKE $2 OR company ILIKE $2) ORDER BY name LIMIT 6`, [ws, like]),
    query(`SELECT c.id, COALESCE(c.title, c.case_type) AS title, c.status, cl.name AS client_name FROM cases c JOIN clients cl ON cl.id = c.client_id
            WHERE c.workspace_id = $1 AND (COALESCE(c.title, c.case_type) ILIKE $2 OR cl.name ILIKE $2) ORDER BY c.created_at DESC LIMIT 6`, [ws, like]),
    query(`SELECT s.id, s.title, s.status, cl.name AS client_name FROM signature_requests s JOIN clients cl ON cl.id = s.client_id
            WHERE s.workspace_id = $1 AND s.deleted_at IS NULL AND (s.title ILIKE $2 OR cl.name ILIKE $2) ORDER BY s.created_at DESC LIMIT 6`, [ws, like]),
  ])
  res.json({
    clients: clients.map((c) => ({ id: c.id, name: c.name, email: c.email, phone: c.phone })),
    requests: requests.map((r) => ({ id: r.id, title: r.title, status: r.status, clientName: r.client_name })),
    signatures: signatures.map((s) => ({ id: s.id, title: s.title, status: s.status, clientName: s.client_name })),
  })
})

export function serializeActivity(a) {
  return {
    id: a.id,
    workspaceId: a.workspace_id,
    type: a.type,
    description: a.description,
    userId: a.user_id,
    userName: a.user_name,
    performedByName: a.user_name,
    actorType: a.actor_type || 'user',
    clientId: a.client_id || undefined,
    clientName: a.client_name || undefined,
    caseId: a.case_id || undefined,
    documentId: a.document_id || undefined,
    timestamp: a.created_at,
    metadata: a.metadata || undefined,
  }
}

router.get('/activity', async (req, res) => {
  const params = [req.user.workspaceId]
  let where = 'workspace_id = $1'
  if (typeof req.query.caseId === 'string' && req.query.caseId) { params.push(requireUuid(req.query.caseId)); where += ` AND case_id = $${params.length}` }
  if (typeof req.query.clientId === 'string' && req.query.clientId) { params.push(requireUuid(req.query.clientId)); where += ` AND client_id = $${params.length}` }
  if (typeof req.query.before === 'string' && !Number.isNaN(Date.parse(req.query.before))) { params.push(req.query.before); where += ` AND created_at < $${params.length}` }
  if (typeof req.query.type === 'string' && /^[a-z_-]{2,40}$/.test(req.query.type)) { params.push(req.query.type); where += ` AND type = $${params.length}` }
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50))
  const rows = await query(`SELECT * FROM activity_events WHERE ${where} ORDER BY created_at DESC LIMIT ${limit}`, params)
  res.json(rows.map(serializeActivity))
})

/** Unified document library: request uploads (current versions) + signature documents. */
router.get('/documents', async (req, res) => {
  const ws = req.user.workspaceId
  const params = [ws]
  const filters = []
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : ''
  if (search) { params.push(`%${escapeLike(search)}%`); filters.push(`(x.file_name ILIKE $${params.length} OR x.label ILIKE $${params.length} OR x.client_name ILIKE $${params.length})`) }
  if (typeof req.query.clientId === 'string' && req.query.clientId) { params.push(requireUuid(req.query.clientId)); filters.push(`x.client_id = $${params.length}`) }
  if (req.query.source === 'requests' || req.query.source === 'signatures') { params.push(req.query.source); filters.push(`x.source = $${params.length}`) }
  if (typeof req.query.status === 'string' && /^[a-z-]{2,30}$/.test(req.query.status)) { params.push(req.query.status); filters.push(`x.status = $${params.length}`) }
  if (typeof req.query.from === 'string' && !Number.isNaN(Date.parse(req.query.from))) { params.push(req.query.from); filters.push(`x.at >= $${params.length}`) }
  if (typeof req.query.to === 'string' && !Number.isNaN(Date.parse(req.query.to))) { params.push(req.query.to); filters.push(`x.at < ($${params.length}::date + 1)`) }
  if (typeof req.query.type === 'string' && /^[a-z]{2,10}$/.test(req.query.type)) {
    const t = req.query.type
    const like = t === 'image' ? 'image/%' : t === 'pdf' ? 'application/pdf' : '%'
    params.push(like)
    filters.push(`x.mime LIKE $${params.length}`)
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
  const rows = await query(
    `WITH x AS (
       SELECT 'requests' AS source, cd.id, cd.case_id AS parent_id, COALESCE(c.title, c.case_type) AS parent_title,
              COALESCE(cd.custom_name, dt.name) AS label, cd.file_name, cd.file_type AS mime, cd.file_size AS size,
              CASE WHEN cd.status IN ('received','under-review') THEN 'uploaded' WHEN cd.status IN ('blurry','missing-pages') THEN 'rejected' ELSE cd.status END AS status,
              cd.uploaded_at AS at, c.client_id, cl.name AS client_name, cd.version_count AS versions
         FROM case_documents cd JOIN cases c ON c.id = cd.case_id JOIN clients cl ON cl.id = c.client_id
         LEFT JOIN document_types dt ON dt.id = cd.document_type_id
        WHERE c.workspace_id = $1 AND cd.storage_path IS NOT NULL AND cd.storage_path <> ''
       UNION ALL
       SELECT 'signatures', s.id, s.id, s.title, s.title, s.document_file_name, 'application/pdf', s.document_file_size,
              s.status, COALESCE(s.signed_at, s.created_at), s.client_id, cl.name, 1
         FROM signature_requests s JOIN clients cl ON cl.id = s.client_id
        WHERE s.workspace_id = $1 AND s.deleted_at IS NULL
     )
     SELECT * FROM x ${where} ORDER BY at DESC NULLS LAST LIMIT 500`,
    params,
  )
  // Same measurement the plan's storage limit uses.
  const usage = {
    bytes: await storageUsedBytes(ws),
    versions: (await queryOne('SELECT count(*)::int AS n FROM case_document_files WHERE workspace_id = $1', [ws])).n,
  }
  res.json({
    items: rows.map((r) => ({
      source: r.source, id: r.id, parentId: r.parent_id, parentTitle: r.parent_title, label: r.label, fileName: r.file_name,
      mimeType: r.mime, size: r.size, status: r.status, at: r.at, clientId: r.client_id, clientName: r.client_name, versions: r.versions,
    })),
    usage: { bytes: Number(usage.bytes), versions: usage.versions },
  })
})

export default router
