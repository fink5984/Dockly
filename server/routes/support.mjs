import { Router } from 'express'
import { z } from 'zod'
import { query, queryOne } from '../db/pool.mjs'
import { parse, notFound, requireUuid, HttpError } from '../lib/http.mjs'
import { requireAuth, requireWrite } from '../middleware/auth.mjs'
import { publish } from '../lib/events.mjs'
import { logActivity } from '../lib/activity.mjs'
import { sendSupportReply, markSupportRead } from '../messaging/whatsappBot.mjs'

const router = Router()
router.use(requireAuth)

function serialize(sr, messages) {
  return {
    id: sr.id,
    caseId: sr.case_id,
    clientId: sr.client_id,
    clientName: sr.client_name || '',
    subject: sr.subject,
    status: sr.status,
    assignedStaff: sr.assigned_staff || undefined,
    openedAt: sr.opened_at,
    closedAt: sr.closed_at || undefined,
    issueDescription: sr.issue_description,
    messages: messages.map((m) => ({
      id: m.id, requestId: m.request_id, sender: m.sender_type, senderType: m.sender_type, senderName: m.sender_name,
      content: m.content, body: m.content, timestamp: m.created_at, sentAt: m.created_at, isRead: m.is_read,
    })),
  }
}

router.get('/', async (req, res) => {
  const params = [req.user.workspaceId]
  let where = 'c.workspace_id = $1'
  if (typeof req.query.caseId === 'string' && req.query.caseId) { params.push(requireUuid(req.query.caseId)); where += ` AND sr.case_id = $${params.length}` }
  if (req.query.open === 'true') where += ` AND sr.status NOT IN ('resolved','closed')`
  const rows = await query(
    `SELECT sr.*, cl.name AS client_name FROM support_requests sr JOIN cases c ON c.id = sr.case_id JOIN clients cl ON cl.id = sr.client_id
      WHERE ${where} ORDER BY sr.created_at DESC LIMIT 200`,
    params,
  )
  const ids = rows.map((r) => r.id)
  const msgs = ids.length ? await query('SELECT * FROM support_messages WHERE request_id = ANY($1::uuid[]) ORDER BY created_at', [ids]) : []
  res.json(rows.map((r) => serialize(r, msgs.filter((m) => m.request_id === r.id))))
})

router.post('/', requireWrite, async (req, res) => {
  const b = parse(z.object({ caseId: z.string().uuid() }), req.body)
  const c = await queryOne('SELECT c.id, c.client_id, cl.name FROM cases c JOIN clients cl ON cl.id = c.client_id WHERE c.id = $1 AND c.workspace_id = $2', [b.caseId, req.user.workspaceId])
  if (!c) throw notFound()
  const existing = await queryOne(`SELECT id FROM support_requests WHERE case_id = $1 AND status NOT IN ('resolved','closed') LIMIT 1`, [c.id])
  const id = existing?.id || (await queryOne(
    `INSERT INTO support_requests (case_id, client_id, subject, status, issue_description, assigned_staff) VALUES ($1,$2,$3,'open','',$4) RETURNING id`,
    [c.id, c.client_id, c.name, req.user.name],
  )).id
  publish(req.user.workspaceId, 'support', { caseId: c.id })
  res.status(201).json({ id })
})

async function loadOwned(req) {
  const sr = await queryOne(
    `SELECT sr.* FROM support_requests sr JOIN cases c ON c.id = sr.case_id WHERE sr.id = $1 AND c.workspace_id = $2`,
    [requireUuid(req.params.id), req.user.workspaceId],
  )
  if (!sr) throw notFound()
  return sr
}

router.post('/:id/reply', requireWrite, async (req, res) => {
  await loadOwned(req)
  const b = parse(z.object({ content: z.string().trim().min(1).max(4000) }), req.body)
  const r = await sendSupportReply({ workspaceId: req.user.workspaceId, supportRequestId: req.params.id, sender: req.user, content: b.content })
  if (!r.ok) throw new HttpError(r.code === 'send_failed' ? 502 : 400, r.code, r.error || 'Message was not sent')
  res.json(r)
})

router.post('/:id/status', requireWrite, async (req, res) => {
  const sr = await loadOwned(req)
  const b = parse(z.object({ status: z.enum(['open', 'resolved', 'closed']), notifyClient: z.boolean().optional().default(false) }), req.body)
  await query(
    `UPDATE support_requests SET status = $2, closed_at = CASE WHEN $2 IN ('resolved','closed') THEN now() ELSE NULL END WHERE id = $1`,
    [sr.id, b.status],
  )
  if (b.status !== 'open') {
    await query('UPDATE whatsapp_conversation_state SET support_mode = false, support_request_id = NULL WHERE support_request_id = $1', [sr.id])
    if (b.notifyClient) {
      await sendSupportReply({
        workspaceId: req.user.workspaceId, supportRequestId: sr.id, sender: req.user,
        content: '👋 פניית התמיכה נסגרה.\n\nאם יש לך שאלות נוספות, תמיד אפשר לשלוח "תמיכה" כדי לפתוח פנייה חדשה.',
      }).catch(() => {})
    }
  }
  await logActivity({ workspaceId: req.user.workspaceId, type: b.status === 'open' ? 'support_opened' : 'support_closed', description: `Support conversation ${b.status}`, actor: { type: 'user', id: req.user.id, name: req.user.name }, caseId: sr.case_id, clientId: sr.client_id })
  publish(req.user.workspaceId, 'support', { caseId: sr.case_id })
  res.json({ ok: true })
})

router.post('/:id/mark-read', requireWrite, async (req, res) => {
  await loadOwned(req)
  const marked = await markSupportRead({ workspaceId: req.user.workspaceId, supportRequestId: req.params.id })
  res.json({ ok: true, marked })
})

export default router
