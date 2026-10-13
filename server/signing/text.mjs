/**
 * Minimal bidirectional text layout for PDF output.
 *
 * pdf-lib draws glyphs strictly left-to-right, so Hebrew must be reordered
 * into visual order before drawing. This implements the subset of the
 * Unicode Bidi Algorithm that matters for short field values (names, dates,
 * IDs, free text): strong RTL (Hebrew/Arabic), strong LTR (Latin, digits)
 * and neutrals resolved by their neighbours, with bracket mirroring.
 */

const RTL_RE = /[֐-׿יִ-ﭏ؀-ۿ]/
const LTR_RE = /[A-Za-z0-9À-ɏ]/
const MIRROR = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<' }

function charType(ch) {
  if (RTL_RE.test(ch)) return 'R'
  if (LTR_RE.test(ch)) return 'L'
  return 'N'
}

export function isRtlText(text) {
  for (const ch of text) {
    const t = charType(ch)
    if (t !== 'N') return t === 'R'
  }
  return false
}

/**
 * Split text into visual-order runs.
 * @returns {{ text: string, rtl: boolean }[]} runs to draw left→right
 */
export function visualRuns(text, baseRtl = isRtlText(text)) {
  const chars = [...text]
  if (chars.length === 0) return []
  const types = chars.map(charType)

  // Resolve neutrals: take the surrounding strong type if both sides agree,
  // otherwise the paragraph's base direction.
  const base = baseRtl ? 'R' : 'L'
  const resolved = types.slice()
  for (let i = 0; i < resolved.length; i++) {
    if (resolved[i] !== 'N') continue
    let j = i
    while (j < resolved.length && types[j] === 'N') j++
    let prev = base
    for (let k = i - 1; k >= 0; k--) if (types[k] !== 'N') { prev = types[k]; break }
    const next = j < types.length ? types[j] : base
    const t = prev === next ? prev : base
    for (let k = i; k < j; k++) resolved[k] = t
    i = j - 1
  }

  // Group into logical runs.
  const runs = []
  for (let i = 0; i < chars.length; i++) {
    const rtl = resolved[i] === 'R'
    const last = runs[runs.length - 1]
    if (last && last.rtl === rtl) last.chars.push(chars[i])
    else runs.push({ rtl, chars: [chars[i]] })
  }

  // RTL runs are reversed internally (with bracket mirroring); in an RTL
  // paragraph the run order is reversed too.
  const out = runs.map((r) => ({
    rtl: r.rtl,
    text: r.rtl ? r.chars.slice().reverse().map((c) => MIRROR[c] || c).join('') : r.chars.join(''),
  }))
  return baseRtl ? out.reverse() : out
}

/** Split a visual run into font segments: Hebrew glyphs vs everything else. */
export function fontSegments(text) {
  const segs = []
  for (const ch of text) {
    const he = /[֐-׿יִ-ﭏ]/.test(ch)
    const last = segs[segs.length - 1]
    if (last && last.hebrew === he) last.text += ch
    else segs.push({ hebrew: he, text: ch })
  }
  return segs
}
