/**
 * Email adapter. Uses Resend's HTTP API when RESEND_API_KEY and EMAIL_FROM
 * are configured; otherwise reports `not_configured` so the UI can say so
 * instead of pretending an email went out.
 */
import { config } from '../config.mjs'
import { logger } from '../lib/logger.mjs'
import { BRAND } from '../../shared/brand.mjs'

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

/**
 * Escape text, then render `**bold**` as an isolated <strong> so Latin or
 * mixed-direction values (names, titles) never scramble RTL punctuation.
 */
const rich = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong dir="auto" style="unicode-bidi:isolate;color:#0F172A">$1</strong>')
const plain = (s) => String(s ?? '').replace(/\*\*(.+?)\*\*/g, '$1')

const INK = '#0F172A'
const TEXT = '#334155'
const MUTED = '#64748B'
const FAINT = '#94A3B8'
const LINE = '#E6E8F0'
const SURFACE = '#F8FAFC'
const WARN = '#B45309'
const FONT = "Heebo,'Segoe UI',Arial,Helvetica,sans-serif"

/** Short, readable label for a link (host + start of path). */
function linkLabel(url) {
  try {
    const u = new URL(url)
    return `${u.host}${u.pathname.length > 12 ? `${u.pathname.slice(0, 10)}…` : u.pathname}`
  } catch {
    return url
  }
}

/**
 * Branded, RTL-aware transactional email (table layout, inline styles only,
 * so it renders the same in Gmail, Outlook and Apple Mail).
 *
 * @param {object} p
 * @param {'he'|'en'} [p.language]
 * @param {string} p.brandName        sender shown in the header (office name)
 * @param {string} [p.brandColor]
 * @param {string} [p.logoUrl]        absolute https URL; a monogram is shown otherwise
 * @param {string} [p.eyebrow]        small label above the heading ("Reminder")
 * @param {string} p.heading
 * @param {string} [p.preheader]      inbox preview text
 * @param {string[]} [p.paragraphs]   `**bold**` supported
 * @param {{ done: number, total: number, label: string }} [p.progress]
 * @param {string} [p.itemsTitle]
 * @param {{ title: string, note?: string, tone?: 'warn' }[]} [p.items]
 * @param {string[]} [p.meta]         short lines under the list (deadline…)
 * @param {string} [p.ctaLabel]
 * @param {string} [p.ctaUrl]
 * @param {string[]} [p.trust]        small reassurance points under the button
 * @param {string} [p.fallbackLabel]  "button not working?" line
 * @param {string} [p.footer]
 */
export function renderEmail(p) {
  const {
    language = 'en', brandName = BRAND.name, brandColor = BRAND.colors.primary, logoUrl, eyebrow, heading, preheader,
    paragraphs = [], progress, itemsTitle, items = [], meta = [], ctaLabel, ctaUrl, trust = [], fallbackLabel, footer,
  } = p
  const he = language === 'he'
  const dir = he ? 'rtl' : 'ltr'
  const align = he ? 'right' : 'left'
  // Only a plain hex colour reaches inline styles (it is also used with an alpha suffix).
  const color = /^#[0-9a-f]{6}$/i.test(brandColor || '') ? brandColor : BRAND.colors.primary

  const logo = logoUrl
    ? `<img src="${esc(logoUrl)}" alt="${esc(brandName)}" height="40" style="display:block;height:40px;max-width:160px;border:0;border-radius:8px">`
    : `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="40" height="40" align="center" valign="middle" style="width:40px;height:40px;border-radius:12px;background:${color};color:#fff;font:700 18px/40px ${FONT}">${esc(String(brandName || '?').trim().charAt(0).toUpperCase())}</td></tr></table>`

  const header = `<tr><td style="padding:24px 32px 20px;border-bottom:1px solid ${LINE}">
    <table role="presentation" cellpadding="0" cellspacing="0" dir="${dir}"><tr>
      <td valign="middle">${logo}</td>
      <td valign="middle" style="padding-${he ? 'right' : 'left'}:12px;font:700 16px ${FONT};color:${INK}">${esc(brandName)}</td>
    </tr></table></td></tr>`

  const eyebrowHtml = eyebrow
    ? `<div style="margin:0 0 10px"><span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${color}1A;color:${color};font:600 12px ${FONT}">${esc(eyebrow)}</span></div>`
    : ''

  const body = paragraphs.map((t) => `<p style="margin:0 0 14px;font:400 16px/1.7 ${FONT};color:${TEXT}">${rich(t)}</p>`).join('')

  let progressHtml = ''
  if (progress && progress.total > 0) {
    const pct = Math.max(0, Math.min(100, Math.round((progress.done / progress.total) * 100)))
    const bar = pct === 0
      ? `<td style="height:8px;background:${LINE};border-radius:999px;font-size:0;line-height:0">&nbsp;</td>`
      : `<td width="${pct}%" style="height:8px;background:${color};border-radius:999px;font-size:0;line-height:0">&nbsp;</td>${pct < 100 ? `<td style="height:8px;background:${LINE};font-size:0;line-height:0">&nbsp;</td>` : ''}`
    progressHtml = `<div style="margin:6px 0 20px">
      <div style="margin:0 0 8px;font:600 13px ${FONT};color:${MUTED}">${esc(progress.label)}</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="${dir}" style="border-radius:999px;background:${LINE}"><tr>${bar}</tr></table></div>`
  }

  const itemsHtml = items.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;background:${SURFACE};border:1px solid ${LINE};border-radius:12px">
        <tr><td style="padding:16px 20px 4px;font:700 14px ${FONT};color:${INK}">${esc(itemsTitle || '')}</td></tr>
        ${items.map((it, i) => `<tr><td style="padding:10px 20px${i === items.length - 1 ? ' 16px' : ''};${i ? `border-top:1px solid ${LINE};` : ''}">
          <table role="presentation" cellpadding="0" cellspacing="0" dir="${dir}"><tr>
            <td valign="top" style="padding-top:7px;width:8px"><div style="width:8px;height:8px;border-radius:999px;background:${it.tone === 'warn' ? WARN : color}"></div></td>
            <td valign="top" style="padding-${he ? 'right' : 'left'}:12px">
              <div dir="auto" style="font:600 15px/1.5 ${FONT};color:${INK}">${esc(it.title)}</div>
              ${it.note ? `<div dir="auto" style="font:400 13px/1.5 ${FONT};color:${it.tone === 'warn' ? WARN : MUTED}">${esc(it.note)}</div>` : ''}
            </td></tr></table></td></tr>`).join('')}
      </table>`
    : ''

  const metaHtml = meta.map((m) => `<p style="margin:0 0 8px;font:600 14px ${FONT};color:${TEXT}">${rich(m)}</p>`).join('')

  const cta = ctaUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 14px" ${he ? 'align="right"' : ''}><tr>
        <td align="center" bgcolor="${color}" style="border-radius:10px;background:${color}">
          <a href="${esc(ctaUrl)}" style="display:inline-block;padding:14px 32px;font:700 16px ${FONT};color:#ffffff;text-decoration:none;border-radius:10px">${esc(ctaLabel)}</a>
        </td></tr></table><div style="clear:both"></div>
      ${trust.length ? `<p style="margin:0 0 18px;font:400 13px ${FONT};color:${MUTED}">${trust.map(esc).join('&nbsp;&nbsp;·&nbsp;&nbsp;')}</p>` : ''}
      <p style="margin:0;font:400 12px ${FONT};color:${FAINT}">${esc(fallbackLabel || (he ? 'הכפתור לא עובד? אפשר לפתוח את הקישור:' : 'Button not working? Open the link:'))}
        <a href="${esc(ctaUrl)}" dir="ltr" style="color:${color};text-decoration:underline;unicode-bidi:isolate">${esc(linkLabel(ctaUrl))}</a></p>`
    : ''

  const preheaderHtml = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(preheader)}&#8199;&#65279;&#847;</div>`
    : ''

  const html = `<!doctype html><html lang="${language}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(heading)}</title></head>
<body style="margin:0;padding:0;background:#F1F3F8;-webkit-text-size-adjust:100%">${preheaderHtml}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F3F8"><tr><td align="center" style="padding:32px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="${dir}" style="max-width:600px;background:#ffffff;border:1px solid ${LINE};border-radius:16px;border-top:4px solid ${color};text-align:${align}">
    ${header}
    <tr><td style="padding:28px 32px 8px">
      ${eyebrowHtml}
      <h1 style="margin:0 0 16px;font:700 24px/1.35 ${FONT};color:${INK}">${rich(heading)}</h1>
      ${body}${progressHtml}${itemsHtml}${metaHtml}${cta}
    </td></tr>
    <tr><td style="padding:24px 32px 28px"><div style="border-top:1px solid ${LINE};padding-top:18px;font:400 12px/1.6 ${FONT};color:${FAINT}">${rich(footer || '')}</div></td></tr>
  </table>
  <div style="padding:16px 0 0;font:400 12px ${FONT};color:${FAINT}">${he ? `נשלח באמצעות ${BRAND.name}` : `Sent with ${BRAND.name}`}</div>
</td></tr></table></body></html>`

  const text = [
    plain(heading),
    ...paragraphs.map(plain),
    progress?.total ? progress.label : '',
    items.length ? [itemsTitle, ...items.map((it) => `• ${it.title}${it.note ? ` (${it.note})` : ''}`)].filter(Boolean).join('\n') : '',
    ...meta.map(plain),
    ctaUrl ? `${ctaLabel}: ${ctaUrl}` : '',
    plain(footer || ''),
  ].filter(Boolean).join('\n\n')
  return { html, text }
}
