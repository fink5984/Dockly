/**
 * Upload validation. The client-supplied MIME type and extension are never
 * trusted on their own: the file's leading bytes decide what it is, and that
 * detected type must also match an extension the document slot allows.
 */

/** Detected kind → canonical MIME + extensions it may legitimately carry. */
export const KINDS = {
  pdf:  { mime: 'application/pdf', exts: ['pdf'] },
  jpg:  { mime: 'image/jpeg', exts: ['jpg', 'jpeg'] },
  png:  { mime: 'image/png', exts: ['png'] },
  webp: { mime: 'image/webp', exts: ['webp'] },
  gif:  { mime: 'image/gif', exts: ['gif'] },
  heic: { mime: 'image/heic', exts: ['heic', 'heif'] },
  tiff: { mime: 'image/tiff', exts: ['tif', 'tiff'] },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', exts: ['docx'] },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', exts: ['xlsx'] },
  doc:  { mime: 'application/msword', exts: ['doc'] },
  xls:  { mime: 'application/vnd.ms-excel', exts: ['xls'] },
}

/** Format names used in document_types.allowed_formats → accepted extensions. */
const FORMAT_ALIASES = {
  pdf: ['pdf'], jpg: ['jpg', 'jpeg'], jpeg: ['jpg', 'jpeg'], png: ['png'], webp: ['webp'], gif: ['gif'],
  heic: ['heic', 'heif'], heif: ['heic', 'heif'], tif: ['tif', 'tiff'], tiff: ['tif', 'tiff'],
  doc: ['doc'], docx: ['docx'], xls: ['xls'], xlsx: ['xlsx'],
  image: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'],
}

function startsWith(buf, bytes, offset = 0) {
  if (buf.length < offset + bytes.length) return false
  for (let i = 0; i < bytes.length; i++) if (buf[offset + i] !== bytes[i]) return false
  return true
}

/**
 * Identify a file from its leading bytes. For ZIP containers (docx/xlsx) the
 * declared extension disambiguates, since both are OOXML zips.
 * @returns {keyof KINDS | null}
 */
export function detectKind(buf, declaredExt = '') {
  if (!buf || buf.length < 4) return null
  // PDF may have a few bytes of junk before the header; spec allows up to 1024.
  const head = buf.subarray(0, Math.min(buf.length, 1024)).toString('latin1')
  if (head.includes('%PDF-')) return 'pdf'
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'jpg'
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp'
  if (startsWith(buf, [0x47, 0x49, 0x46, 0x38])) return 'gif'
  if (startsWith(buf, [0x49, 0x49, 0x2a, 0x00]) || startsWith(buf, [0x4d, 0x4d, 0x00, 0x2a])) return 'tiff'
  if (buf.length >= 12 && buf.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = buf.subarray(8, 12).toString('latin1')
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heim', 'heis'].includes(brand)) return 'heic'
  }
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) {
    const ext = declaredExt.toLowerCase()
    if (ext === 'docx' || ext === 'xlsx') return ext
    return null
  }
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    const ext = declaredExt.toLowerCase()
    if (ext === 'doc' || ext === 'xls') return ext
    return null
  }
  return null
}

export function extensionOf(fileName) {
  const m = /\.([a-z0-9]{1,8})$/i.exec(fileName || '')
  return m ? m[1].toLowerCase() : ''
}

/** Expand a document type's allowed_formats into a set of extensions. */
export function allowedExtensions(allowedFormats) {
  const set = new Set()
  for (const f of allowedFormats || []) {
    const key = String(f).toLowerCase().replace(/^\./, '')
    for (const e of FORMAT_ALIASES[key] || [key]) set.add(e)
  }
  return set
}

/**
 * Validate an uploaded buffer.
 * @returns {{ ok: true, kind: string, mime: string, ext: string } | { ok: false, code: string }}
 */
export function validateUpload({ buffer, fileName, allowedFormats, maxBytes }) {
  if (!buffer || buffer.length === 0) return { ok: false, code: 'empty_file' }
  if (maxBytes && buffer.length > maxBytes) return { ok: false, code: 'file_too_large' }
  const ext = extensionOf(fileName)
  const kind = detectKind(buffer, ext)
  if (!kind) return { ok: false, code: 'unsupported_file_type' }
  const allowed = allowedFormats && allowedFormats.length ? allowedExtensions(allowedFormats) : null
  const kindExts = KINDS[kind].exts
  if (allowed && !kindExts.some((e) => allowed.has(e))) return { ok: false, code: 'file_type_not_allowed' }
  return { ok: true, kind, mime: KINDS[kind].mime, ext: kindExts[0] }
}

/**
 * Clean a user-supplied filename for display/storage in the DB:
 * strip path components, control chars and bidi overrides; cap length.
 */
export function cleanDisplayName(name, fallback = 'document') {
  let n = String(name || '').split(/[\\/]/).pop() || ''
  // eslint-disable-next-line no-control-regex
  n = n.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim()
  if (!n || n === '.' || n === '..') n = fallback
  if (n.length > 180) {
    const ext = extensionOf(n)
    n = n.slice(0, 170) + (ext ? `.${ext}` : '')
  }
  return n
}

/** ASCII-only slug for storage keys (the display name lives in the DB). */
export function storageSlug(name) {
  const ext = extensionOf(name)
  const base = name.replace(/\.[^.]*$/, '')
  const slug = base.normalize('NFKD').replace(/[^\w-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60).toLowerCase()
  return `${slug || 'file'}${ext ? `.${ext}` : ''}`
}

/** RFC 6266 Content-Disposition with a UTF-8 filename (Hebrew-safe). */
export function contentDisposition(fileName, disposition = 'attachment') {
  const clean = cleanDisplayName(fileName)
  const ascii = clean.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`
}
