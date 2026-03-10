/**
 * Migration: Switch from Supabase Auth to custom email/password.
 * Usage: node supabase/run-custom-auth-migration.mjs
 */
import pg from 'pg'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(__dirname, 'migrate-custom-auth.sql'), 'utf-8')

const connectionString =
  'postgresql://postgres.mjtbahthexznbnmuyvhu:MbJu%23N%2FK6J6ANpR@aws-1-eu-west-1.pooler.supabase.com:5432/postgres'

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })

try {
  console.log('Connecting to Supabase...')
  await client.connect()
  console.log('Running custom-auth migration...')
  await client.query(sql)
  console.log('✓ Migration completed! Custom auth is now active.')
} catch (err) {
  console.error('✗ Migration failed:', err.message)
  process.exit(1)
} finally {
  await client.end()
}
