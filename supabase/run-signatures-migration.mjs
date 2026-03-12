/**
 * Migration: Create signature_requests & signature_fields tables.
 * Usage: node supabase/run-signatures-migration.mjs
 */
import pg from 'pg'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(__dirname, 'signatures-migration.sql'), 'utf-8')

const connectionString =
  'postgresql://postgres.mjtbahthexznbnmuyvhu:MbJu%23N%2FK6J6ANpR@aws-1-eu-west-1.pooler.supabase.com:5432/postgres'

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })

try {
  console.log('Connecting to Supabase...')
  await client.connect()
  console.log('Running signatures migration...')
  await client.query(sql)
  console.log('✓ Signatures migration completed! Tables created.')
} catch (err) {
  console.error('✗ Migration failed:', err.message)
  process.exit(1)
} finally {
  await client.end()
}
