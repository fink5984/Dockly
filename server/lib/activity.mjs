/**
 * Server-side activity log and in-app notifications. Activity is written by
 * the server as a side effect of real state changes, never by the browser,
 * so the history can be trusted.
 */
import { query } from '../db/pool.mjs'
import { publish } from './events.mjs'
import { logger } from './logger.mjs'

/**
 * @param {object} e
 * @param {string} e.workspaceId
 * @param {string} e.type            e.g. 'request_created', 'document_uploaded'
 * @param {string} [e.description]   human-readable summary (English; UI localizes by type)
 * @param {{ id?: string, name?: string, type?: 'user'|'client'|'system' }} [e.actor]
 * @param {string} [e.clientId]
 * @param {string} [e.clientName]
 * @param {string} [e.caseId]
 * @param {string} [e.documentId]
 * @param {object} [e.metadata]
 * @param {object} [db] optional transaction handle
 */
export async function logActivity(e, db = { query }) {
  try {
    await db.query(
      `INSERT INTO activity_events
         (workspace_id, type, description, user_id, user_name, actor_type, client_id, client_name, case_id, document_id, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        e.workspaceId,
        e.type,
        e.description || '',
        e.actor?.id || '',
        e.actor?.name || '',
        e.actor?.type || 'user',
        e.clientId || null,
        e.clientName || null,
        e.caseId || null,
        e.documentId || null,
        e.metadata ? JSON.stringify(e.metadata) : null,
      ],
    )
    publish(e.workspaceId, 'activity', { caseId: e.caseId, clientId: e.clientId })
  } catch (err) {
    // Activity is important but must never break the user's action.
    logger.error('activity_log_failed', { type: e.type, err })
  }
}

/**
 * Notify every active member of a workspace (optionally excluding the actor).
 * `template` + `params` let the UI render the text in the viewer's language;
 * `title`/`message` are the English fallback.
 */
export async function notifyWorkspace({ workspaceId, type = 'info', title, message = '', actionUrl = null, excludeUserId = null, template = null, params = null }) {
  try {
    await query(
      `INSERT INTO notifications (workspace_id, user_id, type, title, message, action_url, template, params)
       SELECT $1, p.id, $2, $3, $4, $5, $7, $8 FROM profiles p
       WHERE p.workspace_id = $1 AND p.is_active AND ($6::uuid IS NULL OR p.id <> $6::uuid)`,
      [workspaceId, type, title, message, actionUrl, excludeUserId, template, params ? JSON.stringify(params) : null],
    )
    publish(workspaceId, 'notifications')
  } catch (err) {
    logger.error('notify_failed', { err })
  }
}
