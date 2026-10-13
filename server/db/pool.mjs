/**
 * Postgres connection pool. The server is the only component that talks
 * to the database; it connects as the table owner (bypasses RLS) and every
 * query that touches tenant data is scoped by workspace_id explicitly.
 */
import pg from 'pg'
import { config } from '../config.mjs'

// Return BIGINT/NUMERIC counts as JS numbers (file sizes stay < 2^53).
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)))
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)))

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : false,
  max: config.databasePoolSize,
  idleTimeoutMillis: 30_000,
})

pool.on('error', (err) => {
  console.error('[db] idle client error:', err.message)
})

/** Run a parameterized query and return rows. */
export async function query(text, params = []) {
  const res = await pool.query(text, params)
  return res.rows
}

/** Run a query and return the first row or null. */
export async function queryOne(text, params = []) {
  const res = await pool.query(text, params)
  return res.rows[0] ?? null
}

/**
 * Run `fn` inside a transaction. `fn` receives a client with the same
 * `query`/`queryOne` helpers; the transaction rolls back if it throws.
 */
export async function withTransaction(fn) {
  const client = await pool.connect()
  const tx = {
    query: async (text, params = []) => (await client.query(text, params)).rows,
    queryOne: async (text, params = []) => (await client.query(text, params)).rows[0] ?? null,
  }
  try {
    await client.query('BEGIN')
    const result = await fn(tx)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

export async function closePool() {
  await pool.end()
}
