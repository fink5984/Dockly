/**
 * Server-side PDF generation for signatures:
 *  - stamping field values onto the original PDF (Unicode/Hebrew safe)
 *  - a signing certificate (audit report) PDF
 *
 * Field geometry: the editor stores x/y/width/height in CSS pixels relative
 * to a page rendered fit-to-width at `canvasWidth` px, with y measured from
 * the top of that page. PDF space is points from the bottom-left, so
 *   scale = pageWidthPt / canvasWidth,  pdfY = pageHeight - (y + h) * scale
 * Legacy rows without canvasWidth were placed at ~750px.
 */
import { readFile } from 'fs/promises'
import { createRequire } from 'module'
import { dirname, join } from 'path'
import { PDFDocument, rgb, degrees } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { visualRuns, fontSegments, isRtlText } from './text.mjs'
import { BRAND } from '../../shared/brand.mjs'

const require = createRequire(import.meta.url)
const FONT_DIR = join(dirname(require.resolve('@fontsource/heebo/package.json')), 'files')

let fontBytes = null
async function loadFontBytes() {
  if (!fontBytes) {
    const [he, la, heBold, laBold] = await Promise.all([
      readFile(join(FONT_DIR, 'heebo-hebrew-400-normal.woff')),
      readFile(join(FONT_DIR, 'heebo-latin-400-normal.woff')),
      readFile(join(FONT_DIR, 'heebo-hebrew-700-normal.woff')),
      readFile(join(FONT_DIR, 'heebo-latin-700-normal.woff')),
    ])
    fontBytes = { he, la, heBold, laBold }
  }
  return fontBytes
}

async function embedFonts(pdf) {
  pdf.registerFontkit(fontkit)
  const b = await loadFontBytes()
  const [he, la, heBold, laBold] = await Promise.all([
    pdf.embedFont(b.he, { subset: true }),
    pdf.embedFont(b.la, { subset: true }),
    pdf.embedFont(b.heBold, { subset: true }),
    pdf.embedFont(b.laBold, { subset: true }),
  ])
  return { regular: { he, la }, bold: { he: heBold, la: laBold } }
}

/** Replace characters the embedded fonts can't draw with '?' (avoids hard failures). */
function sanitizeForFont(text, font) {
  let out = ''
  for (const ch of text) {
    try {
      font.encodeText(ch)
      out += ch
    } catch {
      out += '?'
    }
  }
  return out
}

/** Width of a (possibly mixed-script) string in points. */
export function measureText(text, fonts, size) {
  let w = 0
  for (const run of visualRuns(text)) {
    for (const seg of fontSegments(run.text)) {
      const f = seg.hebrew ? fonts.he : fonts.la
      w += f.widthOfTextAtSize(sanitizeForFont(seg.text, f), size)
    }
  }
  return w
}

/**
 * Draw mixed Hebrew/Latin text in visual order.
 * (x, y) is the baseline origin; with `rotate` (degrees, CCW) the line is laid
 * out along the rotated baseline so text stays upright on rotated pages.
 * @param {'left'|'right'|'auto'} align  'auto' = right for RTL text
 */
export function drawText(page, text, { x, y, size, fonts, color = rgb(0.06, 0.09, 0.16), maxWidth, align = 'auto', rotate = 0 }) {
  let s = size
  if (maxWidth) {
    while (s > 5 && measureText(text, fonts, s) > maxWidth) s -= 0.5
  }
  const total = measureText(text, fonts, s)
  const rtl = isRtlText(text)
  const rad = (rotate * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  let offset = 0
  if ((align === 'right' || (align === 'auto' && rtl)) && maxWidth) offset = maxWidth - total
  for (const run of visualRuns(text)) {
    for (const seg of fontSegments(run.text)) {
      const f = seg.hebrew ? fonts.he : fonts.la
      const t = sanitizeForFont(seg.text, f)
      page.drawText(t, { x: x + offset * cos, y: y + offset * sin, size: s, font: f, color, rotate: degrees(rotate) })
      offset += f.widthOfTextAtSize(t, s)
    }
  }
  return { width: total, size: s }
}

/**
 * Map a point from the page's *displayed* (rotated) top-down space into PDF
 * user space. pdf.js renders /Rotate pages rotated, so the editor's
 * coordinates live in displayed space.
 */
export function viewToUser(vx, vy, rot, pw, ph) {
  switch (rot) {
    case 90: return { x: vy, y: vx }
    case 180: return { x: pw - vx, y: vy }
    case 270: return { x: pw - vy, y: ph - vx }
    default: return { x: vx, y: ph - vy }
  }
}

/** Convert a box-local point (lx right, ly up from the box's bottom-left) to user space. */
function boxPoint(origin, rot, lx, ly) {
  const rad = (rot * Math.PI) / 180
  return { x: origin.x + lx * Math.cos(rad) - ly * Math.sin(rad), y: origin.y + lx * Math.sin(rad) + ly * Math.cos(rad) }
}

function formatDateValue(value, language) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return value
  const [y, m, d] = value.slice(0, 10).split('-')
  return language === 'en-US' ? `${m}/${d}/${y}` : `${d}/${m}/${y}`
}

function decodePngDataUrl(value) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(value || '')
  if (!m) return null
  const bytes = Buffer.from(m[1], 'base64')
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null
  return bytes
}

/**
 * Stamp field values onto a PDF.
 * @param {Buffer|Uint8Array} originalBytes
 * @param {{ type: string, page: number, x: number, y: number, width: number, height: number, value?: string }[]} fields
 * @param {{ canvasWidth?: number, reference?: string, language?: string, signedAtLabel?: string }} opts
 */
export async function stampPdf(originalBytes, fields, opts = {}) {
  const pdf = await PDFDocument.load(originalBytes, { ignoreEncryption: false })
  const fonts = await embedFonts(pdf)
  const pages = pdf.getPages()
  const canvasW = opts.canvasWidth && opts.canvasWidth > 100 ? opts.canvasWidth : 750

  for (const f of fields) {
    const value = f.value
    if (!value) continue
    const pageIndex = Math.max(0, (f.page || 1) - 1)
    if (pageIndex >= pages.length) continue
    const page = pages[pageIndex]
    const { width: pw, height: ph } = page.getSize()
    const rot = ((page.getRotation().angle % 360) + 360) % 360
    const scale = (rot === 90 || rot === 270 ? ph : pw) / canvasW
    const w = f.width * scale
    const h = f.height * scale
    // Box origin = its displayed bottom-left corner, in user space.
    const origin = viewToUser(f.x * scale, (f.y + f.height) * scale, rot, pw, ph)
    const at = (lx, ly) => boxPoint(origin, rot, lx, ly)

    if (f.type === 'signature' || f.type === 'initials') {
      const png = decodePngDataUrl(value)
      if (png) {
        const img = await pdf.embedPng(png)
        // Fit inside the box preserving aspect ratio.
        const r = Math.min(w / img.width, h / img.height)
        const iw = img.width * r
        const ih = img.height * r
        const p = at((w - iw) / 2, (h - ih) / 2)
        page.drawImage(img, { x: p.x, y: p.y, width: iw, height: ih, rotate: degrees(rot) })
        continue
      }
    }
    if (f.type === 'checkbox') {
      if (value === 'true') {
        const s = Math.min(w, h) * 0.7
        const ox = (w - s) / 2
        const oy = (h - s) / 2
        const thickness = Math.max(1, s / 8)
        const ink = rgb(0.06, 0.09, 0.16)
        page.drawLine({ start: at(ox, oy + s * 0.45), end: at(ox + s * 0.4, oy + s * 0.1), thickness, color: ink })
        page.drawLine({ start: at(ox + s * 0.4, oy + s * 0.1), end: at(ox + s, oy + s * 0.9), thickness, color: ink })
      }
      continue
    }
    const text = f.type === 'date' ? formatDateValue(value, opts.language) : value
    const size = Math.max(6, Math.min(h * 0.6, 14))
    const p = at(2, (h - size) / 2 + size * 0.15)
    drawText(page, text.replace(/\s+/g, ' ').trim(), {
      x: p.x, y: p.y, size, fonts: fonts.regular, maxWidth: Math.max(10, w - 4), rotate: rot,
    })
  }

  // Unobtrusive reference stamp on every page (tamper-evidence aid).
  if (opts.reference) {
    for (const page of pages) {
      const { width: pw } = page.getSize()
      drawText(page, opts.reference, { x: 18, y: 8, size: 6.5, fonts: fonts.regular, color: rgb(0.45, 0.5, 0.58), maxWidth: pw - 36, align: 'left' })
    }
  }

  pdf.setModificationDate(new Date())
  return Buffer.from(await pdf.save())
}

/** Wrap a JPG/PNG in a single A4 page (portrait or landscape to match). */
export async function imageToPdf(bytes, kind) {
  const pdf = await PDFDocument.create()
  const img = kind === 'png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes)
  const landscape = img.width > img.height
  const [W, H] = landscape ? [841.89, 595.28] : [595.28, 841.89]
  const page = pdf.addPage([W, H])
  const r = Math.min((W - 48) / img.width, (H - 48) / img.height)
  page.drawImage(img, { x: (W - img.width * r) / 2, y: (H - img.height * r) / 2, width: img.width * r, height: img.height * r })
  return Buffer.from(await pdf.save())
}

export async function pdfPageCount(bytes) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  return pdf.getPageCount()
}

const LABELS = {
  en: {
    title: 'Signing certificate',
    subtitle: 'Electronic signature record generated by Sadir',
    document: 'Document', requestId: 'Request ID', workspace: 'Sent by', status: 'Status',
    signer: 'Signer', email: 'Email', phone: 'Phone', ip: 'IP address', device: 'Device',
    originalHash: 'Original document SHA-256', signedHash: 'Signed document SHA-256',
    consent: 'Consent', consentedAt: 'Consent given at', events: 'Event history', time: 'Time (UTC)', event: 'Event', by: 'By',
    chain: 'Event chain head (SHA-256)',
    disclaimer: 'This record documents a simple electronic signature captured through Sadir: the signer opened a private link, reviewed the document, gave explicit consent and applied their signature. It is not a qualified or certified electronic signature and does not by itself verify the signer’s identity. Hashes allow anyone to confirm the signed file has not changed since signing.',
    signed: 'Signed', declined: 'Declined',
  },
  he: {
    title: 'תעודת חתימה',
    subtitle: 'רשומת חתימה אלקטרונית שהופקה על ידי Sadir',
    document: 'מסמך', requestId: 'מזהה בקשה', workspace: 'נשלח על ידי', status: 'סטטוס',
    signer: 'החותם', email: 'דוא"ל', phone: 'טלפון', ip: 'כתובת IP', device: 'מכשיר',
    originalHash: 'SHA-256 של המסמך המקורי', signedHash: 'SHA-256 של המסמך החתום',
    consent: 'הסכמה', consentedAt: 'מועד ההסכמה', events: 'היסטוריית אירועים', time: 'זמן (UTC)', event: 'אירוע', by: 'על ידי',
    chain: 'ראש שרשרת האירועים (SHA-256)',
    disclaimer: 'רשומה זו מתעדת חתימה אלקטרונית פשוטה שנאספה באמצעות Sadir: החותם פתח קישור פרטי, עיין במסמך, נתן הסכמה מפורשת והוסיף את חתימתו. זו אינה חתימה אלקטרונית מאושרת או מאובטחת, והיא אינה מאמתת בעצמה את זהות החותם. ערכי ה-Hash מאפשרים לוודא שהקובץ החתום לא שונה מאז החתימה.',
    signed: 'נחתם', declined: 'נדחה',
  },
}

const EVENT_LABELS = {
  en: { created: 'Request created', sent: 'Sent to signer', viewed: 'Opened by signer', consented: 'Consent given', signed: 'Signed', declined: 'Declined', cancelled: 'Cancelled', reminder_sent: 'Reminder sent', completed_pdf: 'Signed PDF generated', downloaded: 'Downloaded', expired: 'Expired' },
  he: { created: 'הבקשה נוצרה', sent: 'נשלח לחותם', viewed: 'נפתח על ידי החותם', consented: 'ניתנה הסכמה', signed: 'נחתם', declined: 'נדחה', cancelled: 'בוטל', reminder_sent: 'נשלחה תזכורת', completed_pdf: 'הופק PDF חתום', downloaded: 'הורד', expired: 'פג תוקף' },
}

/**
 * Build the signing certificate PDF.
 * @param {object} r request facts; @param {object[]} events from signature_events
 */
export async function buildCertificate(r, events, language = 'en') {
  const L = LABELS[language === 'he' ? 'he' : 'en']
  const E = EVENT_LABELS[language === 'he' ? 'he' : 'en']
  const rtl = language === 'he'
  const pdf = await PDFDocument.create()
  const fonts = await embedFonts(pdf)
  pdf.setTitle(`${L.title} — ${r.title}`)
  pdf.setProducer(BRAND.name)

  const W = 595.28
  const H = 841.89
  const M = 48
  let page = pdf.addPage([W, H])
  let y = H - M
  const ink = rgb(0.06, 0.09, 0.16)
  const muted = rgb(0.39, 0.45, 0.55)
  const line = rgb(0.89, 0.91, 0.94)
  const accent = rgb(0.26, 0.22, 0.79)

  const ensure = (needed) => {
    if (y - needed < M) {
      page = pdf.addPage([W, H])
      y = H - M
    }
  }
  const text = (t, { size = 10, bold = false, color = ink, x = M, width = W - 2 * M } = {}) =>
    drawText(page, String(t ?? ''), { x, y, size, fonts: bold ? fonts.bold : fonts.regular, color, maxWidth: width, align: rtl ? 'right' : 'left' })

  // Header
  page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: accent })
  text(L.title, { size: 20, bold: true })
  y -= 18
  text(L.subtitle, { size: 9.5, color: muted })
  y -= 26

  const row = (label, value, mono = false) => {
    const lines = wrap(String(value ?? '—'), mono ? 70 : 80)
    ensure(14 * lines.length + 6)
    const labelW = 170
    if (rtl) {
      drawText(page, label, { x: W - M - labelW, y, size: 9, fonts: fonts.regular, color: muted, maxWidth: labelW, align: 'right' })
      for (const l of lines) {
        drawText(page, l, { x: M, y, size: mono ? 8.5 : 10, fonts: fonts.regular, color: ink, maxWidth: W - 2 * M - labelW - 12, align: 'right' })
        y -= 14
      }
    } else {
      drawText(page, label, { x: M, y, size: 9, fonts: fonts.regular, color: muted, maxWidth: labelW, align: 'left' })
      for (const l of lines) {
        drawText(page, l, { x: M + labelW, y, size: mono ? 8.5 : 10, fonts: fonts.regular, color: ink, maxWidth: W - 2 * M - labelW, align: 'left' })
        y -= 14
      }
    }
    y -= 4
  }
  const section = (title) => {
    ensure(40)
    y -= 6
    page.drawLine({ start: { x: M, y: y + 8 }, end: { x: W - M, y: y + 8 }, thickness: 0.6, color: line })
    y -= 8
    text(title, { size: 11, bold: true })
    y -= 18
  }

  row(L.document, r.title)
  row(L.requestId, r.id, true)
  row(L.workspace, r.workspaceName)
  row(L.status, r.status === 'signed' ? L.signed : r.status === 'declined' ? L.declined : r.status)

  section(L.signer)
  row(L.signer, r.signerName || r.clientName)
  if (r.signerEmail) row(L.email, r.signerEmail)
  if (r.signerPhone) row(L.phone, r.signerPhone)
  if (r.ip) row(L.ip, r.ip)
  if (r.userAgent) row(L.device, r.userAgent)
  if (r.consentText) row(L.consent, r.consentText)
  if (r.consentedAt) row(L.consentedAt, r.consentedAt.replace('T', ' ').slice(0, 19) + ' UTC')

  section('SHA-256')
  row(L.originalHash, r.originalSha256 || '—', true)
  if (r.signedSha256) row(L.signedHash, r.signedSha256, true)
  for (const d of r.extraDocuments || []) {
    row(`${d.fileName}`, `${d.originalSha256 || '—'} → ${d.signedSha256 || '—'}`, true)
  }

  section(L.events)
  for (const e of events) {
    ensure(30)
    const when = new Date(e.created_at).toISOString().replace('T', ' ').slice(0, 19)
    const who = e.actor === 'signer' ? (r.signerName || r.clientName || 'signer') : e.actor === 'system' ? 'system' : (e.actor_name || 'user')
    const label = E[e.event] || e.event
    const ip = e.ip ? ` · ${e.ip}` : ''
    row(when, `${label} — ${who}${ip}`)
  }
  if (events.length) row(L.chain, events[events.length - 1].hash, true)

  ensure(90)
  y -= 10
  page.drawLine({ start: { x: M, y: y + 8 }, end: { x: W - M, y: y + 8 }, thickness: 0.6, color: line })
  y -= 8
  for (const l of wrap(L.disclaimer, 105)) {
    ensure(12)
    text(l, { size: 8, color: muted })
    y -= 11
  }

  // page numbers
  const pages = pdf.getPages()
  pages.forEach((p, i) => {
    drawText(p, `${i + 1} / ${pages.length}`, { x: W - M - 40, y: 24, size: 8, fonts: fonts.regular, color: muted, maxWidth: 40, align: 'right' })
    if (i > 0) p.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: accent, rotate: degrees(0) })
  })

  return Buffer.from(await pdf.save())
}

function wrap(text, maxChars) {
  const words = String(text).split(/\s+/)
  const lines = []
  let cur = ''
  for (const w of words) {
    if (w.length > maxChars) {
      if (cur) { lines.push(cur); cur = '' }
      for (let i = 0; i < w.length; i += maxChars) lines.push(w.slice(i, i + maxChars))
      continue
    }
    if ((cur + ' ' + w).trim().length > maxChars) {
      lines.push(cur)
      cur = w
    } else {
      cur = (cur + ' ' + w).trim()
    }
  }
  if (cur) lines.push(cur)
  return lines.length ? lines : ['']
}
