/**
 * Push notification settings for the signed-in user: which events push,
 * and the devices (browser push subscriptions) that receive them.
 */
import { Router } from 'express'
import { z } from 'zod'
import { query, queryOne } from '../db/pool.mjs'
import { parse, badRequest, conflict } from '../lib/http.mjs'
import { requireAuth } from '../middleware/auth.mjs'
import { rateLimit } from '../lib/rateLimit.mjs'
import { pushStatus, pushToUsers } from '../messaging/push.mjs'
import { PUSH_EVENTS } from '../../shared/push.mjs'

const router = Router()
router.use(requireAuth)

// The server POSTs to the subscription endpoint, so only real browser push
// services are accepted (otherwise this would be a request-forgery vector).
const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com']
export function isPushServiceUrl(value) {
  let u
  try { u = new URL(value) } catch { return false }
  if (u.protocol !== 'https:' || u.port || u.username || u.password) return false
  const host = u.hostname.toLowerCase()
  return PUSH_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
}

const b64url = z.string().min(16).max(256).regex(/^[A-Za-z0-9_-]+=*$/)

router.get('/', async (req, res) => {
  const row = await queryOne('SELECT push_events FROM profiles WHERE id = $1', [req.user.id])
  const devices = await queryOne('SELECT count(*)::int AS n FROM push_subscriptions WHERE user_id = $1', [req.user.id])
  res.json({ ...pushStatus(), events: row?.push_events || [], devices: devices?.n || 0 })
})

router.put('/preferences', async (req, res) => {
  const b = parse(z.object({ events: z.array(z.enum(PUSH_EVENTS)).max(PUSH_EVENTS.length) }), req.body)
  const events = PUSH_EVENTS.filter((e) => b.events.includes(e))
  await query('UPDATE profiles SET push_events = $2 WHERE id = $1', [req.user.id, events])
  res.json({ events })
})

router.post('/subscriptions', async (req, res) => {
  if (!pushStatus().configured) throw conflict('push_not_configured', 'Push notifications are not available')
  const b = parse(z.object({
    endpoint: z.string().max(1000),
    keys: z.object({ p256dh: b64url, auth: b64url }),
    language: z.enum(['he', 'en']).default('he'),
  }), req.body)
  if (!isPushServiceUrl(b.endpoint)) throw badRequest('invalid_endpoint', 'Unsupported push service')
  // A device (endpoint) belongs to whoever subscribed last on it.
  await query(
    `INSERT INTO push_subscriptions (user_id, workspace_id, endpoint, p256dh, auth, language, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, workspace_id = EXCLUDED.workspace_id,
       p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, language = EXCLUDED.language, user_agent = EXCLUDED.user_agent`,
    [req.user.id, req.user.workspaceId, b.endpoint, b.keys.p256dh, b.keys.auth, b.language, String(req.get('user-agent') || '').slice(0, 300)],
  )
  res.status(201).json({ ok: true })
})

router.post('/subscriptions/remove', async (req, res) => {
  const b = parse(z.object({ endpoint: z.string().max(1000) }), req.body)
  await query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [b.endpoint, req.user.id])
  res.json({ ok: true })
})

router.post('/test', rateLimit({ name: 'push-test', limit: 5, windowMs: 10 * 60 * 1000, key: (req) => req.user.id }), async (req, res) => {
  const r = await pushToUsers({ userIds: [req.user.id], template: 'test', force: true, title: 'Test', actionUrl: '/app/settings/profile' })
  res.json(r)
})

export default router
