/**
 * WhatsApp Cloud API adapter (official Meta API — no unofficial clients).
 *
 * Mode 'cloud' talks to graph.facebook.com. Mode 'log' records what would be
 * sent without sending (local dev, tests, or before credentials exist); the
 * caller still gets a clear "not sent" result so the UI never claims success.
 */
import { createHmac, randomUUID } from 'crypto'
import { config } from '../config.mjs'
import { logger } from '../lib/logger.mjs'
import { safeEqual } from '../lib/crypto.mjs'

const wa = config.whatsapp

/** Messages captured in 'log' mode (exposed for tests). */
export const sentLog = []

export function whatsappStatus() {
  return {
    mode: wa.mode,
    configured: wa.mode === 'cloud' && Boolean(wa.phoneId && wa.accessToken),
    webhookVerified: Boolean(wa.appSecret),
  }
}

/**
 * @returns {Promise<{ ok: boolean, messageId?: string, error?: string, simulated?: boolean }>}
 */
export async function sendWhatsApp(to, payload) {
  if (wa.mode !== 'cloud') {
    const messageId = `log-${randomUUID()}`
    sentLog.push({ to, payload, messageId, at: new Date().toISOString() })
    if (sentLog.length > 500) sentLog.shift()
    logger.info('whatsapp_simulated_send', { to: to.slice(0, 5) + '…', type: payload.type })
    return { ok: true, messageId, simulated: true }
  }
  try {
    const res = await fetch(`${wa.graphApi}/${wa.phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${wa.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, ...payload }),
      signal: AbortSignal.timeout(15_000),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.error) {
      const error = data?.error?.message || `HTTP ${res.status}`
      logger.warn('whatsapp_send_failed', { status: res.status, code: data?.error?.code, error })
      return { ok: false, error }
    }
    return { ok: true, messageId: data.messages?.[0]?.id }
  } catch (err) {
    logger.warn('whatsapp_send_error', { err })
    return { ok: false, error: err.name === 'TimeoutError' ? 'WhatsApp API timed out' : 'Could not reach WhatsApp' }
  }
}

export function templatePayload(templateName, languageCode, bodyParams = [], buttonPayloads = []) {
  const components = []
  if (bodyParams.length) {
    components.push({ type: 'body', parameters: bodyParams.map((p) => ({ type: 'text', text: String(p).slice(0, 1000) })) })
  }
  buttonPayloads.forEach((payload, i) => {
    components.push({ type: 'button', sub_type: 'quick_reply', index: String(i), parameters: [{ type: 'payload', payload }] })
  })
  return { type: 'template', template: { name: templateName, language: { code: languageCode }, components } }
}

export const textPayload = (body) => ({ type: 'text', text: { body: String(body).slice(0, 4096) } })

export function markRead(messageId, withTyping = false) {
  if (wa.mode !== 'cloud' || !messageId) return Promise.resolve()
  const body = { messaging_product: 'whatsapp', status: 'read', message_id: messageId }
  if (withTyping) body.typing_indicator = { type: 'text' }
  return fetch(`${wa.graphApi}/${wa.phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${wa.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  }).catch((err) => logger.warn('whatsapp_mark_read_failed', { err }))
}

export async function downloadMedia(mediaId) {
  if (wa.mode !== 'cloud') return null
  const metaRes = await fetch(`${wa.graphApi}/${encodeURIComponent(mediaId)}`, {
    headers: { Authorization: `Bearer ${wa.accessToken}` }, signal: AbortSignal.timeout(15_000),
  })
  const meta = await metaRes.json().catch(() => ({}))
  if (!meta.url) return null
  // Media URLs must be on Meta's CDN; refuse anything else (SSRF guard).
  const host = new URL(meta.url).hostname
  if (!/(^|\.)(fbsbx\.com|facebook\.com|whatsapp\.net|fbcdn\.net)$/.test(host)) return null
  const fileRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${wa.accessToken}` }, signal: AbortSignal.timeout(60_000) })
  if (!fileRes.ok) return null
  const buffer = Buffer.from(await fileRes.arrayBuffer())
  return { buffer, mimeType: meta.mime_type || 'application/octet-stream' }
}

/**
 * Verify Meta's X-Hub-Signature-256 header against the raw request body.
 * Without WHATSAPP_APP_SECRET we cannot verify, so we refuse (fail closed).
 */
export function verifyWebhookSignature(rawBody, header) {
  if (!wa.appSecret || !rawBody || typeof header !== 'string' || !header.startsWith('sha256=')) return false
  const expected = 'sha256=' + createHmac('sha256', wa.appSecret).update(rawBody).digest('hex')
  return safeEqual(header, expected)
}
