/**
 * Billing operations for Dockly staff. Uses DATABASE_URL (and payment
 * provider settings) from the environment. Every write needs --yes and is
 * recorded in billing_events with actor 'operator'.
 *
 *   node scripts/billing-admin.mjs status <workspace-id | owner-email>
 *   node scripts/billing-admin.mjs list [--status trialing|active|past_due|…]
 *   node scripts/billing-admin.mjs extend-trial <workspace> <days> --yes
 *   node scripts/billing-admin.mjs legacy-deadline <workspace | --all-legacy> <YYYY-MM-DD> --yes
 *   node scripts/billing-admin.mjs comp <workspace> <plan-code | none> --yes
 *   node scripts/billing-admin.mjs reconcile <from YYYY-MM-DD> <to YYYY-MM-DD>
 *   node scripts/billing-admin.mjs tick --yes          (run the billing job once)
 */
import { query, queryOne, closePool } from '../server/db/pool.mjs'
import { recordBillingEvent, reconciliationReport, runBillingTick } from '../server/billing/service.mjs'
import { getAccess } from '../server/billing/access.mjs'
import { findPlan } from '../shared/billing/pricing.mjs'

const [cmd, ...rest] = process.argv.slice(2)
const args = rest.filter((a) => !a.startsWith('--'))
const flag = (name) => rest.includes(`--${name}`)
const option = (name) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined }
const die = (msg) => { console.error(msg); process.exitCode = 1 }
const confirm = () => { if (!flag('yes')) throw new Error('This changes data. Re-run with --yes.') }

async function resolveWorkspace(ref) {
  if (!ref) throw new Error('Workspace id or owner email required')
  const row = /^[0-9a-f-]{36}$/i.test(ref)
    ? await queryOne('SELECT id, name FROM workspaces WHERE id = $1', [ref])
    : await queryOne('SELECT w.id, w.name FROM workspaces w JOIN profiles p ON p.workspace_id = w.id WHERE lower(p.email) = lower($1)', [ref])
  if (!row) throw new Error(`No workspace found for ${ref}`)
  return row
}

const commands = {
  async status() {
    const ws = await resolveWorkspace(args[0])
    const a = await getAccess(ws.id, { measure: true })
    const r = a.row
    console.log(JSON.stringify({
      workspace: ws, status: a.status, stored: r.status, plan: r.plan_code, interval: r.billing_interval, addons: r.addons,
      trial: { started: r.trial_started_at, ends: r.trial_ends_at }, period: { start: r.current_period_start, end: r.current_period_end },
      cancelAtPeriodEnd: r.cancel_at_period_end, pending: r.pending_plan_code, dunning: { since: r.past_due_since, graceEnds: r.grace_ends_at, nextRetry: r.next_retry_at, retries: r.retry_count },
      legacyUntil: r.legacy_until, card: r.card_last4 ? `${r.card_brand || ''} •••• ${r.card_last4}` : null,
      limits: a.limits, usage: a.usage,
    }, null, 2))
    const events = await query('SELECT created_at, type, actor, details FROM billing_events WHERE workspace_id = $1 ORDER BY id DESC LIMIT 15', [ws.id])
    console.table(events.map((e) => ({ at: e.created_at.toISOString(), type: e.type, actor: e.actor })))
  },

  async list() {
    const status = option('status')
    const rows = await query(
      `SELECT w.id, w.name, s.status, s.plan_code, s.trial_ends_at, s.current_period_end FROM workspace_subscriptions s JOIN workspaces w ON w.id = s.workspace_id
        ${status ? 'WHERE s.status = $1' : ''} ORDER BY w.created_at DESC LIMIT 500`, status ? [status] : [],
    )
    console.table(rows.map((r) => ({ id: r.id, name: r.name, status: r.status, plan: r.plan_code || '', trialEnds: r.trial_ends_at?.toISOString().slice(0, 10) || '', periodEnd: r.current_period_end?.toISOString().slice(0, 10) || '' })))
    const totals = await query('SELECT status, count(*)::int AS n FROM workspace_subscriptions GROUP BY status ORDER BY 2 DESC')
    console.table(totals)
  },

  async 'extend-trial'() {
    const ws = await resolveWorkspace(args[0])
    const days = Number(args[1])
    if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error('Days must be 1–90')
    confirm()
    const r = await queryOne(
      `UPDATE workspace_subscriptions SET status = 'trialing', trial_ends_at = GREATEST(COALESCE(trial_ends_at, now()), now()) + make_interval(hours => $2 * 24),
          trial_reminders_sent = '[]'::jsonb, version = version + 1
        WHERE workspace_id = $1 AND status IN ('trialing','expired') RETURNING trial_ends_at`, [ws.id, days],
    )
    if (!r) throw new Error('Only trialing or expired-trial workspaces can be extended')
    await recordBillingEvent({ query }, ws.id, 'trial_extended', 'operator', { days, trialEndsAt: r.trial_ends_at })
    console.log(`Trial for ${ws.name} now ends ${r.trial_ends_at.toISOString()}`)
  },

  /** Give grandfathered workspaces a date by which to choose a plan (send notice first!). */
  async 'legacy-deadline'() {
    const date = args[args.length - 1]
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Date must be YYYY-MM-DD')
    const until = new Date(`${date}T21:00:00Z`) // end of day in Israel
    if (until.getTime() - Date.now() < 30 * 86_400_000 && !flag('short-notice')) {
      throw new Error('Give legacy customers at least 30 days’ notice (or pass --short-notice deliberately)')
    }
    const targets = flag('all-legacy')
      ? await query(`SELECT w.id, w.name FROM workspaces w JOIN workspace_subscriptions s ON s.workspace_id = w.id WHERE s.status = 'legacy'`)
      : [await resolveWorkspace(args[0])]
    console.log(`${targets.length} workspace(s) → legacy access until ${until.toISOString()}`)
    confirm()
    for (const ws of targets) {
      await query(`UPDATE workspace_subscriptions SET legacy_until = $2, version = version + 1 WHERE workspace_id = $1 AND status = 'legacy'`, [ws.id, until])
      await recordBillingEvent({ query }, ws.id, 'legacy_deadline_set', 'operator', { until })
    }
  },

  /** Complimentary access (pilot customers, partners): plan limits, never billed. */
  async comp() {
    const ws = await resolveWorkspace(args[0])
    const code = args[1]
    if (code !== 'none' && !findPlan(code)) throw new Error(`Unknown plan ${code}`)
    confirm()
    await query(
      `UPDATE workspace_subscriptions SET status = 'comped', plan_code = $2, billing_interval = NULL, current_period_start = NULL, current_period_end = NULL,
          cancel_at_period_end = false, past_due_since = NULL, grace_ends_at = NULL, next_retry_at = NULL, version = version + 1 WHERE workspace_id = $1`,
      [ws.id, code === 'none' ? null : code],
    )
    await recordBillingEvent({ query }, ws.id, 'comped', 'operator', { plan: code })
    console.log(`${ws.name} is now complimentary (${code === 'none' ? 'no limits' : code})`)
  },

  async reconcile() {
    const [from, to] = args
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) throw new Error('Usage: reconcile <from> <to> (YYYY-MM-DD)')
    const report = await reconciliationReport({ from: new Date(`${from}T00:00:00Z`), to: new Date(`${to}T23:59:59Z`) })
    console.log(JSON.stringify(report, null, 2))
    if (report.issues.length) process.exitCode = 2
  },

  async tick() {
    confirm()
    console.log(await runBillingTick())
  },
}

try {
  const fn = commands[cmd]
  if (!fn) die(`Unknown command. Commands: ${Object.keys(commands).join(', ')}`)
  else await fn()
} catch (err) {
  die(err.message)
} finally {
  await closePool()
}
