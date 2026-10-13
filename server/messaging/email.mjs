/**
 * Email adapter. Uses Resend's HTTP API when RESEND_API_KEY and EMAIL_FROM
 * are configured; otherwise reports `not_configured` so the UI can say so
 * instead of pretending an email went out.
 */
import { config } from '../config.mjs'
import { logger } from '../lib/logger.mjs'

export function emailStatus() {
  return { configured: Boolean(config.email.resendApiKey && config.email.from), provider: 'resend' }
}

/** @returns {Promise<{ ok: boolean, messageId?: string, error?: string }>} */
export async function sendEmail({ to, subject, html, text }) {
  if (!emailStatus().configured) return { ok: false, error: 'not_configured' }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.email.resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.email.from, to: [to], subject, html, text }),
      signal: AbortSignal.timeout(15_000),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: data?.message || `HTTP ${res.status}` }
    return { ok: true, messageId: data.id }
  } catch (err) {
    logger.warn('email_send_error', { err })
    return { ok: false, error: 'Could not reach email provider' }
  }
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/** Simple, accessible, RTL-aware transactional email layout. */
export function renderEmail({ language = 'en', brandName, brandColor = '#4338ca', heading, paragraphs = [], ctaLabel, ctaUrl, footer }) {
  const dir = language === 'he' ? 'rtl' : 'ltr'
  const align = dir === 'rtl' ? 'right' : 'left'
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#334155">${esc(p)}</p>`).join('')
  const cta = ctaUrl
    ? `<p style="margin:24px 0"><a href="${esc(ctaUrl)}" style="display:inline-block;background:${esc(brandColor)};color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;font-size:15px">${esc(ctaLabel)}</a></p>
       <p style="margin:0;font-size:12px;color:#64748b;word-break:break-all">${esc(ctaUrl)}</p>`
    : ''
  const html = `<!doctype html><html lang="${language}" dir="${dir}"><body style="margin:0;background:#f1f5f9;font-family:Heebo,Segoe UI,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
  <table role="presentation" width="100%" style="max-width:560px;background:#fff;border-radius:12px;border:1px solid #e2e8f0" cellpadding="0" cellspacing="0">
  <tr><td style="padding:28px 28px 8px;text-align:${align}"><div style="font-size:13px;font-weight:600;color:${esc(brandColor)}">${esc(brandName)}</div>
  <h1 style="margin:8px 0 16px;font-size:20px;color:#0f172a">${esc(heading)}</h1>${body}${cta}</td></tr>
  <tr><td style="padding:16px 28px 24px;font-size:12px;color:#94a3b8;text-align:${align}">${esc(footer || '')}</td></tr>
  </table></td></tr></table></body></html>`
  const text = [heading, ...paragraphs, ctaUrl ? `${ctaLabel}: ${ctaUrl}` : '', footer || ''].filter(Boolean).join('\n\n')
  return { html, text }
}
