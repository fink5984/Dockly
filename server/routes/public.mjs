/**
 * Unauthenticated endpoints reached through secret links:
 *   /p/:token      permanent request portal (cases.public_token, revocable)
 *   /upload/:token legacy expiring upload links (client_upload_tokens)
 *   /sign/:token   signing link (signature_requests.public_token)
 *
 * The token is the only credential, so: 256-bit random tokens, uniform 404s
 * for unknown tokens, per-IP rate limits, and responses that expose only
 * what the client needs (no internal notes, storage keys or other clients).
 */
import { Router } from 'express'
import { z } from 'zod'
import { query, queryOne } from '../db/pool.mjs'
import { parse, notFound, gone, badRequest, requireUuid } from '../lib/http.mjs'
import { rateLimit, clientIp } from '../lib/rateLimit.mjs'
import { singleFile } from '../lib/upload.mjs'
import { storage } from '../storage.mjs'
import { canonicalDocStatus, clientCanUpload, summarizeDocuments } from '../domain/requestStatus.mjs'
import { ingestUpload, DOC_SELECT } from '../domain/requests.mjs'
import { logoKeyOf, logoUrlOf } from './workspace.mjs'
import { loadByToken, effectiveStatus, recordView, completeSigning, declineSigning, CONSENT_TEXT } from '../signing/service.mjs'

const router = Router()

const portalLimiter = rateLimit({ name: 'portal', limit: 300, windowMs: 10 * 60 * 1000 })
const uploadLimiter = rateLimit({ name: 'portal-upload', limit: 60, windowMs: 10 * 60 * 1000 })
const signLimiter = rateLimit({ name: 'sign', limit: 200, windowMs: 10 * 60 * 1000 })

function validTokenShape(token) {
  return typeof token === 'string' && token.length >= 20 && token.length <= 200 && /^[A-Za-z0-9_-]+$/.test(token)
}

/** Resolve a portal token to its request, or throw 404/410. */
async function resolvePortal(token) {
  if (!validTokenShape(token)) throw notFound('invalid_link', 'This link is not valid')
  let c = await queryOne(
    `SELECT c.*, cl.name AS client_name FROM cases c JOIN clients cl ON cl.id = c.client_id WHERE c.public_token = $1`,
    [token],
  )
  if (c && !c.portal_enabled) throw gone('link_disabled', 'This link is no longer active')
  if (!c) {
    const t = await queryOne('SELECT case_id, expires_at FROM client_upload_tokens WHERE token = $1', [token])
    if (!t) throw notFound('invalid_link', 'This link is not valid')
    if (new Date(t.expires_at) < new Date()) throw gone('link_expired', 'This link has expired')
    c = await queryOne(`SELECT c.*, cl.name AS client_name FROM cases c JOIN clients cl ON cl.id = c.client_id WHERE c.id = $1`, [t.case_id])
    if (!c || !c.portal_enabled) throw gone('link_disabled', 'This link is no longer active')
  }
  return c
}

function publicWorkspace(ws) {
  return {
    name: ws.name,
    logo: logoUrlOf(ws),
    brandColor: ws.brand_color || undefined,
    email: ws.email || undefined,
    phone: ws.phone || undefined,
    portalMessage: ws.portal_message || undefined,
    defaultLanguage: ws.default_language === 'he' ? 'he' : 'en',
  }
}

function publicDoc(d) {
  const status = canonicalDocStatus(d.status)
  return {
    id: d.id,
    name: d.custom_name || d.type_name || 'Document',
    description: d.type_description || '',
    helperText: d.type_helper_text || '',
    clientNote: d.case_notes || '',
    required: d.is_required,
    status,
    canUpload: clientCanUpload(d.status),
    allowedFormats: d.allowed_formats || ['pdf', 'jpg', 'png'],
    maxSizeMB: d.max_size_mb || 10,
    fileName: d.file_name || undefined,
    uploadedAt: d.uploaded_at || undefined,
    rejectionReason: status === 'rejected' ? d.rejection_reason || undefined : undefined,
  }
}

router.get('/portal/:token', portalLimiter, async (req, res) => {
  const c = await resolvePortal(req.params.token)
  const ws = await queryOne('SELECT * FROM workspaces WHERE id = $1', [c.workspace_id])
  const docs = await query(
    `SELECT ${DOC_SELECT} FROM case_documents cd LEFT JOIN document_types dt ON dt.id = cd.document_type_id
      WHERE cd.case_id = $1 ORDER BY cd.sort_order, cd.created_at`,
    [c.id],
  )
  res.setHeader('Cache-Control', 'no-store')
  res.json({
    workspace: publicWorkspace(ws),
    request: {
      title: c.title || c.case_type,
      instructions: c.instructions || '',
      deadline: c.deadline || undefined,
      status: c.status,
      closed: c.status === 'closed',
      clientName: c.client_name,
      language: c.language === 'he' || c.language === 'en' ? c.language : ws.default_language === 'he' ? 'he' : 'en',
    },
    documents: docs.map(publicDoc),
    progress: summarizeDocuments(docs),
  })
})

router.post('/portal/:token/documents/:docId', uploadLimiter, singleFile(), async (req, res) => {
  const c = await resolvePortal(req.params.token)
  if (!req.file) throw badRequest('file_required', 'Choose a file to upload')
  const result = await ingestUpload({
    workspaceId: c.workspace_id,
    caseId: c.id,
    caseDocumentId: requireUuid(req.params.docId),
    buffer: req.file.buffer,
    fileName: req.file.originalname,
    via: 'portal',
    actor: { type: 'client' },
  })
  const d = await queryOne(
    `SELECT ${DOC_SELECT} FROM case_documents cd LEFT JOIN document_types dt ON dt.id = cd.document_type_id WHERE cd.id = $1`,
    [req.params.docId],
  )
  res.status(201).json({ document: publicDoc(d), requestStatus: result.status })
})

/** Clients can re-open what they uploaded (short-lived URL). */
router.get('/portal/:token/documents/:docId/file', portalLimiter, async (req, res) => {
  const c = await resolvePortal(req.params.token)
  const d = await queryOne('SELECT storage_path, file_name, file_type FROM case_documents WHERE id = $1 AND case_id = $2', [requireUuid(req.params.docId), c.id])
  if (!d?.storage_path) throw notFound()
  res.json({ url: await storage.url(d.storage_path, { fileName: d.file_name, disposition: 'inline', contentType: d.file_type || undefined, expiresIn: 120 }) })
})

/** Workspace logo (non-sensitive branding asset). */
router.get('/logo/:workspaceId', portalLimiter, async (req, res) => {
  const ws = await queryOne('SELECT id, logo_url, logo_storage_key FROM workspaces WHERE id = $1', [requireUuid(req.params.workspaceId)])
  const key = ws && logoKeyOf(ws)
  if (!key) throw notFound()
  const { buffer, contentType } = await storage.get(key)
  const type = /^image\/(png|jpeg|webp|svg\+xml|gif)$/.test(contentType || '') ? contentType : 'application/octet-stream'
  res.setHeader('Content-Type', type)
  res.setHeader('Cache-Control', 'public, max-age=86400')
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'")
  res.send(buffer)
})

// ── Signing ───────────────────────────────────────────────
function signerView(r, fields, extras) {
  return {
    title: r.title,
    description: r.description || undefined,
    status: effectiveStatus(r),
    clientName: r.client_name,
    signerName: r.signer_name || undefined,
    signedAt: r.signed_at || undefined,
    expiresAt: r.expires_at || undefined,
    canvasWidth: r.canvas_width || 750,
    language: r.language === 'he' || r.language === 'en' ? r.language : r.default_language === 'he' ? 'he' : 'en',
    workspace: {
      name: r.ws_name,
      logo: logoUrlOf({ id: r.ws_id, logo_url: r.logo_url, logo_storage_key: r.logo_storage_key, updated_at: r.updated_at }),
      brandColor: r.brand_color || undefined,
    },
    documents: [
      { id: 'main', fileName: r.document_file_name, hasSigned: Boolean(r.signed_document_path) },
      ...extras.map((d) => ({ id: d.id, fileName: d.file_name, hasSigned: Boolean(d.signed_storage_path) })),
    ],
    fields: fields.map((f) => ({
      id: f.id, type: f.type, label: f.label, page: f.page, x: f.x, y: f.y, width: f.width, height: f.height,
      required: f.required, docIndex: f.doc_index ?? 0,
    })),
    consentText: CONSENT_TEXT,
  }
}

router.get('/sign/:token', signLimiter, async (req, res) => {
  if (!validTokenShape(req.params.token)) throw notFound('invalid_link', 'This link is not valid')
  const r = await loadByToken(req.params.token)
  const fields = await query('SELECT * FROM signature_fields WHERE request_id = $1 ORDER BY doc_index, page, sort_order', [r.id])
  const extras = await query('SELECT id, file_name, signed_storage_path FROM signature_documents WHERE request_id = $1 ORDER BY sort_order, created_at', [r.id])
  res.setHeader('Cache-Control', 'no-store')
  res.json(signerView(r, fields, extras))
})

router.get('/sign/:token/file', signLimiter, async (req, res) => {
  if (!validTokenShape(req.params.token)) throw notFound()
  const r = await loadByToken(req.params.token)
  const signed = req.query.variant === 'signed'
  if (signed && r.status !== 'signed') throw notFound()
  let key
  let name
  if (!req.query.doc || req.query.doc === 'main') {
    key = signed ? r.signed_document_path : r.document_storage_path
    name = r.document_file_name
  } else {
    const d = await queryOne('SELECT * FROM signature_documents WHERE id = $1 AND request_id = $2', [requireUuid(req.query.doc), r.id])
    if (!d) throw notFound()
    key = signed ? d.signed_storage_path : d.storage_path
    name = d.file_name
  }
  if (!key) throw notFound()
  const disposition = req.query.disposition === 'attachment' ? 'attachment' : 'inline'
  res.json({ url: await storage.url(key, { fileName: signed ? name.replace(/(\.pdf)?$/i, ' (signed).pdf') : name, disposition, contentType: 'application/pdf', expiresIn: 600 }) })
})

router.post('/sign/:token/view', signLimiter, async (req, res) => {
  if (!validTokenShape(req.params.token)) throw notFound()
  await recordView(req.params.token, { ip: clientIp(req), userAgent: req.get('user-agent') || null })
  res.json({ ok: true })
})

router.post('/sign/:token/submit', rateLimit({ name: 'sign-submit', limit: 15, windowMs: 10 * 60 * 1000 }), async (req, res) => {
  if (!validTokenShape(req.params.token)) throw notFound()
  const b = parse(z.object({
    signerName: z.string().max(120),
    consent: z.boolean(),
    language: z.enum(['en', 'he']).optional(),
    values: z.array(z.object({ fieldId: z.string().uuid(), value: z.string().max(700_000) })).max(300),
  }), req.body)
  const result = await completeSigning(req.params.token, b, { ip: clientIp(req), userAgent: req.get('user-agent') || null })
  res.json({ ok: true, ...result })
})

router.post('/sign/:token/decline', rateLimit({ name: 'sign-decline', limit: 10, windowMs: 10 * 60 * 1000 }), async (req, res) => {
  if (!validTokenShape(req.params.token)) throw notFound()
  const b = parse(z.object({ reason: z.string().max(1000).optional().default('') }), req.body)
  await declineSigning(req.params.token, b, { ip: clientIp(req), userAgent: req.get('user-agent') || null })
  res.json({ ok: true })
})

export default router
