/**
 * Seeds a demo workspace with realistic, entirely fictional data.
 * Idempotent: skips if the demo account already exists.
 * Only ever run against a local/dev database (scripts/dev-setup.mjs).
 */
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { query, queryOne } from '../server/db/pool.mjs'
import { hashPassword } from '../server/lib/passwords.mjs'
import { randomToken } from '../server/lib/crypto.mjs'
import { storage, keys } from '../server/storage.mjs'

async function samplePdf(title) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const page = pdf.addPage([595.28, 841.89])
  page.drawText(title, { x: 60, y: 760, size: 20, font })
  page.drawText('Sample document generated for the Sadir demo workspace.', { x: 60, y: 730, size: 11, font })
  return Buffer.from(await pdf.save())
}

export async function seedDemo() {
  const url = process.env.DATABASE_URL || ''
  if (!/127\.0\.0\.1|localhost/.test(url)) throw new Error('Refusing to seed a non-local database')
  if (await queryOne(`SELECT 1 FROM profiles WHERE email = 'demo@dockly.local'`)) {
    console.log('• Demo workspace already seeded')
    return
  }
  const ws = await queryOne(
    `INSERT INTO workspaces (name, business_type, contact_person, phone, email, default_language, timezone, brand_color)
     VALUES ('משרד כהן ושות׳', 'accounting', 'נועה כהן', '03-555-0100', 'office@example.test', 'he', 'Asia/Jerusalem', '#5B4DFF') RETURNING id`,
  )
  await query(
    `INSERT INTO profiles (workspace_id, email, name, role, password_hash) VALUES ($1, 'demo@dockly.local', 'נועה כהן', 'owner', $2)`,
    [ws.id, await hashPassword('dockly-demo-123')],
  )
  const types = {}
  for (const [name, formats] of [['תעודת זהות', '{pdf,jpg,png,heic}'], ['טופס 106', '{pdf}'], ['אישור ניהול חשבון', '{pdf,jpg,png}'], ['תלושי שכר', '{pdf,jpg,png}'], ['דפי בנק', '{pdf}']]) {
    types[name] = (await queryOne(
      `INSERT INTO document_types (workspace_id, name, allowed_formats, max_size_mb, status) VALUES ($1,$2,$3,15,'active') RETURNING id`,
      [ws.id, name, formats],
    )).id
  }
  await query(
    `INSERT INTO request_templates (workspace_id, name, default_title, instructions, items) VALUES ($1, 'דוח שנתי', 'מסמכים לדוח השנתי', 'נא להעלות את המסמכים עד סוף החודש.', $2)`,
    [ws.id, JSON.stringify([{ documentTypeId: types['תעודת זהות'], required: true, note: 'שני הצדדים' }, { documentTypeId: types['טופס 106'], required: true, note: '' }])],
  )
  const clients = []
  for (const [name, phone, email] of [['דנה לוי', '050-123-4567', 'dana@example.test'], ['Michael Green', '+44 20 7946 0958', 'michael@example.test'], ['יוסי אברהם', '052-765-4321', '']]) {
    clients.push((await queryOne(`INSERT INTO clients (workspace_id, name, phone, email, assigned_owner) VALUES ($1,$2,$3,$4,'נועה כהן') RETURNING id, name`, [ws.id, name, phone, email])))
  }
  const mkCase = async (client, title, docs, { sentDaysAgo, deadlineDays }) => {
    const c = await queryOne(
      `INSERT INTO cases (workspace_id, client_id, case_type, title, status, public_token, sent_at, deadline, instructions, last_activity_date)
       VALUES ($1,$2,$3,$3,'waiting-for-client',$4, now() - make_interval(days => $5), now() + make_interval(days => $6), 'נא להעלות צילומים ברורים.', now()) RETURNING id`,
      [ws.id, client.id, title, randomToken(32), sentDaysAgo, deadlineDays],
    )
    let i = 0
    for (const [typeName, status] of docs) {
      const d = await queryOne(`INSERT INTO case_documents (case_id, document_type_id, status, sort_order) VALUES ($1,$2,'missing',$3) RETURNING id`, [c.id, types[typeName], i++])
      if (status !== 'missing') {
        const buf = await samplePdf(typeName === 'טופס 106' ? 'Form 106 (sample)' : 'Sample document')
        const key = keys.requestFile(ws.id, c.id, d.id, 'sample.pdf')
        await storage.put(key, buf, 'application/pdf')
        const f = await queryOne(
          `INSERT INTO case_document_files (workspace_id, case_id, case_document_id, storage_key, file_name, mime_type, size_bytes, uploaded_via, review_status)
           VALUES ($1,$2,$3,$4,'sample.pdf','application/pdf',$5,'portal',$6) RETURNING id`,
          [ws.id, c.id, d.id, key, buf.length, status === 'approved' ? 'approved' : 'pending'],
        )
        await query(
          `UPDATE case_documents SET status = $2, file_name = 'sample.pdf', file_type = 'application/pdf', file_size = $3, storage_path = $4, uploaded_at = now() - interval '1 day', current_file_id = $5, version_count = 1 WHERE id = $1`,
          [d.id, status, buf.length, key, f.id],
        )
      }
    }
    const { recomputeRequestStatus } = await import('../server/domain/requests.mjs')
    await recomputeRequestStatus({ query, queryOne }, c.id)
  }
  await mkCase(clients[0], 'מסמכים לדוח השנתי 2025', [['תעודת זהות', 'approved'], ['טופס 106', 'uploaded'], ['אישור ניהול חשבון', 'missing']], { sentDaysAgo: 6, deadlineDays: 10 })
  await mkCase(clients[1], 'Mortgage pre-approval', [['תלושי שכר', 'missing'], ['דפי בנק', 'missing']], { sentDaysAgo: 12, deadlineDays: -2 })
  await mkCase(clients[2], 'פתיחת תיק', [['תעודת זהות', 'uploaded'], ['אישור ניהול חשבון', 'uploaded']], { sentDaysAgo: 2, deadlineDays: 20 })
  console.log('• Seeded demo workspace (login: demo@dockly.local / dockly-demo-123)')
}
