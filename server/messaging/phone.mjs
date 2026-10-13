/**
 * Normalize a phone number to WhatsApp's expected format: international
 * digits without '+'. Israeli local mobiles (05X-XXXXXXX) are converted to
 * 9725X… since that's the dominant local format among Dockly customers.
 * @returns {string|null} digits, or null if it can't be a valid number
 */
export function normalizePhone(input, defaultCountry = '972') {
  if (!input) return null
  let raw = String(input).trim()
  const hadPlus = raw.startsWith('+')
  let digits = raw.replace(/\D/g, '')
  if (!digits) return null
  if (!hadPlus && digits.startsWith('00')) digits = digits.slice(2)
  else if (!hadPlus && digits.startsWith('0') && defaultCountry) digits = defaultCountry + digits.slice(1)
  if (digits.length < 8 || digits.length > 15) return null
  return digits
}

/** Display a normalized number with a leading '+'. */
export function formatPhone(digits) {
  return digits ? `+${digits}` : ''
}
