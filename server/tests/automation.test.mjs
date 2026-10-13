import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startApp, stopApp, newOwner, documentTypeId, skipIntegration } from './helpers.mjs'

describe.skipIf(skipIntegration())('automated reminders', () => {
  let base, owner, request
  const settings = {
    requestReminders: { enabled: true, firstAfterDays: 2, repeatEveryDays: 3, maxReminders: 2, channel: 'whatsapp' },
    deadlineReminder: { enabled: false, daysBefore: 2 },
    signatureReminders: { enabled: false, firstAfterDays: 2, repeatEveryDays: 3, maxReminders: 2, channel: 'email' },
    quietHours: { enabled: false, start: '20:00', end: '08:00' },
    weekendDays: [],
  }
  beforeAll(async () => {
    base = await startApp()
    owner = await newOwner(base)
    const dt = await documentTypeId(owner, 'Statement')
    request = (await owner.post('/api/requests', { newClient: { name: 'Rina', phone: '0547778899' }, title: 'Annual', items: [{ documentTypeId: dt }] })).data.request
  })
  afterAll(stopApp)

  it('only admins can change automation settings', async () => {
    const r = await owner.put('/api/automation', settings)
    expect(r.status).toBe(200)
    expect(r.data.settings.requestReminders.enabled).toBe(true)
  })

  it('sends a due reminder exactly once, then respects the repeat interval and maximum', async () => {
    const { query, queryOne } = await import('../db/pool.mjs')
    const { runAutomationTick } = await import('../automation/scheduler.mjs')
    await query(`UPDATE cases SET status = 'waiting-for-client', sent_at = now() - interval '3 days' WHERE id = $1`, [request.id])

    const s1 = await runAutomationTick()
    expect(s1.sent).toBe(1)
    const s2 = await runAutomationTick()
    expect(s2.sent).toBe(0) // idempotent: nothing due yet

    let c = await queryOne('SELECT reminder_count FROM cases WHERE id = $1', [request.id])
    expect(c.reminder_count).toBe(1)

    // Simulate time passing beyond the repeat interval.
    await query(`UPDATE cases SET last_reminder_at = now() - interval '4 days' WHERE id = $1`, [request.id])
    expect((await runAutomationTick()).sent).toBe(1)
    await query(`UPDATE cases SET last_reminder_at = now() - interval '4 days' WHERE id = $1`, [request.id])
    expect((await runAutomationTick()).sent).toBe(0) // max 2 reached
    c = await queryOne('SELECT reminder_count FROM cases WHERE id = $1', [request.id])
    expect(c.reminder_count).toBe(2)
    const n = await queryOne(`SELECT count(*)::int AS n FROM message_deliveries WHERE case_id = $1 AND triggered_by = 'automation'`, [request.id])
    expect(n.n).toBe(2)
  })

  it('does not remind when the client has nothing left to send', async () => {
    const { query } = await import('../db/pool.mjs')
    const { runAutomationTick } = await import('../automation/scheduler.mjs')
    const dt = await documentTypeId(owner, 'Done doc')
    const r = (await owner.post('/api/requests', { newClient: { name: 'Done', phone: '0541234567' }, title: 'Done', items: [{ documentTypeId: dt }] })).data.request
    await query(`UPDATE case_documents SET status = 'approved' WHERE case_id = $1`, [r.id])
    await query(`UPDATE cases SET status = 'waiting-for-client', sent_at = now() - interval '10 days' WHERE id = $1`, [r.id])
    await runAutomationTick()
    const { queryOne } = await import('../db/pool.mjs')
    expect((await queryOne('SELECT reminder_count FROM cases WHERE id = $1', [r.id])).reminder_count).toBe(0)
  })

  it('does not retry permanent failures every tick', async () => {
    const { query, queryOne } = await import('../db/pool.mjs')
    const { runAutomationTick } = await import('../automation/scheduler.mjs')
    const dt = await documentTypeId(owner, 'No phone doc')
    const r = (await owner.post('/api/requests', { newClient: { name: 'No phone' }, title: 'NP', items: [{ documentTypeId: dt }] })).data.request
    await query(`UPDATE cases SET status = 'waiting-for-client', sent_at = now() - interval '10 days' WHERE id = $1`, [r.id])
    await runAutomationTick()
    await runAutomationTick()
    await runAutomationTick()
    const n = await queryOne(`SELECT count(*)::int AS n FROM message_deliveries WHERE case_id = $1`, [r.id])
    expect(n.n).toBe(1)
  })
})
