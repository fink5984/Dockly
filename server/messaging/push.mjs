/**
 * Web push adapter (VAPID). Each in-app notification may also go out as a
 * push to the recipients' subscribed devices, filtered by the events each
 * user chose. Payloads are end-to-end encrypted to the browser by the Web
 * Push protocol; push services never see the text.
 *
 * Without VAPID keys push is "not configured": the API says so and nothing
 * is sent. Outside production, throwaway keys are generated per process so
 * push can be tried locally (devices re-subscribe after a restart).
 */
import webpush from 'web-push'
import { config } from '../config.mjs'
import { query } from '../db/pool.mjs'
import { logger } from '../lib/logger.mjs'
import { pushEventFor } from '../../shared/push.mjs'

let devKeys = null
function vapid() {
  const { publicKey, privateKey, subject } = config.push
  if (publicKey && privateKey) return { publicKey, privateKey, subject }
  if (config.isProduction) return null
  if (!devKeys) {
    devKeys = webpush.generateVAPIDKeys()
    if (!config.isTest) logger.warn('push_dev_keys', { note: 'VAPID keys not set; using throwaway keys for this process' })
  }
  return { ...devKeys, subject }
}

export function pushStatus() {
  const v = vapid()
  return { configured: Boolean(v), publicKey: v?.publicKey || null }
}

// Swappable for tests so no network calls leave the process.
const realSender = (subscription, payload, options) => webpush.sendNotification(subscription, payload, options)
let sender = realSender
/** Test hook: replace the network call; pass nothing to restore it. */
export function setPushSender(fn) { sender = fn || realSender }

/** Push text in the device's language. Mirrors notifications.templates in the UI. */
const TEXT = {
  en: {
    document_uploaded: (p) => `${p.client} uploaded ${p.document}`,
    request_completed: (p) => `${p.client} submitted every required document`,
    signature_signed: (p) => `${p.signer} signed "${p.title}"`,
    signature_declined: (p) => `${p.client} declined "${p.title}"`,
    support_message: (p) => `New support message from ${p.client}`,
    test: () => 'Push notifications are on',
  },
  he: {
    document_uploaded: (p) => `${p.client} העלה/תה את ${p.document}`,
    request_completed: (p) => `${p.client} הגיש/ה את כל המסמכים הנדרשים`,
    signature_signed: (p) => `${p.signer} חתם/ה על "${p.title}"`,
    signature_declined: (p) => `${p.client} סירב/ה לחתום על "${p.title}"`,
    support_message: (p) => `הודעת תמיכה חדשה מ${p.client}`,
    test: () => 'התראות פוש פעילות',
  },
}
const TEST_BODY = { en: 'You’ll get notifications like this on this device.', he: 'כך ייראו ההתראות במכשיר הזה.' }

function render(n, lang) {
  if (n.template === 'localized') {
    const c = n.params?.[lang] || n.params?.en
    return { title: c?.title || n.title, body: c?.body || n.message || '' }
  }
  const fn = TEXT[lang]?.[n.template]
  if (fn && n.template === 'test') return { title: fn(), body: TEST_BODY[lang] }
  return { title: fn ? fn(n.params || {}) : n.title, body: n.message || '' }
}

/**
 * Push a notification to the given users' devices, honouring each user's
 * event choices. Never throws: push is best-effort on top of the in-app bell.
 * @param {{ userIds: string[], template: string|null, params?: object|null, title: string, message?: string, actionUrl?: string|null, force?: boolean }} n
 */
export async function pushToUsers(n) {
  const v = vapid()
  if (!v || !n.userIds?.length) return { sent: 0 }
  const event = n.force ? null : pushEventFor(n.template)
  if (!n.force && !event) return { sent: 0 }
  try {
    const subs = await query(
      `SELECT s.id, s.endpoint, s.p256dh, s.auth, s.language
         FROM push_subscriptions s JOIN profiles p ON p.id = s.user_id
        WHERE s.user_id = ANY($1::uuid[]) AND p.is_active AND ($2::text IS NULL OR $2 = ANY(p.push_events))`,
      [n.userIds, event],
    )
    let sent = 0
    await Promise.allSettled(subs.map(async (s) => {
      const { title, body } = render(n, s.language)
      const payload = JSON.stringify({ title, body, url: n.actionUrl || '/app', tag: n.actionUrl || n.template || 'sadir' })
      try {
        await sender({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
          TTL: 24 * 60 * 60, urgency: 'normal', vapidDetails: { subject: v.subject, publicKey: v.publicKey, privateKey: v.privateKey },
        })
        sent++
        await query('UPDATE push_subscriptions SET last_success_at = now() WHERE id = $1', [s.id])
      } catch (err) {
        // 404/410: the browser dropped this subscription (uninstalled, permission revoked).
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await query('DELETE FROM push_subscriptions WHERE id = $1', [s.id])
        } else {
          logger.warn('push_send_failed', { status: err?.statusCode, subscription: s.id })
        }
      }
    }))
    return { sent }
  } catch (err) {
    logger.error('push_failed', { err })
    return { sent: 0 }
  }
}
