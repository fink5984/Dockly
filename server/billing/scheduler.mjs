/**
 * Runs the billing tick (trial expiry and reminders, renewals, retries,
 * grace-period suspension, callback reconciliation) on an interval. Guarded
 * by its own advisory lock, independent of the reminder scheduler so billing
 * keeps running even when automated reminders are switched off.
 */
import { logger } from '../lib/logger.mjs'
import { runBillingTick } from './service.mjs'

let timer = null

export function startBillingScheduler() {
  if (process.env.NODE_ENV === 'test' || process.env.BILLING_SCHEDULER === 'false' || timer) return
  const intervalMs = Number(process.env.BILLING_TICK_INTERVAL_MS || 10 * 60 * 1000)
  const tick = () => runBillingTick().catch((err) => logger.error('billing_tick_failed', { err }))
  setTimeout(tick, 30_000).unref()
  timer = setInterval(tick, intervalMs)
  timer.unref()
  logger.info('billing_scheduler_started', { intervalMs })
}

export function stopBillingScheduler() {
  if (timer) clearInterval(timer)
  timer = null
}
