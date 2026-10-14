/**
 * Request (case) domain operations shared by the staff API, the public
 * portal and the WhatsApp bot.
 */
import { createHash } from 'crypto'
import { query, queryOne, withTransaction } from '../db/pool.mjs'
import { storage, keys } from '../storage.mjs'
import { config } from '../config.mjs'
import { validateUpload, cleanDisplayName } from '../lib/files.mjs'
import { badRequest, notFound, conflict, HttpError } from '../lib/http.mjs'
import { logActivity, notifyWorkspace } from '../lib/activity.mjs'
import { publish } from '../lib/events.mjs'
import { computeRequestStatus, summarizeDocuments, clientCanUpload, canonicalDocStatus, isOverdue } from './requestStatus.mjs'
import { assertStorage } from '../billing/access.mjs'
import { recordMilestone } from '../lib/funnel.mjs'

export const DOC_SELECT = `
  cd.id, cd.case_id, cd.document_type_id, cd.is_required, cd.status, cd.case_notes, cd.notes,
  cd.file_name, cd.file_type, cd.file_size, cd.storage_path, cd.uploaded_by, cd.uploaded_at,
  cd.reviewed_by, cd.reviewed_at, cd.rejection_reason, cd.version_count, cd.sort_order,
  cd.current_file_id, cd.custom_name, cd.created_at, cd.updated_at,
  dt.name AS type_name, dt.category AS type_category, dt.description AS type_description,
  dt.helper_text AS type_helper_text, dt.allowed_formats, dt.max_size_mb`

export function serializeDocument(d) {
  return {
    id: d.id,
    caseId: d.case_id,
    documentTypeId: d.document_type_id,
    name: d.custom_name || d.type_name || 'Document',
    documentTypeName: d.custom_name || d.type_name || 'Document',
    category: d.type_category || 'general',
    description: d.type_description || '',
    helperText: d.type_helper_text || '',
    isRequired: d.is_required,
    status: canonicalDocStatus(d.status),
    rawStatus: d.status,
    clientNote: d.case_notes || '',
    caseNotes: d.case_notes || undefined,
    notes: d.notes || undefined,
    fileName: d.file_name || undefined,
    fileType: d.file_type || undefined,
    fileSize: d.file_size ?? undefined,
    hasFile: Boolean(d.storage_path),
    uploadedBy: d.uploaded_by || undefined,
    uploadedAt: d.uploaded_at || undefined,
    reviewedBy: d.reviewed_by || undefined,
    reviewedAt: d.reviewed_at || undefined,
    rejectionReason: d.rejection_reason || undefined,
    versionCount: d.version_count ?? 0,
    sortOrder: d.sort_order,
    allowedFormats: d.allowed_formats || ['pdf', 'jpg', 'png'],
    maxSizeMB: d.max_size_mb || 10,
  }
}

export function serializeRequest(c, docs = []) {
  const progress = summarizeDocuments(docs)
  const request = {
    id: c.id,
    workspaceId: c.workspace_id,
    clientId: c.client_id,
    clientName: c.client_name || '',
    clientPhone: c.client_phone || undefined,
    clientEmail: c.client_email || undefined,
    title: c.title || c.case_type,
    caseType: c.case_type,
    status: c.status === 'delayed' ? 'waiting-for-client' : c.status,
    assignedOwner: c.assigned_owner || '',
    assignedOwnerName: c.assigned_owner || '',
    deadline: c.deadline || undefined,
    notes: c.notes || undefined,
    instructions: c.instructions || '',
    language: c.language || undefined,
    portalEnabled: c.portal_enabled ?? true,
    publicToken: c.public_token || undefined,
    sentAt: c.sent_at || undefined,
    completedAt: c.completed_at || undefined,
    closedAt: c.closed_at || undefined,
    remindersEnabled: c.reminders_enabled ?? true,
    lastReminderAt: c.last_reminder_at || undefined,
    reminderCount: c.reminder_count ?? 0,
    lastActivityDate: c.last_activity_date || undefined,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    progress,
    requiredDocuments: docs.map(serializeDocument),
  }
  request.overdue = isOverdue(request)
  return request
}

const CASE_SELECT = `c.*, cl.name AS client_name, cl.phone AS client_phone, cl.email AS client_email`

/** Load a request with its documents, scoped to the workspace (404 otherwise). */
export async function getRequest(workspaceId, caseId, db = { query, queryOne }) {
  const c = await db.queryOne(
    `SELECT ${CASE_SELECT} FROM cases c JOIN clients cl ON cl.id = c.client_id
      WHERE c.id = $1 AND c.workspace_id = $2`,
    [caseId, workspaceId],
  )
  if (!c) throw notFound('request_not_found', 'Request not found')
  const docs = await db.query(
    `SELECT ${DOC_SELECT} FROM case_documents cd
       LEFT JOIN document_types dt ON dt.id = cd.document_type_id
      WHERE cd.case_id = $1 ORDER BY cd.sort_order, cd.created_at`,
    [caseId],
  )
  return { row: c, docs, request: serializeRequest(c, docs) }
}

/**
 * Recompute and persist the request status from its documents.
 * Returns { previous, status }.
 */
export async function recomputeRequestStatus(db, caseId) {
  const c = await db.queryOne('SELECT id, status, sent_at, completed_at FROM cases WHERE id = $1 FOR UPDATE', [caseId])
  if (!c) return null
  const docs = await db.query('SELECT status, is_required FROM case_documents WHERE case_id = $1', [caseId])
  const status = computeRequestStatus(c.status, docs, { sent: Boolean(c.sent_at) })
  if (status !== c.status) {
    await db.query(
      `UPDATE cases SET status = $2,
         completed_at = CASE WHEN $2 = 'completed' THEN COALESCE(completed_at, now()) ELSE NULL END,
         last_activity_date = now()
       WHERE id = $1`,
      [caseId, status],
    )
  } else {
    await db.query('UPDATE cases SET last_activity_date = now() WHERE id = $1', [caseId])
  }
  return { previous: c.status, status }
}

/**
 * Validate, store and record an uploaded file for a request document slot.
 *
 * @param {object} p
 * @param {string} p.workspaceId
 * @param {string} p.caseId
 * @param {string} p.caseDocumentId
 * @param {Buffer} p.buffer
 * @param {string} p.fileName       original name (display only)
 * @param {'portal'|'staff'|'whatsapp'} p.via
 * @param {{ id?: string, name?: string, type: 'user'|'client'|'system' }} p.actor
 * @param {boolean} [p.enforceClientRules=true] reject uploads into approved slots
 */
export async function ingestUpload(p) {
  const slot = await queryOne(
    `SELECT cd.id, cd.status, cd.case_id, c.workspace_id, c.client_id, c.status AS case_status,
            cl.name AS client_name, COALESCE(cd.custom_name, dt.name) AS doc_name,
            dt.allowed_formats, dt.max_size_mb
       FROM case_documents cd
       JOIN cases c ON c.id = cd.case_id
       JOIN clients cl ON cl.id = c.client_id
       LEFT JOIN document_types dt ON dt.id = cd.document_type_id
      WHERE cd.id = $1 AND cd.case_id = $2 AND c.workspace_id = $3`,
    [p.caseDocumentId, p.caseId, p.workspaceId],
  )
  if (!slot) throw notFound('document_not_found', 'Document not found')
  if (slot.case_status === 'closed') throw conflict('request_closed', 'This request is closed')
  if (p.enforceClientRules !== false && !clientCanUpload(slot.status)) {
    throw conflict('already_approved', 'This document was already approved')
  }

  const displayName = cleanDisplayName(p.fileName)
  const maxBytes = Math.min(config.storage.maxUploadBytes, (slot.max_size_mb || 10) * 1024 * 1024)
  const check = validateUpload({ buffer: p.buffer, fileName: displayName, allowedFormats: slot.allowed_formats, maxBytes })
  if (!check.ok) {
    throw new HttpError(check.code === 'file_too_large' ? 413 : 415, check.code, uploadErrorMessage(check.code, slot), {
      allowedFormats: slot.allowed_formats, maxSizeMB: Math.floor(maxBytes / 1024 / 1024),
    })
  }

  // A sanitized name whose extension matches the detected content.
  const finalName = /\.[a-z0-9]{1,8}$/i.test(displayName) ? displayName : `${displayName}.${check.ext}`
  const key = keys.requestFile(p.workspaceId, p.caseId, p.caseDocumentId, finalName)
  const sha256 = createHash('sha256').update(p.buffer).digest('hex')

  // Plan storage limit (client uploads get a small buffer; staff uploads also need a writable workspace).
  await assertStorage(p.workspaceId, p.buffer.length, { via: p.via === 'staff' ? 'staff' : 'portal' })

  // Store first; only record success in the DB once storage confirmed.
  await storage.put(key, p.buffer, check.mime)

  let statusChange
  let fileId
  try {
    await withTransaction(async (tx) => {
      await tx.query(
        `UPDATE case_document_files SET review_status = 'superseded'
          WHERE case_document_id = $1 AND review_status = 'pending'`,
        [p.caseDocumentId],
      )
      const file = await tx.queryOne(
        `INSERT INTO case_document_files
           (workspace_id, case_id, case_document_id, storage_key, file_name, mime_type, size_bytes, sha256, uploaded_via, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [p.workspaceId, p.caseId, p.caseDocumentId, key, finalName, check.mime, p.buffer.length, sha256, p.via,
          p.actor?.type === 'user' ? `user:${p.actor.id}` : `${p.via}:${slot.client_id}`],
      )
      fileId = file.id
      await tx.query(
        `UPDATE case_documents SET
           status = 'uploaded', file_name = $2, file_type = $3, file_size = $4, storage_path = $5,
           storage_status = 'ready', uploaded_by = $6, uploaded_at = now(), current_file_id = $7,
           rejection_reason = NULL, reviewed_by = NULL, reviewed_at = NULL,
           version_count = version_count + 1
         WHERE id = $1`,
        [p.caseDocumentId, finalName, check.mime, p.buffer.length, key,
          p.actor?.type === 'user' ? `user:${p.actor.id}` : `${p.via}:${slot.client_id}`, file.id],
      )
      statusChange = await recomputeRequestStatus(tx, p.caseId)
    })
  } catch (err) {
    // Don't leave an orphan object behind if the DB write failed.
    await storage.remove(key).catch(() => {})
    throw err
  }

  const actor = p.actor || { type: 'client', name: slot.client_name }
  await logActivity({
    workspaceId: p.workspaceId,
    type: 'document_uploaded',
    description: `${slot.doc_name} uploaded`,
    actor: actor.type === 'client' ? { type: 'client', name: slot.client_name, id: slot.client_id } : actor,
    clientId: slot.client_id,
    clientName: slot.client_name,
    caseId: p.caseId,
    documentId: p.caseDocumentId,
    metadata: { via: p.via, fileName: finalName, docName: slot.doc_name },
  })
  if (actor.type !== 'user') {
    await notifyWorkspace({
      workspaceId: p.workspaceId,
      type: 'info',
      title: `${slot.client_name} uploaded ${slot.doc_name}`,
      template: 'document_uploaded',
      params: { client: slot.client_name, document: slot.doc_name },
      message: finalName,
      actionUrl: `/app/requests/${p.caseId}`,
    })
  }
  if (statusChange && statusChange.status === 'completed' && statusChange.previous !== 'completed') {
    await logActivity({
      workspaceId: p.workspaceId,
      type: 'request_completed',
      description: 'All required documents received',
      actor: { type: 'system' },
      clientId: slot.client_id,
      clientName: slot.client_name,
      caseId: p.caseId,
    })
    await notifyWorkspace({
      workspaceId: p.workspaceId,
      type: 'success',
      title: `${slot.client_name} submitted every required document`,
      template: 'request_completed',
      params: { client: slot.client_name },
      actionUrl: `/app/requests/${p.caseId}`,
    })
  }
  publish(p.workspaceId, 'requests', { caseId: p.caseId })
  if (p.via !== 'staff') await recordMilestone(p.workspaceId, 'first_upload_completed', { via: p.via })
  return { fileId, key, fileName: finalName, mime: check.mime, size: p.buffer.length, status: statusChange?.status }
}

function uploadErrorMessage(code, slot) {
  switch (code) {
    case 'file_too_large': return `The file is larger than ${slot.max_size_mb || 10} MB`
    case 'file_type_not_allowed': return `This file type isn't accepted here. Allowed: ${(slot.allowed_formats || []).join(', ')}`
    case 'unsupported_file_type': return 'This file type is not supported, or the file is damaged'
    case 'empty_file': return 'The file is empty'
    default: return 'The file could not be accepted'
  }
}

/** Throws unless every id in `documentTypeIds` belongs to the workspace. */
export async function assertDocumentTypes(workspaceId, documentTypeIds) {
  if (!documentTypeIds.length) return
  const rows = await query('SELECT id FROM document_types WHERE workspace_id = $1 AND id = ANY($2::uuid[])', [workspaceId, documentTypeIds])
  if (rows.length !== new Set(documentTypeIds).size) throw badRequest('invalid_document_type', 'Unknown document type')
}
