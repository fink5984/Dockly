/**
 * Starts an isolated Sadir server for Playwright: fresh database on the
 * local dev Postgres (.data/pg, port 54330), local file storage, WhatsApp in
 * log mode. Never touches production.
 */
import pg from 'pg'
import { randomBytes } from 'crypto'
import { rmSync } from 'fs'
import { resolve } from 'path'

const ADMIN = process.env.E2E_ADMIN_URL || 'postgresql://postgres@127.0.0.1:54330/postgres'
const DB = 'dockly_e2e'
const PORT = process.env.E2E_PORT || '3199'

const admin = new pg.Client({ connectionString: ADMIN })
await admin.connect()
await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [DB])
await admin.query(`DROP DATABASE IF EXISTS ${DB}`)
await admin.query(`CREATE DATABASE ${DB}`)
await admin.end()

const url = ADMIN.replace(/\/postgres$/, `/${DB}`)
const storageDir = resolve(import.meta.dirname, '..', '.data', 'e2e-storage')
rmSync(storageDir, { recursive: true, force: true })
Object.assign(process.env, {
  NODE_ENV: 'development', DATABASE_URL: url, DATABASE_SSL: 'false', PORT, SESSION_SECRET: randomBytes(32).toString('hex'),
  APP_BASE_URL: `http://127.0.0.1:${PORT}`,
  // Passkeys need a domain, not an IP: passkey specs open the app on localhost,
  // and on old.localhost to stand in for a second address (like the Railway one).
  // Related origins need https, so each address keeps its own passkeys here.
  ALLOWED_ORIGINS: `http://localhost:${PORT},http://old.localhost:${PORT}`, WEBAUTHN_RELATED_ORIGINS: 'false',
  STORAGE_DRIVER: 'local', LOCAL_STORAGE_DIR: storageDir,
  WHATSAPP_MODE: 'log', AUTOMATION_ENABLED: 'false', DISABLE_RATE_LIMIT: 'true', AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: '', RESEND_API_KEY: '',
})
const { runMigrations } = await import('../server/db/migrate.mjs')
await runMigrations({ connectionString: url, ssl: false, log: () => {} })
await import('../server/index.mjs')
