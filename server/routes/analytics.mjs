/**
 * Anonymous marketing-site events (landing visit, pricing viewed).
 * Honors Do Not Track / Global Privacy Control; stores no IP or user agent.
 */
import { Router } from 'express'
import { rateLimit } from '../lib/rateLimit.mjs'
import { recordPublicEvent, PUBLIC_EVENTS } from '../lib/funnel.mjs'

const router = Router()

router.post('/events', rateLimit({ name: 'public-events', limit: 60, windowMs: 10 * 60 * 1000 }), async (req, res) => {
  if (req.get('dnt') === '1' || req.get('sec-gpc') === '1') return res.status(204).end()
  const { event, sessionId, props } = req.body || {}
  if (typeof event !== 'string' || !PUBLIC_EVENTS.has(event)) return res.status(204).end()
  await recordPublicEvent(event, props, sessionId)
  res.status(204).end()
})

export default router
