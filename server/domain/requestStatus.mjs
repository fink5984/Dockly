/**
 * Single source of truth for document-slot and request status rules.
 * (Previously duplicated in four places with different results — audit B7.)
 *
 * Canonical document statuses written by the server:
 *   missing   — nothing usable yet (initial state, or after a replacement request)
 *   uploaded  — a file was received and awaits review
 *   approved  — reviewed and accepted
 *   rejected  — reviewed and refused; the client must upload a replacement
 * Legacy values still present in old rows are mapped onto these.
 */

export const NEEDS_UPLOAD = new Set(['missing', 'pending-upload', 'rejected', 'blurry', 'missing-pages', 'expired'])
export const AWAITING_REVIEW = new Set(['uploaded', 'received', 'under-review'])

/** @returns {'missing'|'uploaded'|'approved'|'rejected'} */
export function canonicalDocStatus(status) {
  if (status === 'approved') return 'approved'
  if (AWAITING_REVIEW.has(status)) return 'uploaded'
  if (status === 'rejected' || status === 'blurry' || status === 'missing-pages') return 'rejected'
  return 'missing'
}

/**
 * @param {{ status: string, is_required?: boolean, isRequired?: boolean }[]} docs
 */
export function summarizeDocuments(docs) {
  const s = { total: docs.length, required: 0, missing: 0, awaitingReview: 0, approved: 0, rejected: 0, received: 0, outstandingRequired: 0, percent: 0 }
  for (const d of docs) {
    const required = d.is_required ?? d.isRequired ?? true
    const c = canonicalDocStatus(d.status)
    if (required) s.required++
    if (c === 'missing') s.missing++
    if (c === 'uploaded') s.awaitingReview++
    if (c === 'approved') s.approved++
    if (c === 'rejected') s.rejected++
    if (c === 'uploaded' || c === 'approved') s.received++
    if (required && (c === 'missing' || c === 'rejected')) s.outstandingRequired++
  }
  const basis = s.required > 0 ? docs.filter((d) => d.is_required ?? d.isRequired ?? true) : docs
  const done = basis.filter((d) => {
    const c = canonicalDocStatus(d.status)
    return c === 'uploaded' || c === 'approved'
  }).length
  s.percent = basis.length ? Math.round((done / basis.length) * 100) : 0
  return s
}

/**
 * Derive the request status from its documents.
 *   new                 created, never sent, nothing received
 *   waiting-for-client  sent (or link shared) and nothing received
 *   partial-submission  something received, required items still outstanding
 *   completed           every required item received (review may still be pending)
 *   closed              closed manually; sticky
 * @param {string} current
 * @param {{ status: string, is_required?: boolean }[]} docs
 * @param {{ sent?: boolean }} [opts]
 */
export function computeRequestStatus(current, docs, { sent = false } = {}) {
  if (current === 'closed') return 'closed'
  if (docs.length === 0) return sent ? 'waiting-for-client' : 'new'
  const s = summarizeDocuments(docs)
  if (s.outstandingRequired === 0 && (s.required > 0 || s.received === s.total)) return 'completed'
  if (s.received > 0) return 'partial-submission'
  if (!sent && current === 'new') return 'new'
  return 'waiting-for-client'
}

/** Is the request past its deadline without being complete? */
export function isOverdue(request, now = new Date()) {
  if (!request.deadline) return false
  if (request.status === 'completed' || request.status === 'closed') return false
  return new Date(request.deadline).getTime() < now.getTime()
}

/** Which document statuses can the client upload into from the portal. */
export function clientCanUpload(status) {
  const c = canonicalDocStatus(status)
  return c === 'missing' || c === 'rejected' || c === 'uploaded'
}

/** Allowed staff review transitions. */
export function reviewTransition(currentStatus, action) {
  const c = canonicalDocStatus(currentStatus)
  switch (action) {
    case 'approve':
      return c === 'uploaded' || c === 'rejected' ? 'approved' : null
    case 'reject':
      return c === 'uploaded' || c === 'approved' ? 'rejected' : null
    case 'reopen':
      return c === 'approved' ? 'uploaded' : null
    default:
      return null
  }
}
