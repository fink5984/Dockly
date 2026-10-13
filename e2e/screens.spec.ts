/**
 * Captures reference screenshots (test-results/screens) for visual review:
 * client portal and signing page on a phone in Hebrew, and the app in dark mode.
 */
import { test, expect } from '@playwright/test'
import { PDFDocument, StandardFonts } from 'pdf-lib'

async function pdf() {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  doc.addPage([595.28, 841.89]).drawText('Sample agreement', { x: 60, y: 760, size: 18, font })
  return Buffer.from(await doc.save())
}

const OUT = 'test-results/screens'

test('reference screens', async ({ browser, request }) => {
  // Seed through the API as a business user.
  const email = `screens_${Date.now()}@example.test`
  const h = { 'x-requested-with': 'dockly' }
  await request.post('/api/auth/signup', { data: { email, password: 'correct horse battery', name: 'נועה כהן', language: 'he' }, headers: h })
  await request.patch('/api/workspace', { data: { name: 'משרד כהן', brandColor: '#0E7490', portalMessage: 'לשאלות ניתן לפנות אלינו בכל עת.' }, headers: h })
  const types = []
  for (const name of ['תעודת זהות', 'טופס 106', 'אישור ניהול חשבון']) types.push((await (await request.post('/api/document-types', { data: { name, allowedFormats: ['pdf', 'jpg', 'png'] }, headers: h })).json()).id)
  const created = await (await request.post('/api/requests', {
    data: { newClient: { name: 'דנה לוי', phone: '050-1234567' }, title: 'מסמכים לדוח השנתי', instructions: 'נא להעלות צילומים ברורים של כל המסמכים.', deadline: '2099-12-31', items: types.map((id) => ({ documentTypeId: id, required: true, note: '' })) },
    headers: h,
  })).json()
  const r = created.request
  // one uploaded + one rejected
  const up = await request.post(`/api/public/portal/${r.publicToken}/documents/${r.requiredDocuments[0].id}`, { multipart: { file: { name: 'id.pdf', mimeType: 'application/pdf', buffer: await pdf() } } })
  expect(up.status()).toBe(201)
  const up2 = await request.post(`/api/public/portal/${r.publicToken}/documents/${r.requiredDocuments[1].id}`, { multipart: { file: { name: '106.pdf', mimeType: 'application/pdf', buffer: await pdf() } } })
  expect(up2.status()).toBe(201)
  await request.post(`/api/requests/${r.id}/documents/${r.requiredDocuments[1].id}/review`, { data: { action: 'reject', reason: 'חסר העמוד השני', notifyClient: false }, headers: h })

  const sigUp = await (await request.post('/api/signatures/uploads', { multipart: { file: { name: 'agreement.pdf', mimeType: 'application/pdf', buffer: await pdf() } }, headers: h })).json()
  const sig = (await (await request.post('/api/signatures', {
    data: { clientId: r.clientId, title: 'הסכם התקשרות', document: sigUp, canvasWidth: 1000, language: 'he', fields: [
      { type: 'name', label: 'שם מלא', page: 1, x: 80, y: 1100, width: 300, height: 50, required: true, docIndex: 0 },
      { type: 'signature', label: 'חתימה', page: 1, x: 560, y: 1080, width: 320, height: 90, required: true, docIndex: 0 },
    ] },
    headers: h,
  })).json()).request

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'he-IL' })
  const p = await phone.newPage()
  await p.goto(`/p/${r.publicToken}`)
  await expect(p.getByText('דנה')).toBeVisible()
  await p.screenshot({ path: `${OUT}/portal-mobile-he.png`, fullPage: true })
  await p.goto(`/sign/${sig.publicToken}`)
  await expect(p.getByText('הסכם התקשרות').first()).toBeVisible()
  await p.waitForTimeout(1200)
  await p.screenshot({ path: `${OUT}/sign-mobile-he.png`, fullPage: false })
  await phone.close()

  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', storageState: await request.storageState() })
  const d = await desk.newPage()
  await d.addInitScript(() => { localStorage.setItem('dockly-language', 'he'); localStorage.setItem('dockly-theme', 'dark') })
  await d.goto(`/requests/${r.id}`)
  await expect(d.getByRole('heading', { level: 1 })).toBeVisible()
  await d.screenshot({ path: `${OUT}/request-dark-he.png`, fullPage: true })
  await d.goto('/settings/branding')
  await d.waitForTimeout(500)
  await d.screenshot({ path: `${OUT}/branding-dark-he.png` })
  await desk.close()
})
