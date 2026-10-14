import { Router } from 'express'
import { z } from 'zod'
import { config } from '../config.mjs'
import { query, queryOne } from '../db/pool.mjs'
import { parse, badRequest, forbidden, notFound, conflict, requireUuid, HttpError } from '../lib/http.mjs'
import { requireAuth, requireRole, invalidateUserCache, normalizeRole, roleAtLeast } from '../middleware/auth.mjs'
import { storage, keys } from '../storage.mjs'
import { validateUpload } from '../lib/files.mjs'
import { singleFile } from '../lib/upload.mjs'
import { randomToken, sha256Hex } from '../lib/crypto.mjs'
import { subscribe, publish } from '../lib/events.mjs'
import { logActivity } from '../lib/activity.mjs'
import { channelStatus } from '../messaging/index.mjs'
import { sendEmail, renderEmail } from '../messaging/email.mjs'
import { assertSeatAvailable } from '../billing/access.mjs'
import { recordMilestone } from '../lib/funnel.mjs'

const router = Router()

export const DEFAULT_AUTOMATION = Object.freeze({
  requestReminders: { enabled: false, firstAfterDays: 2, repeatEveryDays: 3, maxReminders: 3, channel: 'whatsapp' },
  deadlineReminder: { enabled: false, daysBefore: 2 },
  signatureReminders: { enabled: false, firstAfterDays: 2, repeatEveryDays: 3, maxReminders: 2, channel: 'email' },
  quietHours: { enabled: true, start: '20:00', end: '08:00' },
  weekendDays: [5, 6],
})

export function automationSettings(ws) {
  const s = ws?.automation_settings || {}
  return {
    requestReminders: { ...DEFAULT_AUTOMATION.requestReminders, ...(s.requestReminders || {}) },
    deadlineReminder: { ...DEFAULT_AUTOMATION.deadlineReminder, ...(s.deadlineReminder || {}) },
    signatureReminders: { ...DEFAULT_AUTOMATION.signatureReminders, ...(s.signatureReminders || {}) },
    quietHours: { ...DEFAULT_AUTOMATION.quietHours, ...(s.quietHours || {}) },
    weekendDays: Array.isArray(s.weekendDays) ? s.weekendDays : DEFAULT_AUTOMATION.weekendDays,
  }
}

/** Storage key of a workspace logo, including logos saved by the old proxy URL format. */
export function logoKeyOf(ws) {
  if (ws.logo_storage_key) return ws.logo_storage_key
  const m = /^\/api\/storage\/download\?key=(.+)$/.exec(ws.logo_url || '')
  if (m) {
    try { return decodeURIComponent(m[1]) } catch { return null }
  }
  return null
}

export function logoUrlOf(ws) {
  if (logoKeyOf(ws)) return `/api/public/logo/${ws.id}?v=${new Date(ws.updated_at || ws.created_at || 0).getTime()}`
  if (ws.logo_url && /^https:\/\//.test(ws.logo_url)) return ws.logo_url
  return undefined
}

export function serializeWorkspace(ws) {
  return {
    id: ws.id,
    name: ws.name,
    businessType: ws.business_type,
    contactPerson: ws.contact_person,
    phone: ws.phone,
    email: ws.email,
    logo: logoUrlOf(ws),
    brandColor: ws.brand_color || undefined,
    portalMessage: ws.portal_message || '',
    defaultLanguage: ws.default_language === 'he' ? 'he' : 'en',
    timezone: ws.timezone,
    createdAt: ws.created_at,
  }
}

router.use(requireAuth)

// ── Workspace profile & branding ───────────────────────────
router.get('/workspace', async (req, res) => {
  const ws = await queryOne('SELECT * FROM workspaces WHERE id = $1', [req.user.workspaceId])
  res.json(serializeWorkspace(ws))
})

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color like #4338CA')

router.patch('/workspace', async (req, res) => {
  // Onboarding (empty name) may be completed by the owner; everything else needs admin.
  if (!roleAtLeast(req.user.role, 'admin')) throw forbidden()
  const b = parse(z.object({
    name: z.string().trim().min(1).max(120).optional(),
    businessType: z.string().trim().max(60).optional(),
    contactPerson: z.string().trim().max(120).optional(),
    phone: z.string().trim().max(40).optional(),
    email: z.string().trim().max(254).optional(),
    defaultLanguage: z.enum(['en', 'he']).optional(),
    timezone: z.string().trim().max(64).optional(),
    brandColor: hexColor.nullable().optional(),
    portalMessage: z.string().max(1000).optional(),
    logoUrl: z.null().optional(), // only null (remove) is accepted here
  }), req.body)
  const sets = []
  const vals = [req.user.workspaceId]
  const add = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`) }
  if (b.name !== undefined) add('name', b.name)
  if (b.businessType !== undefined) add('business_type', b.businessType)
  if (b.contactPerson !== undefined) add('contact_person', b.contactPerson)
  if (b.phone !== undefined) add('phone', b.phone)
  if (b.email !== undefined) add('email', b.email)
  if (b.defaultLanguage !== undefined) add('default_language', b.defaultLanguage)
  if (b.timezone !== undefined) add('timezone', b.timezone)
  if (b.brandColor !== undefined) add('brand_color', b.brandColor)
  if (b.portalMessage !== undefined) add('portal_message', b.portalMessage)
  if (b.logoUrl === null) { add('logo_url', null); add('logo_storage_key', null) }
  const before = await queryOne('SELECT name FROM workspaces WHERE id = $1', [req.user.workspaceId])
  if (sets.length) await query(`UPDATE workspaces SET ${sets.join(', ')} WHERE id = $1`, vals)
  const ws = await queryOne('SELECT * FROM workspaces WHERE id = $1', [req.user.workspaceId])
  // Onboarding is complete the first time the workspace gets a business name.
  if (!before?.name && ws.name) await recordMilestone(req.user.workspaceId, 'onboarding_completed', { lang: ws.default_language })
  publish(req.user.workspaceId, 'workspace')
  res.json(serializeWorkspace(ws))
})

router.post('/workspace/logo', requireRole('admin'), singleFile(2 * 1024 * 1024), async (req, res) => {
  if (!req.file) throw badRequest('file_required', 'Choose an image to upload')
  const check = validateUpload({ buffer: req.file.buffer, fileName: req.file.originalname, allowedFormats: ['png', 'jpg', 'webp'], maxBytes: 2 * 1024 * 1024 })
  if (!check.ok) throw new HttpError(415, check.code, 'Logo must be a PNG, JPG or WebP image up to 2 MB')
  const key = keys.asset(req.user.workspaceId, `logo.${check.ext}`)
  await storage.put(key, req.file.buffer, check.mime)
  const prev = await queryOne('SELECT logo_storage_key FROM workspaces WHERE id = $1', [req.user.workspaceId])
  const ws = await queryOne(
    `UPDATE workspaces SET logo_storage_key = $2, logo_url = NULL WHERE id = $1 RETURNING *`,
    [req.user.workspaceId, key],
  )
  if (prev?.logo_storage_key) storage.remove(prev.logo_storage_key).catch(() => {})
  publish(req.user.workspaceId, 'workspace')
  res.json(serializeWorkspace(ws))
})

// ── Automation settings ───────────────────────────────────
router.get('/automation', async (req, res) => {
  const ws = await queryOne('SELECT automation_settings FROM workspaces WHERE id = $1', [req.user.workspaceId])
  res.json({ settings: automationSettings(ws), channels: channelStatus(), schedulerEnabled: config.automation.enabled })
})

const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
router.put('/automation', requireRole('admin'), async (req, res) => {
  const b = parse(z.object({
    requestReminders: z.object({
      enabled: z.boolean(), firstAfterDays: z.number().int().min(1).max(60), repeatEveryDays: z.number().int().min(1).max(60),
      maxReminders: z.number().int().min(1).max(10), channel: z.enum(['whatsapp', 'email']),
    }),
    deadlineReminder: z.object({ enabled: z.boolean(), daysBefore: z.number().int().min(1).max(30) }),
    signatureReminders: z.object({
      enabled: z.boolean(), firstAfterDays: z.number().int().min(1).max(60), repeatEveryDays: z.number().int().min(1).max(60),
      maxReminders: z.number().int().min(1).max(10), channel: z.enum(['whatsapp', 'email']),
    }),
    quietHours: z.object({ enabled: z.boolean(), start: timeStr, end: timeStr }),
    weekendDays: z.array(z.number().int().min(0).max(6)).max(7),
  }), req.body)
  await query('UPDATE workspaces SET automation_settings = $2 WHERE id = $1', [req.user.workspaceId, JSON.stringify(b)])
  await logActivity({ workspaceId: req.user.workspaceId, type: 'automation_updated', description: 'Automation settings updated', actor: { type: 'user', id: req.user.id, name: req.user.name } })
  res.json({ settings: b, channels: channelStatus(), schedulerEnabled: config.automation.enabled })
})

router.get('/integrations', async (_req, res) => {
  res.json(channelStatus())
})

// ── Team ──────────────────────────────────────────────────
router.get('/team', async (req, res) => {
  const members = await query(
    `SELECT id, name, email, role, phone, is_active, last_login_at, created_at FROM profiles
      WHERE workspace_id = $1 ORDER BY is_active DESC, created_at`,
    [req.user.workspaceId],
  )
  const invites = roleAtLeast(req.user.role, 'admin')
    ? await query(
      `SELECT id, email, name, role, expires_at, created_at FROM workspace_invites
        WHERE workspace_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC`,
      [req.user.workspaceId],
    )
    : []
  res.json({
    members: members.map((m) => ({
      id: m.id, name: m.name, email: m.email, role: normalizeRole(m.role), phone: m.phone || undefined,
      isActive: m.is_active, lastLoginAt: m.last_login_at || undefined, createdAt: m.created_at, isYou: m.id === req.user.id,
    })),
    invites: invites.map((i) => ({ id: i.id, email: i.email, name: i.name, role: normalizeRole(i.role), expiresAt: i.expires_at, createdAt: i.created_at })),
  })
})

const roleSchema = z.enum(['owner', 'admin', 'member', 'viewer'])

router.post('/team/invites', requireRole('admin'), async (req, res) => {
  const b = parse(z.object({
    email: z.string().trim().toLowerCase().email().max(254),
    name: z.string().trim().max(120).optional().default(''),
    role: roleSchema.exclude(['owner']),
  }), req.body)
  if (await queryOne('SELECT 1 FROM profiles WHERE lower(email) = $1', [b.email])) {
    throw conflict('email_taken', 'This email already has a Sadir account')
  }
  await assertSeatAvailable(req.user.workspaceId)
  const token = randomToken(32)
  const inv = await queryOne(
    `INSERT INTO workspace_invites (workspace_id, email, name, role, token_hash, invited_by, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6, now() + interval '7 days') RETURNING id, expires_at`,
    [req.user.workspaceId, b.email, b.name, b.role, sha256Hex(token), req.user.id],
  )
  const link = `${config.appBaseUrl}/auth/invite/${token}`
  const ws = await queryOne('SELECT name, default_language, brand_color FROM workspaces WHERE id = $1', [req.user.workspaceId])
  const lang = ws.default_language === 'he' ? 'he' : 'en'
  const { html, text } = renderEmail({
    language: lang, brandName: ws.name, brandColor: ws.brand_color || undefined,
    heading: lang === 'he' ? `הוזמנת להצטרף ל-${ws.name} ב-Sadir` : `You're invited to join ${ws.name} on Sadir`,
    paragraphs: [lang === 'he' ? `${req.user.name} הזמין/ה אותך להצטרף לצוות.` : `${req.user.name} invited you to join the team.`],
    ctaLabel: lang === 'he' ? 'קבלת ההזמנה' : 'Accept invitation', ctaUrl: link,
    footer: lang === 'he' ? 'ההזמנה בתוקף ל-7 ימים.' : 'This invitation expires in 7 days.',
  })
  const emailed = await sendEmail({ to: b.email, subject: lang === 'he' ? `הזמנה ל-${ws.name}` : `Invitation to ${ws.name}`, html, text })
  await logActivity({ workspaceId: req.user.workspaceId, type: 'member_invited', description: `${b.email} invited as ${b.role}`, actor: { type: 'user', id: req.user.id, name: req.user.name } })
  // The link is returned once so an admin can share it when email isn't configured.
  res.status(201).json({ id: inv.id, link, expiresAt: inv.expires_at, emailed: emailed.ok })
})

router.delete('/team/invites/:id', requireRole('admin'), async (req, res) => {
  const row = await queryOne(
    'UPDATE workspace_invites SET revoked_at = now() WHERE id = $1 AND workspace_id = $2 AND accepted_at IS NULL RETURNING id',
    [requireUuid(req.params.id), req.user.workspaceId],
  )
  if (!row) throw notFound()
  res.json({ ok: true })
})

async function ownerCount(workspaceId) {
  const r = await queryOne(`SELECT count(*)::int AS n FROM profiles WHERE workspace_id = $1 AND role = 'owner' AND is_active`, [workspaceId])
  return r.n
}

router.patch('/team/members/:id', requireRole('admin'), async (req, res) => {
  const b = parse(z.object({ role: roleSchema }), req.body)
  const id = requireUuid(req.params.id)
  const target = await queryOne('SELECT id, role FROM profiles WHERE id = $1 AND workspace_id = $2', [id, req.user.workspaceId])
  if (!target) throw notFound()
  const targetRole = normalizeRole(target.role)
  // Only owners can create or demote owners.
  if ((b.role === 'owner' || targetRole === 'owner') && req.user.role !== 'owner') throw forbidden('owner_only', 'Only an owner can change owner roles')
  if (targetRole === 'owner' && b.role !== 'owner' && (await ownerCount(req.user.workspaceId)) <= 1) {
    throw conflict('last_owner', 'A workspace needs at least one owner')
  }
  await query('UPDATE profiles SET role = $2 WHERE id = $1', [id, b.role])
  invalidateUserCache(id)
  await logActivity({ workspaceId: req.user.workspaceId, type: 'member_role_changed', description: `Role changed to ${b.role}`, actor: { type: 'user', id: req.user.id, name: req.user.name }, metadata: { memberId: id } })
  res.json({ ok: true })
})

router.delete('/team/members/:id', requireRole('admin'), async (req, res) => {
  const id = requireUuid(req.params.id)
  if (id === req.user.id) throw badRequest('cannot_remove_self', 'You cannot remove yourself')
  const target = await queryOne('SELECT id, role, name FROM profiles WHERE id = $1 AND workspace_id = $2', [id, req.user.workspaceId])
  if (!target) throw notFound()
  if (normalizeRole(target.role) === 'owner' && req.user.role !== 'owner') throw forbidden('owner_only', 'Only an owner can remove an owner')
  if (normalizeRole(target.role) === 'owner' && (await ownerCount(req.user.workspaceId)) <= 1) throw conflict('last_owner', 'A workspace needs at least one owner')
  // Deactivate rather than delete: keeps authorship on history, revokes sessions.
  await query('UPDATE profiles SET is_active = false, session_version = session_version + 1 WHERE id = $1', [id])
  invalidateUserCache(id)
  await logActivity({ workspaceId: req.user.workspaceId, type: 'member_removed', description: `${target.name} removed`, actor: { type: 'user', id: req.user.id, name: req.user.name } })
  res.json({ ok: true })
})

// ── Notifications ─────────────────────────────────────────
router.get('/notifications', async (req, res) => {
  const rows = await query(
    `SELECT id, type, title, message, read, action_url, template, params, created_at FROM notifications
      WHERE user_id = $1 AND workspace_id = $2 ORDER BY created_at DESC LIMIT 50`,
    [req.user.id, req.user.workspaceId],
  )
  res.json(rows.map((n) => ({ id: n.id, type: n.type, title: n.title, message: n.message, read: n.read, actionUrl: n.action_url || undefined, template: n.template || undefined, params: n.params || undefined, timestamp: n.created_at })))
})

router.post('/notifications/read-all', async (req, res) => {
  await query('UPDATE notifications SET read = true WHERE user_id = $1 AND NOT read', [req.user.id])
  res.json({ ok: true })
})

router.post('/notifications/:id/read', async (req, res) => {
  await query('UPDATE notifications SET read = true WHERE id = $1 AND user_id = $2', [requireUuid(req.params.id), req.user.id])
  res.json({ ok: true })
})

// ── Live updates (Server-Sent Events) ─────────────────────
router.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.write('retry: 5000\n\n')
  const unsubscribe = subscribe(req.user.workspaceId, (evt) => {
    res.write(`event: change\ndata: ${JSON.stringify(evt)}\n\n`)
  })
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000)
  req.on('close', () => {
    clearInterval(heartbeat)
    unsubscribe()
  })
})

export default router
