/**
 * Product funnel report (aggregate only — no personal data is stored).
 *
 *   node scripts/funnel-report.mjs [--days 30]
 *
 * Landing → signup is joined by the per-tab session id when the visitor
 * signed up in the same tab; everything after signup is per workspace.
 */
import { query, closePool } from '../server/db/pool.mjs'

const i = process.argv.indexOf('--days')
const days = Math.max(1, Math.min(365, Number(i > 0 ? process.argv[i + 1] : 30) || 30))
const since = new Date(Date.now() - days * 86_400_000)

try {
  const visits = (await query(
    `SELECT count(DISTINCT COALESCE(session_id, id::text))::int AS n FROM funnel_events WHERE event = 'landing_visit' AND occurred_at >= $1`, [since]))[0].n
  const pricing = (await query(
    `SELECT count(DISTINCT COALESCE(session_id, id::text))::int AS n FROM funnel_events WHERE event = 'pricing_viewed' AND occurred_at >= $1`, [since]))[0].n
  const cohort = await query(`SELECT workspace_id FROM funnel_events WHERE event = 'signup' AND occurred_at >= $1`, [since])
  const ids = cohort.map((r) => r.workspace_id)
  const reached = async (event) => (ids.length ? (await query(`SELECT count(*)::int AS n FROM funnel_events WHERE event = $1 AND workspace_id = ANY($2::uuid[])`, [event, ids]))[0].n : 0)
  const fromLanding = (await query(
    `SELECT count(*)::int AS n FROM funnel_events s WHERE s.event = 'signup' AND s.occurred_at >= $1
       AND EXISTS (SELECT 1 FROM funnel_events v WHERE v.event = 'landing_visit' AND v.session_id = s.session_id)`, [since]))[0].n

  const steps = [
    ['landing visits (sessions)', visits],
    ['pricing viewed (sessions)', pricing],
    ['signups', ids.length],
    ['  …of which came through the landing page in the same tab', fromLanding],
    ['onboarding completed', await reached('onboarding_completed')],
    ['first request', await reached('first_request')],
    ['first client upload', await reached('first_upload_completed')],
    ['first signature completed', await reached('first_signature_completed')],
    ['trial → paid', await reached('trial_to_paid')],
  ]
  const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—')
  console.log(`Sadir funnel — last ${days} days (signup cohort since ${since.toISOString().slice(0, 10)})\n`)
  for (const [label, n] of steps) {
    const base = label.startsWith('landing') || label.startsWith('pricing') ? visits : label.startsWith('signups') ? visits : ids.length
    console.log(`${label.padEnd(58)} ${String(n).padStart(6)}   ${label === 'landing visits (sessions)' ? '' : pct(n, base)}`)
  }
  const utm = await query(
    `SELECT props->>'utm_source' AS source, count(*)::int AS signups FROM funnel_events WHERE event = 'signup' AND occurred_at >= $1 GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, [since])
  if (utm.length) { console.log('\nSignups by utm_source'); console.table(utm.map((r) => ({ source: r.source || '(none)', signups: r.signups }))) }
} finally {
  await closePool()
}
