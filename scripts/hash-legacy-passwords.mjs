/**
 * One-off: replace every legacy plaintext password with a scrypt hash.
 * Users keep the same password; the plaintext is erased.
 *
 *   DATABASE_URL=... node scripts/hash-legacy-passwords.mjs --dry-run
 *   DATABASE_URL=... node scripts/hash-legacy-passwords.mjs
 *
 * Safe to re-run (only touches rows that still have plaintext and no hash).
 * Run after migration 0002 is applied.
 */
import pg from 'pg'
import { hashPassword } from '../server/lib/passwords.mjs'

const url = process.env.DATABASE_URL
if (!url) { console.error('DATABASE_URL is required'); process.exit(1) }
const dryRun = process.argv.includes('--dry-run')
const ssl = /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false }
const client = new pg.Client({ connectionString: url, ssl })
await client.connect()
try {
  const { rows } = await client.query(`SELECT id, password FROM profiles WHERE password <> '' AND password_hash IS NULL`)
  console.log(`${rows.length} profile(s) still have a plaintext password${dryRun ? ' (dry run — nothing changed)' : ''}`)
  if (!dryRun) {
    for (const r of rows) {
      await client.query(`UPDATE profiles SET password_hash = $2, password = '' WHERE id = $1 AND password_hash IS NULL`, [r.id, await hashPassword(r.password)])
    }
    const left = await client.query(`SELECT count(*)::int AS n FROM profiles WHERE password <> ''`)
    console.log(`done; plaintext remaining: ${left.rows[0].n}`)
  }
} finally {
  await client.end()
}
