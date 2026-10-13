/**
 * Reusable configuration: document types, presets (legacy) and request templates.
 */
import { Router } from 'express'
import { z } from 'zod'
import { query, queryOne } from '../db/pool.mjs'
import { parse, notFound, conflict, requireUuid } from '../lib/http.mjs'
import { requireAuth, requireWrite, requireRole } from '../middleware/auth.mjs'
import { publish } from '../lib/events.mjs'
import { assertDocumentTypes } from '../domain/requests.mjs'

const router = Router()
router.use(requireAuth)

// ── Document types ─────────────────────────────────────────
export function serializeDocumentType(d) {
  return {
    id: d.id, workspaceId: d.workspace_id, name: d.name, category: d.category, description: d.description,
    helperText: d.helper_text, defaultRequired: d.default_required, isRequired: d.is_required,
    allowedFormats: d.allowed_formats, maxSizeMB: d.max_size_mb, status: d.status,
    applicableCaseTypes: d.applicable_case_types, sortOrder: d.sort_order, createdAt: d.created_at, updatedAt: d.updated_at,
    usageCount: d.usage_count ?? undefined,
  }
}

const FORMATS = ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic', 'gif', 'tiff', 'doc', 'docx', 'xls', 'xlsx']
const docTypeBody = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().max(40).optional(),
  description: z.string().max(1000).optional(),
  helperText: z.string().max(1000).optional(),
  defaultRequired: z.boolean().optional(),
  isRequired: z.boolean().optional(),
  allowedFormats: z.array(z.enum(FORMATS)).min(1).max(12).optional(),
  maxSizeMB: z.number().int().min(1).max(25).optional(),
  status: z.enum(['active', 'archived']).optional(),
  applicableCaseTypes: z.array(z.string().max(80)).max(50).optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
})

router.get('/document-types', async (req, res) => {
  const rows = await query(
    `SELECT d.*, (SELECT count(*)::int FROM case_documents cd WHERE cd.document_type_id = d.id) AS usage_count
       FROM document_types d WHERE d.workspace_id = $1 ORDER BY d.sort_order, d.name`,
    [req.user.workspaceId],
  )
  res.json(rows.map(serializeDocumentType))
})

router.post('/document-types', requireWrite, async (req, res) => {
  const b = parse(docTypeBody, req.body)
  const d = await queryOne(
    `INSERT INTO document_types (workspace_id, name, category, description, helper_text, default_required, is_required, allowed_formats, max_size_mb, applicable_case_types, status, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',COALESCE($11,(SELECT COALESCE(max(sort_order),0)+1 FROM document_types WHERE workspace_id = $1))) RETURNING *`,
    [req.user.workspaceId, b.name, b.category ?? 'general', b.description ?? '', b.helperText ?? '', b.defaultRequired ?? false,
      b.isRequired ?? false, b.allowedFormats ?? ['pdf', 'jpg', 'png'], b.maxSizeMB ?? 10, b.applicableCaseTypes ?? [], b.sortOrder ?? null],
  )
  publish(req.user.workspaceId, 'document-types')
  res.status(201).json(serializeDocumentType(d))
})

router.patch('/document-types/:id', requireWrite, async (req, res) => {
  const b = parse(docTypeBody.partial(), req.body)
  const map = {
    name: 'name', category: 'category', description: 'description', helperText: 'helper_text', defaultRequired: 'default_required',
    isRequired: 'is_required', allowedFormats: 'allowed_formats', maxSizeMB: 'max_size_mb', status: 'status',
    applicableCaseTypes: 'applicable_case_types', sortOrder: 'sort_order',
  }
  const sets = []
  const vals = [requireUuid(req.params.id), req.user.workspaceId]
  for (const [k, col] of Object.entries(map)) if (b[k] !== undefined) { vals.push(b[k]); sets.push(`${col} = $${vals.length}`) }
  const d = sets.length
    ? await queryOne(`UPDATE document_types SET ${sets.join(', ')} WHERE id = $1 AND workspace_id = $2 RETURNING *`, vals)
    : await queryOne('SELECT * FROM document_types WHERE id = $1 AND workspace_id = $2', vals)
  if (!d) throw notFound()
  publish(req.user.workspaceId, 'document-types')
  res.json(serializeDocumentType(d))
})

router.delete('/document-types/:id', requireRole('admin'), async (req, res) => {
  const id = requireUuid(req.params.id)
  const used = await queryOne(
    `SELECT count(*)::int AS n FROM case_documents cd JOIN document_types d ON d.id = cd.document_type_id WHERE d.id = $1 AND d.workspace_id = $2`,
    [id, req.user.workspaceId],
  )
  if (used.n > 0) {
    // In use by existing requests: archive instead of breaking them.
    await query(`UPDATE document_types SET status = 'archived' WHERE id = $1 AND workspace_id = $2`, [id, req.user.workspaceId])
    publish(req.user.workspaceId, 'document-types')
    return res.json({ ok: true, archived: true })
  }
  const r = await queryOne('DELETE FROM document_types WHERE id = $1 AND workspace_id = $2 RETURNING id', [id, req.user.workspaceId])
  if (!r) throw notFound()
  publish(req.user.workspaceId, 'document-types')
  res.json({ ok: true, archived: false })
})

// ── Document presets (legacy, read-only compatibility) ─────
router.get('/document-presets', async (req, res) => {
  const rows = await query('SELECT * FROM document_presets WHERE workspace_id = $1 ORDER BY created_at DESC', [req.user.workspaceId])
  res.json(rows.map((p) => ({
    id: p.id, workspaceId: p.workspace_id, name: p.name, caseType: p.case_type, documentTypeIds: p.document_type_ids, description: p.description, createdAt: p.created_at,
  })))
})

// ── Request templates ─────────────────────────────────────
export function serializeTemplate(t) {
  return {
    id: t.id, name: t.name, description: t.description, defaultTitle: t.default_title, instructions: t.instructions,
    dueInDays: t.due_in_days ?? undefined, items: t.items || [], createdAt: t.created_at, updatedAt: t.updated_at,
  }
}

const templateItem = z.object({ documentTypeId: z.string().uuid(), required: z.boolean().default(true), note: z.string().max(500).optional().default('') })
const templateBody = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(1000).optional().default(''),
  defaultTitle: z.string().max(160).optional().default(''),
  instructions: z.string().max(4000).optional().default(''),
  dueInDays: z.number().int().min(1).max(365).nullable().optional(),
  items: z.array(templateItem).max(60),
})

router.get('/request-templates', async (req, res) => {
  const rows = await query('SELECT * FROM request_templates WHERE workspace_id = $1 ORDER BY name', [req.user.workspaceId])
  res.json(rows.map(serializeTemplate))
})

router.post('/request-templates', requireWrite, async (req, res) => {
  const b = parse(templateBody, req.body)
  await assertDocumentTypes(req.user.workspaceId, b.items.map((i) => i.documentTypeId))
  const t = await queryOne(
    `INSERT INTO request_templates (workspace_id, name, description, default_title, instructions, due_in_days, items, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.user.workspaceId, b.name, b.description, b.defaultTitle, b.instructions, b.dueInDays ?? null, JSON.stringify(b.items), req.user.id],
  )
  publish(req.user.workspaceId, 'templates')
  res.status(201).json(serializeTemplate(t))
})

router.put('/request-templates/:id', requireWrite, async (req, res) => {
  const b = parse(templateBody, req.body)
  await assertDocumentTypes(req.user.workspaceId, b.items.map((i) => i.documentTypeId))
  const t = await queryOne(
    `UPDATE request_templates SET name = $3, description = $4, default_title = $5, instructions = $6, due_in_days = $7, items = $8
      WHERE id = $1 AND workspace_id = $2 RETURNING *`,
    [requireUuid(req.params.id), req.user.workspaceId, b.name, b.description, b.defaultTitle, b.instructions, b.dueInDays ?? null, JSON.stringify(b.items)],
  )
  if (!t) throw notFound()
  publish(req.user.workspaceId, 'templates')
  res.json(serializeTemplate(t))
})

router.post('/request-templates/:id/duplicate', requireWrite, async (req, res) => {
  const t = await queryOne(
    `INSERT INTO request_templates (workspace_id, name, description, default_title, instructions, due_in_days, items, created_by)
     SELECT workspace_id, name || ' (copy)', description, default_title, instructions, due_in_days, items, $3
       FROM request_templates WHERE id = $1 AND workspace_id = $2 RETURNING *`,
    [requireUuid(req.params.id), req.user.workspaceId, req.user.id],
  )
  if (!t) throw notFound()
  publish(req.user.workspaceId, 'templates')
  res.status(201).json(serializeTemplate(t))
})

router.delete('/request-templates/:id', requireWrite, async (req, res) => {
  const r = await queryOne('DELETE FROM request_templates WHERE id = $1 AND workspace_id = $2 RETURNING id', [requireUuid(req.params.id), req.user.workspaceId])
  if (!r) throw notFound()
  publish(req.user.workspaceId, 'templates')
  res.json({ ok: true })
})

/** Starter templates a workspace can install (names/items resolved against its document types). */
export const STARTER_TEMPLATES = [
  { key: 'accounting', en: 'New accounting client', he: 'לקוח הנהלת חשבונות חדש', docs: [['ID card', 'תעודת זהות'], ['Bank account confirmation', 'אישור ניהול חשבון'], ['Business registration', 'תעודת עוסק'], ['Previous year financial statements', 'דוחות כספיים לשנה קודמת']] },
  { key: 'tax', en: 'Annual tax documents', he: 'מסמכים לדוח שנתי', docs: [['Form 106', 'טופס 106'], ['Form 867', 'טופס 867'], ['Pension and insurance statements', 'אישורי הפקדה לפנסיה וביטוח'], ['Donation receipts', 'קבלות על תרומות']] },
  { key: 'mortgage', en: 'Mortgage application', he: 'בקשה למשכנתא', docs: [['ID card', 'תעודת זהות'], ['Last 3 payslips', '3 תלושי שכר אחרונים'], ['Bank statements (3 months)', 'דפי בנק ל-3 חודשים'], ['Purchase agreement', 'חוזה רכישה'], ['Property appraisal', 'שומת נכס']] },
  { key: 'legal', en: 'Legal client onboarding', he: 'קליטת לקוח משפטי', docs: [['ID card', 'תעודת זהות'], ['Power of attorney', 'ייפוי כוח'], ['Fee agreement', 'הסכם שכר טרחה'], ['Relevant correspondence', 'התכתבויות רלוונטיות']] },
  { key: 'insurance', en: 'Insurance application', he: 'בקשה לביטוח', docs: [['ID card', 'תעודת זהות'], ['Driving license', 'רישיון נהיגה'], ['Claims history', 'היסטוריית תביעות'], ['Vehicle license', 'רישיון רכב']] },
  { key: 'employee', en: 'Employee onboarding', he: 'קליטת עובד', docs: [['ID card', 'תעודת זהות'], ['Form 101', 'טופס 101'], ['Bank account confirmation', 'אישור ניהול חשבון'], ['Signed employment agreement', 'הסכם עבודה חתום']] },
]

router.get('/request-templates/starters', (_req, res) => {
  res.json(STARTER_TEMPLATES.map((s) => ({ key: s.key, en: s.en, he: s.he, docs: s.docs })))
})

/** Install a starter template: creates any missing document types, then the template. */
router.post('/request-templates/starters/:key', requireWrite, async (req, res) => {
  const s = STARTER_TEMPLATES.find((x) => x.key === req.params.key)
  if (!s) throw notFound()
  const lang = req.body?.language === 'he' ? 'he' : 'en'
  const name = lang === 'he' ? s.he : s.en
  if (await queryOne('SELECT 1 FROM request_templates WHERE workspace_id = $1 AND name = $2', [req.user.workspaceId, name])) {
    throw conflict('template_exists', 'This template is already installed')
  }
  const items = []
  for (const [en, he] of s.docs) {
    const dn = lang === 'he' ? he : en
    let dt = await queryOne('SELECT id FROM document_types WHERE workspace_id = $1 AND lower(name) = lower($2) LIMIT 1', [req.user.workspaceId, dn])
    if (!dt) {
      dt = await queryOne(
        `INSERT INTO document_types (workspace_id, name, category, allowed_formats, max_size_mb, status)
         VALUES ($1,$2,'general','{pdf,jpg,png,heic}',15,'active') RETURNING id`,
        [req.user.workspaceId, dn],
      )
    }
    items.push({ documentTypeId: dt.id, required: true, note: '' })
  }
  const t = await queryOne(
    `INSERT INTO request_templates (workspace_id, name, description, default_title, instructions, items, created_by)
     VALUES ($1,$2,'',$2,'',$3,$4) RETURNING *`,
    [req.user.workspaceId, name, JSON.stringify(items), req.user.id],
  )
  publish(req.user.workspaceId, 'templates')
  publish(req.user.workspaceId, 'document-types')
  res.status(201).json(serializeTemplate(t))
})

export default router
