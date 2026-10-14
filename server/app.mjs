/**
 * Express application (no listening here — see index.mjs). Exported as a
 * factory so integration tests can boot it against a test database.
 */
import express from 'express'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync } from 'fs'
import { config } from './config.mjs'
import { queryOne } from './db/pool.mjs'
import { errorHandler, notFound } from './lib/http.mjs'
import { attachUser, csrfProtection, requireAuth } from './middleware/auth.mjs'
import { storage, verifyLocalFileToken } from './storage.mjs'
import { contentDisposition } from './lib/files.mjs'
import authRoutes from './routes/auth.mjs'
import workspaceRoutes from './routes/workspace.mjs'
import clientRoutes from './routes/clients.mjs'
import libraryRoutes from './routes/library.mjs'
import requestRoutes from './routes/requests.mjs'
import signatureRoutes from './routes/signatures.mjs'
import supportRoutes from './routes/support.mjs'
import insightRoutes from './routes/insights.mjs'
import publicRoutes from './routes/public.mjs'
import { billingRouter, publicBillingRouter } from './routes/billing.mjs'
import analyticsRoutes from './routes/analytics.mjs'
import { handleVerification, handleIncoming } from './messaging/whatsappBot.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIST = join(__dirname, '..', 'dist')

const S3_ORIGINS = 'https://*.amazonaws.com'

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  // Portal/sign URLs carry secret tokens: never leak them to third parties via Referer.
  res.setHeader('Referrer-Policy', 'same-origin')
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
  if (config.isProduction) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${S3_ORIGINS}`,
    "font-src 'self' data:",
    `connect-src 'self' ${S3_ORIGINS}`,
    `frame-src 'self' blob: ${S3_ORIGINS}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '))
  next()
}

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 1) // Railway edge proxy → req.ip is the client
  app.use(securityHeaders)

  app.use(express.json({
    limit: '2mb',
    // Keep raw bytes for webhook signature verification.
    verify: (req, _res, buf) => { if (req.url.startsWith('/api/whatsapp/webhook')) req.rawBody = buf },
  }))

  app.get('/api/health', async (_req, res) => {
    let db = 'ok'
    try { await queryOne('SELECT 1') } catch { db = 'error' }
    res.status(db === 'ok' ? 200 : 503).json({ status: db === 'ok' ? 'ok' : 'degraded', db, storage: storage.driverName, time: new Date().toISOString() })
  })

  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })
  app.use('/api', attachUser)
  app.use('/api', csrfProtection)

  // WhatsApp (authenticated by Meta signature, not cookies)
  app.get('/api/whatsapp/webhook', handleVerification)
  app.post('/api/whatsapp/webhook', handleIncoming)

  // Local storage driver: serve files via signed, expiring URLs.
  app.get('/api/files/local/:token', async (req, res) => {
    if (storage.driverName !== 'local') throw notFound()
    const data = verifyLocalFileToken(req.params.token)
    if (!data) throw notFound()
    const { buffer, contentType } = await storage.get(data.k)
    res.setHeader('Content-Type', data.t || contentType || 'application/octet-stream')
    if (data.n) res.setHeader('Content-Disposition', contentDisposition(data.n, data.d === 'attachment' ? 'attachment' : 'inline'))
    res.setHeader('Cache-Control', 'private, max-age=60')
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox")
    res.send(buffer)
  })

  // Legacy endpoints removed in the security upgrade.
  app.all(/^\/api\/storage(\/.*)?$/, (_req, _res, next) => next(notFound('endpoint_removed', 'This endpoint was removed')))
  app.all(/^\/api\/whatsapp\/(send|support)(\/.*)?$/, requireAuth, (_req, _res, next) => next(notFound('endpoint_removed', 'This endpoint was removed')))

  app.use('/api/auth', authRoutes)
  // Payment providers may post form-encoded callbacks.
  app.use('/api/public/billing/webhook', express.urlencoded({ extended: false, limit: '100kb' }))
  app.use('/api/public/billing', publicBillingRouter)
  app.use('/api/public', analyticsRoutes)
  app.use('/api/public', publicRoutes)
  app.use('/api/billing', billingRouter)
  app.use('/api', workspaceRoutes)
  app.use('/api', libraryRoutes)
  app.use('/api', insightRoutes)
  app.use('/api/clients', clientRoutes)
  app.use('/api/requests', requestRoutes)
  app.use('/api/signatures', signatureRoutes)
  app.use('/api/support', supportRoutes)

  app.use('/api', (_req, _res, next) => next(notFound()))

  // Static frontend
  if (existsSync(DIST)) {
    app.use('/assets', express.static(join(DIST, 'assets'), { immutable: true, maxAge: '1y', index: false }))
    app.use(express.static(DIST, { index: false, maxAge: '1h' }))
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache')
      res.sendFile(join(DIST, 'index.html'))
    })
  }

  app.use(errorHandler)
  return app
}
