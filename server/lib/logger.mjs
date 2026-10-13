/**
 * Minimal structured logger (JSON lines in production, readable in dev).
 * Redacts values whose keys look sensitive so tokens/passwords never reach logs.
 */
const SENSITIVE = /pass(word)?|secret|token|authorization|cookie|signature|base64|value/i
const isProd = process.env.NODE_ENV === 'production'
const silent = process.env.NODE_ENV === 'test' && !process.env.DEBUG_LOGS

function redact(value, depth = 0) {
  if (depth > 4 || value === null || value === undefined) return value
  if (value instanceof Error) {
    return { name: value.name, message: value.message, code: value.code, stack: isProd ? undefined : value.stack }
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1))
  if (typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE.test(k) && k !== 'err' ? '[redacted]' : redact(v, depth + 1)
    }
    return out
  }
  if (typeof value === 'string' && value.length > 500) return value.slice(0, 500) + '…'
  return value
}

function write(level, msg, fields) {
  if (silent && level !== 'error') return
  const entry = { level, msg, time: new Date().toISOString(), ...redact(fields || {}) }
  const line = isProd ? JSON.stringify(entry) : `[${level}] ${msg} ${fields ? JSON.stringify(redact(fields)) : ''}`
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const logger = {
  info: (msg, fields) => write('info', msg, fields),
  warn: (msg, fields) => write('warn', msg, fields),
  error: (msg, fields) => write('error', msg, fields),
}

export { redact }
