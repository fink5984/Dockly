/**
 * Centralised, validated server configuration.
 * In production, missing security-critical settings abort startup instead
 * of silently falling back to insecure defaults.
 */
import dotenv from 'dotenv'

// .env.local (git-ignored, local dev) takes precedence over .env.
// Not loaded in production so a stray local file can't override real settings.
if (process.env.NODE_ENV !== 'production') dotenv.config({ path: '.env.local', quiet: true })
dotenv.config({ quiet: true })

const env = process.env
const isProduction = env.NODE_ENV === 'production'
const isTest = env.NODE_ENV === 'test'

function required(name, fallbackForDev) {
  const value = env[name]
  if (value) return value
  if (!isProduction && fallbackForDev !== undefined) return fallbackForDev
  throw new Error(`Missing required environment variable ${name}`)
}

const databaseUrl = required('DATABASE_URL')
const looksLocal = /localhost|127\.0\.0\.1/.test(databaseUrl)

const awsConfigured = Boolean(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY && env.AWS_S3_BUCKET)

export const config = Object.freeze({
  isProduction,
  isTest,
  port: Number(env.PORT || 3001),

  databaseUrl,
  databaseSsl: env.DATABASE_SSL ? env.DATABASE_SSL !== 'false' : !looksLocal,
  databasePoolSize: Number(env.DATABASE_POOL_SIZE || 10),

  // HMAC key for session cookies and signed local-file URLs. Must be long and random.
  sessionSecret: required('SESSION_SECRET', 'dev-only-insecure-session-secret-change-me-0123456789'),
  sessionTtlDays: Number(env.SESSION_TTL_DAYS || 14),

  // Public origin, used to build links sent to clients and for Origin checks.
  appBaseUrl: (env.APP_BASE_URL || `http://localhost:${env.PORT || 3001}`).replace(/\/+$/, ''),
  // Extra allowed origins for state-changing requests (e.g. Vite dev server).
  allowedOrigins: (env.ALLOWED_ORIGINS || (isProduction ? '' : 'http://localhost:5173,http://127.0.0.1:5173'))
    .split(',').map((s) => s.trim()).filter(Boolean),

  storage: {
    driver: env.STORAGE_DRIVER || (awsConfigured ? 's3' : isProduction ? 's3' : 'local'),
    bucket: env.AWS_S3_BUCKET || 'dockly-documents',
    region: env.AWS_S3_REGION || 'il-central-1',
    accessKeyId: env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY || '',
    localDir: env.LOCAL_STORAGE_DIR || '.data/storage',
    maxUploadBytes: Number(env.MAX_UPLOAD_MB || 25) * 1024 * 1024,
  },

  whatsapp: {
    // 'cloud' sends through Meta's Cloud API; 'log' records the message without
    // sending (used in tests/dev). Defaults to 'log' unless credentials exist.
    mode: env.WHATSAPP_MODE || (env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_ID ? 'cloud' : 'log'),
    phoneId: env.WHATSAPP_PHONE_ID || '',
    accessToken: env.WHATSAPP_ACCESS_TOKEN || '',
    verifyToken: env.WHATSAPP_VERIFY_TOKEN || '',
    appSecret: env.WHATSAPP_APP_SECRET || '',
    graphApi: env.WHATSAPP_GRAPH_API || 'https://graph.facebook.com/v25.0',
    templates: {
      documentRequest: env.WA_TEMPLATE_DOCUMENT_REQUEST || '_dockly_document_request',
      documentReminder: env.WA_TEMPLATE_DOCUMENT_REMINDER || env.WA_TEMPLATE_DOCUMENT_REQUEST || '_dockly_document_request',
      documentRejected: env.WA_TEMPLATE_DOCUMENT_REJECTED || env.WA_TEMPLATE_DOCUMENT_REQUEST || '_dockly_document_request',
      staffReply: env.WA_TEMPLATE_STAFF_REPLY || env.WA_TEMPLATE_DOCUMENT_REQUEST || '_dockly_document_request',
      signatureRequest: env.WA_TEMPLATE_SIGNATURE_REQUEST || '',
      lang: env.WA_TEMPLATE_LANG || 'en',
    },
  },

  email: {
    // Optional. When RESEND_API_KEY is set, email notifications are sent
    // through Resend's HTTP API; otherwise the email channel reports "not configured".
    resendApiKey: env.RESEND_API_KEY || '',
    from: env.EMAIL_FROM || '',
  },

  automation: {
    enabled: env.AUTOMATION_ENABLED ? env.AUTOMATION_ENABLED !== 'false' : !isTest,
    intervalMs: Number(env.AUTOMATION_INTERVAL_MS || 5 * 60 * 1000),
  },
})

/** Warnings worth logging at startup (non-fatal). */
export function configWarnings() {
  const w = []
  if (!isProduction && config.sessionSecret.startsWith('dev-only')) w.push('SESSION_SECRET not set — using an insecure development secret')
  if (config.whatsapp.mode === 'cloud' && !config.whatsapp.appSecret) {
    w.push('WHATSAPP_APP_SECRET not set — webhook signatures cannot be verified; inbound webhooks will be rejected')
  }
  if (config.whatsapp.mode === 'cloud' && !config.whatsapp.verifyToken) w.push('WHATSAPP_VERIFY_TOKEN not set — webhook verification handshake will fail')
  if (config.storage.driver === 'local' && isProduction) w.push('STORAGE_DRIVER=local in production — files are stored on the container disk')
  return w
}

if (isProduction && config.sessionSecret.length < 32) {
  throw new Error('SESSION_SECRET must be at least 32 characters')
}
