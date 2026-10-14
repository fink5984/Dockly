/**
 * Human-readable names for catalog items, used on provider tax documents and
 * in billing emails. The UI has its own i18n dictionary; these are the
 * server-side equivalents.
 */
const NAMES = {
  collect_starter: ['Sadir Document Collection — Starter', 'Sadir איסוף מסמכים — Starter'],
  collect_pro: ['Sadir Document Collection — Pro', 'Sadir איסוף מסמכים — Pro'],
  sign_starter: ['Sadir E-Signatures — Starter', 'Sadir חתימות דיגיטליות — Starter'],
  sign_pro: ['Sadir E-Signatures — Pro', 'Sadir חתימות דיגיטליות — Pro'],
  suite_starter: ['Sadir Suite (Collection + Signatures) — Starter', 'Sadir חבילה משולבת (איסוף + חתימות) — Starter'],
  suite_pro: ['Sadir Suite (Collection + Signatures) — Pro', 'Sadir חבילה משולבת (איסוף + חתימות) — Pro'],
  storage_10gb: ['Extra storage, 10 GB', 'נפח אחסון נוסף, 10GB'],
  extra_seat: ['Extra team seat', 'משתמש נוסף בצוות'],
  requests_25: ['Request pack, 25 document requests', 'חבילת 25 בקשות מסמכים'],
  envelopes_25: ['Signature pack, 25 envelopes', 'חבילת 25 בקשות חתימה'],
  proration: ['Plan change (prorated for the rest of the period)', 'שינוי מסלול (יחסי ליתרת התקופה)'],
}

export function itemName(code, lang = 'he') {
  const n = NAMES[code]
  if (!n) return code
  return lang === 'en' ? n[0] : n[1]
}

export function lineDescription(line, lang = 'he', interval = null) {
  const base = itemName(line.code, lang)
  if (line.kind === 'proration' || line.kind === 'pack' || !interval) return line.qty > 1 ? `${base} × ${line.qty}` : base
  const per = interval === 'year' ? (lang === 'en' ? 'yearly' : 'שנתי') : (lang === 'en' ? 'monthly' : 'חודשי')
  return `${base} (${per})${line.qty > 1 ? ` × ${line.qty}` : ''}`
}
