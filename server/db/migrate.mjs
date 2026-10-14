/**
 * Versioned SQL migration runner.
 *
 *   node server/db/migrate.mjs            apply pending migrations
 *   node server/db/migrate.mjs --dry-run  list pending migrations, change nothing
 *   node server/db/migrate.mjs --status   show applied/pending
 *
 * Migrations live in server/db/migrations/NNNN_name.sql, run in order,
 * each inside its own transaction, and are recorded in schema_migrations
 * with a checksum. A changed checksum for an applied migration aborts the
 * run — edit-in-place of shipped migrations is not allowed.
 */
import 'dotenv/config'
import { readdirSync, readFileSync } from 'fs'
import { createHash } from 'crypto'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import pg from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dirname, 'migrations')

export function listMigrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort()
    .map((file) => {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
      // Line endings depend on the checkout (CRLF on Windows with autocrlf, LF on
      // Railway), so the checksum is taken over LF-normalised text.
      // `legacyChecksums` (raw LF and CRLF forms) keep checksums recorded before
      // this normalisation valid on either platform.
      const lf = sql.replace(/\r\n/g, '\n')
      const hash = (t) => createHash('sha256').update(t).digest('hex')
      return {
        version: file.slice(0, 4),
        file,
        sql,
        checksum: hash(lf),
        legacyChecksums: [hash(sql), hash(lf.replace(/\n/g, '\r\n'))],
      }
    })
}

export async function runMigrations({ connectionString, ssl, dryRun = false, log = console.log } = {}) {
  const client = new pg.Client({ connectionString, ssl: ssl ? { rejectUnauthorized: false } : false })
  await client.connect()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        version TEXT PRIMARY KEY,
        file TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)
    await client.query('ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY')

    const { rows: applied } = await client.query('SELECT version, file, checksum FROM public.schema_migrations')
    const appliedMap = new Map(applied.map((r) => [r.version, r]))
    const files = listMigrationFiles()

    for (const m of files) {
      const prior = appliedMap.get(m.version)
      if (prior && prior.checksum !== m.checksum && !m.legacyChecksums.includes(prior.checksum)) {
        throw new Error(`Migration ${m.file} was modified after being applied (checksum mismatch). Create a new migration instead.`)
      }
    }

    const pending = files.filter((m) => !appliedMap.has(m.version))
    if (pending.length === 0) {
      log('[migrate] up to date')
      return { applied: [], pending: [] }
    }
    if (dryRun) {
      log(`[migrate] ${pending.length} pending (dry run):`)
      for (const m of pending) log(`  - ${m.file}`)
      return { applied: [], pending: pending.map((m) => m.file) }
    }

    const done = []
    for (const m of pending) {
      log(`[migrate] applying ${m.file}`)
      await client.query('BEGIN')
      try {
        await client.query(m.sql)
        await client.query(
          'INSERT INTO public.schema_migrations (version, file, checksum) VALUES ($1, $2, $3)',
          [m.version, m.file, m.checksum],
        )
        await client.query('COMMIT')
        done.push(m.file)
      } catch (err) {
        await client.query('ROLLBACK')
        throw new Error(`[migrate] ${m.file} failed: ${err.message}`)
      }
    }
    log(`[migrate] applied ${done.length} migration(s)`)
    return { applied: done, pending: [] }
  } finally {
    await client.end()
  }
}

// CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('DATABASE_URL is required')
    process.exit(1)
  }
  const ssl = process.env.DATABASE_SSL ? process.env.DATABASE_SSL !== 'false' : !/localhost|127\.0\.0\.1/.test(connectionString)
  const dryRun = process.argv.includes('--dry-run') || process.argv.includes('--status')
  runMigrations({ connectionString, ssl, dryRun })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err.message)
      process.exit(1)
    })
}
