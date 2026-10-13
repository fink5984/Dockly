/**
 * HTTP helpers: typed errors, zod validation, and a safe error handler that
 * never leaks database/storage internals to clients.
 */
import { ZodError } from 'zod'
import { logger } from './logger.mjs'

export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} code machine-readable code the frontend can translate
   * @param {string} [message] safe, user-facing message
   * @param {object} [details]
   */
  constructor(status, code, message, details) {
    super(message || code)
    this.status = status
    this.code = code
    this.details = details
  }
}

export const badRequest = (code = 'bad_request', message, details) => new HttpError(400, code, message, details)
export const unauthorized = (code = 'unauthorized', message = 'Authentication required') => new HttpError(401, code, message)
export const forbidden = (code = 'forbidden', message = 'You do not have permission to do that') => new HttpError(403, code, message)
export const notFound = (code = 'not_found', message = 'Not found') => new HttpError(404, code, message)
export const conflict = (code = 'conflict', message, details) => new HttpError(409, code, message, details)
export const gone = (code = 'gone', message = 'This link has expired') => new HttpError(410, code, message)
export const tooMany = (retryAfterSec) => new HttpError(429, 'rate_limited', 'Too many requests, please slow down', { retryAfter: retryAfterSec })

/** Parse `data` with a zod schema or throw a 400 listing the invalid fields. */
export function parse(schema, data) {
  try {
    return schema.parse(data)
  } catch (err) {
    if (err instanceof ZodError) {
      const fields = {}
      for (const issue of err.issues) {
        const key = issue.path.join('.') || '_'
        if (!fields[key]) fields[key] = issue.message
      }
      throw badRequest('validation_failed', 'Some fields are invalid', { fields })
    }
    throw err
  }
}

export function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

/** Express param guard: 404 for malformed ids instead of a DB cast error. */
export function requireUuid(value) {
  if (!isUuid(value)) throw notFound()
  return value
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    if (err.status === 429 && err.details?.retryAfter) res.setHeader('Retry-After', String(err.details.retryAfter))
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } })
  }
  // multer limits
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: { code: 'file_too_large', message: 'The file is too large' } })
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'payload_too_large', message: 'Request is too large' } })
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'invalid_json', message: 'Malformed JSON body' } })
  }
  logger.error('unhandled_error', { path: req.path, method: req.method, err })
  return res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong. Please try again.' } })
}
