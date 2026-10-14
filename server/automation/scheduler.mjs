/**
 * Automated reminders.
 *
 * Runs on an interval inside the web process (Sadir is a single Railway
 * service; a dedicated worker isn't justified yet). Guarantees:
 *  - single runner: a Postgres advisory lock means two instances can't both tick
 *  - idempotent: each reminder has a unique delivery key
 *    (auto_reminder:<case>:<n>:a<attempt>), so a crash/retry never double-sends
 *  - bounded retries: up to 3 attempts per reminder for transient failures;
 *    permanent errors (no valid phone/email) are not retried
 *  - respects per-workspace opt-in, quiet hours, weekend days and timezone
 */
import { pool, query, withTransaction } from '../db/pool.mjs'
import { config } from '../config.mjs'
import { logger } from '../lib/logger.mjs'
import { publish } from '../lib/events.mjs'
import { automationSettings } from '../routes/workspace.mjs'
import { sendRequestMessage, sendSignatureMessage } from '../messaging/index.mjs'
import { appendEvent } from '../signing/service.mjs'
import { messagingAllowed } from '../billing/access.mjs'

const LOCK_ID = 727_001
const MAX_ATTEMPTS = 3
const PERMANENT = new Set(['invalid_phone', 'invalid_email', 'email_not_configured', 'whatsapp_template_missing', 'not_pending', 'request_not_found'])

/** Local wall-clock info for a timezone. */
export function localTime(now, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false }).formatToParts(now)
    const get = (t) => parts.find((p) => p.type === t)?.value
    const days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
    return { minutes: Number(get('hour')) * 60 + Number(get('minute')), weekday: days[get('weekday')] }
  } catch {
    return { minutes: now.getUTCHours() * 60 + now.getUTCMinutes(), weekday: now.getUTCDay() }
  }
}

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** Is `now` inside the workspace's quiet window or a weekend day? */
export function isQuiet(settings, now, timeZone) {
  const t = localTime(now, timeZone || 'UTC')
  if (settings.weekendDays?.includes(t.weekday)) return true
  if (!settings.quietHours?.enabled) return false
  const start = toMinutes(settings.quietHours.start)
  const end = toMinutes(settings.quietHours.end)
  return start <= end ? t.minutes >= start && t.minutes < end : t.minutes >= start || t.minutes < end
}

async function attemptNumber(prefix) {
  const rows = await query(`SELECT status, error FROM message_deliveries WHERE idempotency_key LIKE $1`, [`${prefix}:a%`])
  if (rows.some((r) => r.status !== 'failed')) return null // already succeeded / in flight
  if (rows.length >= MAX_ATTEMPTS) return null
  if (rows.some((r) => PERMANENT.has(r.error))) return null
  return rows.length + 1
}

async function requestReminders(ws, s, now, stats) {
  const r = s.requestReminders
  const due = await query(
    `SELECT c.id, c.reminder_count FROM cases c
      WHERE c.workspace_id = $1 AND c.status IN ('waiting-for-client','partial-submission','delayed')
        AND c.reminders_enabled AND c.sent_at IS NOT NULL AND c.reminder_count < $2
        AND EXISTS (SELECT 1 FROM case_documents d WHERE d.case_id = c.id AND d.is_required AND d.status IN ('missing','pending-upload','rejected','blurry','missing-pages'))
        AND ( (c.last_reminder_at IS NULL AND c.sent_at <= $3::timestamptz - make_interval(days => $4))
           OR (c.last_reminder_at IS NOT NULL AND c.last_reminder_at <= $3::timestamptz - make_interval(days => $5)) )
      ORDER BY c.sent_at LIMIT 50`,
    [ws.id, r.maxReminders, now.toISOString(), r.firstAfterDays, r.repeatEveryDays],
  )
  for (const c of due) {
    const prefix = `auto_reminder:${c.id}:${c.reminder_count + 1}`
    const attempt = await attemptNumber(prefix)
    if (!attempt) continue
    const res = await sendRequestMessage({
      workspaceId: ws.id, caseId: c.id, kind: 'request_reminder', channel: r.channel, triggeredBy: 'automation', idempotencyKey: `${prefix}:a${attempt}`,
    })
    if (res.ok) stats.sent++
    else {
      stats.failed++
      if (res.code && PERMANENT.has(res.code)) {
        // Record a permanent failure so it isn't retried every tick.
        await query(
          `INSERT INTO message_deliveries (workspace_id, channel, kind, case_id, recipient, status, error, idempotency_key, triggered_by)
           VALUES ($1,$2,'request_reminder',$3,'',  'failed',$4,$5,'automation') ON CONFLICT (idempotency_key) DO NOTHING`,
          [ws.id, r.channel, c.id, res.code, `${prefix}:a${attempt}`],
        )
      }
    }
  }
}

async function deadlineReminders(ws, s, now, stats) {
  const d = s.deadlineReminder
  const due = await query(
    `SELECT c.id, to_char(c.deadline, 'YYYY-MM-DD') AS day FROM cases c
      WHERE c.workspace_id = $1 AND c.status IN ('waiting-for-client','partial-submission','delayed') AND c.reminders_enabled
        AND c.sent_at IS NOT NULL AND c.deadline > $2::timestamptz AND c.deadline <= $2::timestamptz + make_interval(days => $3)
        AND EXISTS (SELECT 1 FROM case_documents x WHERE x.case_id = c.id AND x.is_required AND x.status IN ('missing','pending-upload','rejected','blurry','missing-pages'))
      LIMIT 50`,
    [ws.id, now.toISOString(), d.daysBefore],
  )
  for (const c of due) {
    const prefix = `auto_deadline:${c.id}:${c.day}`
    const attempt = await attemptNumber(prefix)
    if (!attempt) continue
    const res = await sendRequestMessage({
      workspaceId: ws.id, caseId: c.id, kind: 'request_reminder', channel: s.requestReminders.channel, triggeredBy: 'automation', idempotencyKey: `${prefix}:a${attempt}`,
    })
    res.ok ? stats.sent++ : stats.failed++
  }
}

async function signatureReminders(ws, s, now, stats) {
  const r = s.signatureReminders
  const due = await query(
    `SELECT id, reminder_count FROM signature_requests
      WHERE workspace_id = $1 AND deleted_at IS NULL AND status IN ('pending','viewed') AND (expires_at IS NULL OR expires_at > $2::timestamptz)
        AND reminder_count < $3
        AND ( (last_reminder_at IS NULL AND created_at <= $2::timestamptz - make_interval(days => $4))
           OR (last_reminder_at IS NOT NULL AND last_reminder_at <= $2::timestamptz - make_interval(days => $5)) )
      LIMIT 50`,
    [ws.id, now.toISOString(), r.maxReminders, r.firstAfterDays, r.repeatEveryDays],
  )
  for (const sr of due) {
    const prefix = `auto_sig_reminder:${sr.id}:${sr.reminder_count + 1}`
    const attempt = await attemptNumber(prefix)
    if (!attempt) continue
    const res = await sendSignatureMessage({
      workspaceId: ws.id, requestId: sr.id, kind: 'signature_reminder', channel: r.channel, triggeredBy: 'automation', idempotencyKey: `${prefix}:a${attempt}`,
    })
    if (res.ok) {
      stats.sent++
      await withTransaction((tx) => appendEvent(tx, { requestId: sr.id, workspaceId: ws.id, event: 'reminder_sent', actor: 'system', details: { channel: r.channel, automated: true } }))
    } else stats.failed++
  }
}

/** Mark signature requests past their expiry as expired (with an audit event). */
async function expireSignatures(stats) {
  const rows = await query(
    `SELECT id, workspace_id FROM signature_requests WHERE status IN ('pending','viewed') AND expires_at IS NOT NULL AND expires_at < now() AND deleted_at IS NULL LIMIT 200`,
  )
  for (const r of rows) {
    await withTransaction(async (tx) => {
      const u = await tx.queryOne(`UPDATE signature_requests SET status = 'expired' WHERE id = $1 AND status IN ('pending','viewed') RETURNING id`, [r.id])
      if (u) await appendEvent(tx, { requestId: r.id, workspaceId: r.workspace_id, event: 'expired', actor: 'system' })
    })
    publish(r.workspace_id, 'signatures', { id: r.id })
    stats.expired++
  }
}

export async function runAutomationTick(now = new Date()) {
  const client = await pool.connect()
  const stats = { workspaces: 0, sent: 0, failed: 0, expired: 0, skippedQuiet: 0, skippedInactive: 0 }
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_ID])
    if (!rows[0].ok) return { ...stats, locked: true }
    try {
      await expireSignatures(stats)
      const workspaces = await query(`SELECT id, timezone, automation_settings FROM workspaces WHERE automation_settings <> '{}'::jsonb`)
      for (const ws of workspaces) {
        const s = automationSettings(ws)
        if (!s.requestReminders.enabled && !s.deadlineReminder.enabled && !s.signatureReminders.enabled) continue
        if (isQuiet(s, now, ws.timezone)) { stats.skippedQuiet++; continue }
        if (!(await messagingAllowed(ws.id))) { stats.skippedInactive++; continue }
        stats.workspaces++
        try {
          if (s.requestReminders.enabled) await requestReminders(ws, s, now, stats)
          if (s.deadlineReminder.enabled) await deadlineReminders(ws, s, now, stats)
          if (s.signatureReminders.enabled) await signatureReminders(ws, s, now, stats)
        } catch (err) {
          logger.error('automation_workspace_failed', { workspaceId: ws.id, err })
        }
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID])
    }
  } finally {
    client.release()
  }
  if (stats.sent || stats.failed || stats.expired) logger.info('automation_tick', stats)
  return stats
}

let timer = null
export function startScheduler() {
  if (!config.automation.enabled || timer) return
  const tick = () => runAutomationTick().catch((err) => logger.error('automation_tick_failed', { err }))
  setTimeout(tick, 60_000).unref()
  timer = setInterval(tick, config.automation.intervalMs)
  timer.unref()
  logger.info('automation_scheduler_started', { intervalMs: config.automation.intervalMs })
}

export function stopScheduler() {
  if (timer) clearInterval(timer)
  timer = null
}

