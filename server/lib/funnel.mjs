/**
 * Product funnel analytics — privacy-first.
 *
 * Collected: an event name, a timestamp, the workspace id (for in-product
 * milestones), an optional per-tab random session id, and a short whitelist of
 * non-identifying properties (language, coarse device class, UTM tags, plan
 * code). Never collected: IP address, user agent, names, emails, phone
 * numbers, document contents, file names or free text.
 *
 * Workspace milestones are recorded once (unique index), at the moment the
 * server observes them — not reported by the browser.
 */
import { query } from '../db/pool.mjs'
import { logger } from './logger.mjs'

export const FUNNEL_EVENTS = Object.freeze([
  'landing_visit', 'pricing_viewed', 'signup', 'onboarding_completed',
  'first_request', 'first_upload_completed', 'first_signature_completed', 'trial_to_paid',
])
export const PUBLIC_EVENTS = new Set(['landing_visit', 'pricing_viewed'])

const PROP_RULES = {
  lang: /^(he|en)$/,
  device: /^(mobile|tablet|desktop)$/,
  page: /^\/[a-z0-9/_-]{0,60}$/,
  utm_source: /^[\w.-]{1,60}$/,
  utm_medium: /^[\w.-]{1,60}$/,
  utm_campaign: /^[\w.-]{1,80}$/,
  plan: /^[a-z0-9_]{1,40}$/,
  interval: /^(month|year)$/,
  interest: /^(collect|sign|both)$/,
  via: /^(portal|whatsapp|staff)$/,
  from: /^[a-z_]{1,20}$/,
}

/** Keep only whitelisted, well-formed properties. */
export function cleanProps(props) {
  const out = {}
  if (!props || typeof props !== 'object') return out
  for (const [k, rule] of Object.entries(PROP_RULES)) {
    const v = props[k]
    if (typeof v === 'string' && rule.test(v)) out[k] = v
  }
  return out
}

export const validSessionId = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(s)

/** Record a one-time workspace milestone. Never throws. */
export async function recordMilestone(workspaceId, event, props = {}, sessionId = null) {
  if (!FUNNEL_EVENTS.includes(event) || !workspaceId) return
  try {
    await query(
      `INSERT INTO funnel_events (event, workspace_id, session_id, props) VALUES ($1,$2,$3,$4)
       ON CONFLICT (workspace_id, event) WHERE workspace_id IS NOT NULL DO NOTHING`,
      [event, workspaceId, validSessionId(sessionId) ? sessionId : null, JSON.stringify(cleanProps(props))],
    )
  } catch (err) {
    logger.warn('funnel_record_failed', { event, err })
  }
}

/** Record an anonymous marketing-site event (landing/pricing views). */
export async function recordPublicEvent(event, props, sessionId) {
  if (!PUBLIC_EVENTS.has(event)) return false
  await query(
    'INSERT INTO funnel_events (event, session_id, props) VALUES ($1,$2,$3)',
    [event, validSessionId(sessionId) ? sessionId : null, JSON.stringify(cleanProps(props))],
  )
  return true
}
