/**
 * Dockly server entry point.
 *   - serves the built SPA
 *   - the authenticated JSON API (/api/*)
 *   - public token endpoints for client portal & signing (/api/public/*)
 *   - WhatsApp Cloud API webhook
 *   - the automation scheduler
 */
import { config, configWarnings } from './config.mjs'
import { createApp } from './app.mjs'
import { closePool } from './db/pool.mjs'
import { logger } from './lib/logger.mjs'
import { startScheduler, stopScheduler } from './automation/scheduler.mjs'

for (const w of configWarnings()) logger.warn('config_warning', { warning: w })

const app = createApp()
const server = app.listen(config.port, '0.0.0.0', () => {
  logger.info('server_started', { port: config.port, storage: config.storage.driver, whatsapp: config.whatsapp.mode })
})
startScheduler()

async function shutdown(signal) {
  logger.info('shutdown', { signal })
  stopScheduler()
  server.close()
  await closePool().catch(() => {})
  process.exit(0)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
