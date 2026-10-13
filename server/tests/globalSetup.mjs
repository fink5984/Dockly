/**
 * Creates a fresh, uniquely named test database on the local Postgres,
 * applies all migrations, and drops it afterwards. Integration tests are
 * skipped (not failed) when no local Postgres is reachable.
 */
import pg from 'pg'
import { runMigrations } from '../db/migrate.mjs'

export default async function setup() {
  const adminUrl = process.env.TEST_DATABASE_ADMIN_URL || 'postgresql://postgres@127.0.0.1:54329/postgres'
  const dbName = process.env.TEST_DB_NAME
  if (!dbName || !/^dockly_it_[a-z0-9]+$/.test(dbName)) throw new Error('Refusing to run: unexpected test database name')
  const admin = new pg.Client({ connectionString: adminUrl })
  try {
    await admin.connect()
  } catch {
    console.warn('[tests] local Postgres not reachable — integration tests will be skipped')
    process.env.DOCKLY_IT_SKIP = '1'
    return () => {}
  }
  await admin.query(`CREATE DATABASE ${dbName}`)
  await admin.end()
  const dbUrl = adminUrl.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`)
  await runMigrations({ connectionString: dbUrl, ssl: false, log: () => {} })

  return async () => {
    const a = new pg.Client({ connectionString: adminUrl })
    await a.connect()
    await a.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [dbName])
    await a.query(`DROP DATABASE IF EXISTS ${dbName}`)
    await a.end()
  }
}
