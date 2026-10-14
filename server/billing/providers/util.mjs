/**
 * Split a VAT-inclusive total across quote lines for provider documents, so
 * the product lines always sum exactly to the charged amount.
 */
export function documentLines(lines, total) {
  const subtotal = lines.reduce((s, l) => s + l.total, 0)
  if (!lines.length) return []
  let allocated = 0
  return lines.map((l, i) => {
    const gross = i === lines.length - 1 ? total - allocated : Math.round((l.total / (subtotal || 1)) * total)
    allocated += gross
    return { code: l.code, kind: l.kind, qty: l.qty, gross }
  })
}
