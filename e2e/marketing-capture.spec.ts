/**
 * Captures the product screenshots used on the marketing site from the REAL
 * application (production build, isolated database, fictional data only).
 *
 *   CAPTURE_MARKETING=1 npx playwright test e2e/marketing-capture.spec.ts
 *
 * Writes public/marketing/screens/{he,en}/*.jpg and public/marketing/og-{he,en}.png.
 * Skipped in normal E2E runs.
 */
import { test, expect, type APIRequestContext, type Browser } from '@playwright/test'
import { mkdirSync, readFileSync } from 'fs'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

test.skip(!process.env.CAPTURE_MARKETING, 'Set CAPTURE_MARKETING=1 to regenerate marketing screenshots')
test.setTimeout(240_000)

const OUT = 'public/marketing'
const H = { 'x-requested-with': 'dockly' }
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

async function samplePdf(title: string, lines = 18) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const page = doc.addPage([595.28, 841.89])
  page.drawText(title, { x: 60, y: 770, size: 20, font: bold })
  for (let i = 0; i < lines; i++) page.drawRectangle({ x: 60, y: 720 - i * 22, width: 470 - (i % 4) * 60, height: 7, color: rgb(0.86, 0.88, 0.92) })
  return Buffer.from(await doc.save())
}

type Lang = 'he' | 'en'
const DATA: Record<Lang, {
  owner: string; workspace: string; types: string[]
  clients: [string, string][]
  requests: { client: number; title: string; docs: ('missing' | 'uploaded' | 'approved' | 'rejected')[]; deadlineDays: number; sent: boolean }[]
  rejectReason: string; signTitle: string; signer: string; fieldLabels: [string, string, string]
}> = {
  he: {
    owner: 'נועה כהן', workspace: 'כהן ושות׳ — ראיית חשבון',
    types: ['תעודת זהות', 'טופס 106', 'אישור ניהול חשבון', 'תלושי שכר', 'דפי בנק'],
    clients: [['דנה לוי', '050-1234567'], ['יוסי אברהם', '052-7654321'], ['מיכל ברק', '054-3216549'], ['אבי מזרחי', '053-9876543'], ['רונית שגיא', '058-1112223'], ['עמית גולן', '050-4445556']],
    requests: [
      { client: 0, title: 'מסמכים לדוח השנתי 2025', docs: ['approved', 'uploaded', 'rejected'], deadlineDays: 9, sent: true },
      { client: 1, title: 'פתיחת תיק עוסק מורשה', docs: ['uploaded', 'uploaded', 'missing'], deadlineDays: 14, sent: true },
      { client: 2, title: 'בקשה להחזר מס', docs: ['approved', 'approved', 'approved'], deadlineDays: 5, sent: true },
      { client: 3, title: 'מסמכים למשכנתא', docs: ['missing', 'missing', 'missing', 'missing'], deadlineDays: -2, sent: true },
      { client: 4, title: 'דוח שנתי — שכירה', docs: ['uploaded', 'missing'], deadlineDays: 20, sent: true },
      { client: 5, title: 'עדכון פרטי חשבון בנק', docs: ['missing'], deadlineDays: 30, sent: false },
    ],
    rejectReason: 'חסר העמוד השני — נא להעלות את שני העמודים', signTitle: 'הסכם התקשרות לשירותי הנהלת חשבונות', signer: 'דנה לוי',
    fieldLabels: ['חתימה', 'שם מלא', 'תאריך'],
  },
  en: {
    owner: 'Sarah Cohen', workspace: 'Cohen & Partners CPA',
    types: ['Passport or ID', 'Form 106 (annual salary)', 'Bank account confirmation', 'Payslips (last 3)', 'Bank statements'],
    clients: [['Dana Levi', '050-1234567'], ['Michael Green', '052-7654321'], ['Emily Baron', '054-3216549'], ['David Mizrahi', '053-9876543'], ['Rachel Segal', '058-1112223'], ['Amit Golan', '050-4445556']],
    requests: [
      { client: 0, title: '2025 annual tax return', docs: ['approved', 'uploaded', 'rejected'], deadlineDays: 9, sent: true },
      { client: 1, title: 'New business registration', docs: ['uploaded', 'uploaded', 'missing'], deadlineDays: 14, sent: true },
      { client: 2, title: 'Tax refund claim', docs: ['approved', 'approved', 'approved'], deadlineDays: 5, sent: true },
      { client: 3, title: 'Mortgage application', docs: ['missing', 'missing', 'missing', 'missing'], deadlineDays: -2, sent: true },
      { client: 4, title: 'Annual return — employee', docs: ['uploaded', 'missing'], deadlineDays: 20, sent: true },
      { client: 5, title: 'Bank details update', docs: ['missing'], deadlineDays: 30, sent: false },
    ],
    rejectReason: 'Page 2 is missing — please upload both pages', signTitle: 'Engagement letter — bookkeeping services', signer: 'Dana Levi',
    fieldLabels: ['Signature', 'Full name', 'Date'],
  },
}

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

async function seed(request: APIRequestContext, lang: Lang) {
  const d = DATA[lang]
  const email = `capture_${lang}_${Date.now()}@example.test`
  expect((await request.post('/api/auth/signup', { data: { email, password: 'correct horse battery', name: d.owner, language: lang }, headers: H })).status()).toBe(201)
  await request.patch('/api/workspace', { data: { name: d.workspace, brandColor: '#5B4DFF', defaultLanguage: lang, portalMessage: lang === 'he' ? 'לשאלות אפשר לפנות אלינו בכל עת.' : 'Questions? We’re happy to help.' }, headers: H })
  const types: string[] = []
  for (const name of d.types) types.push((await (await request.post('/api/document-types', { data: { name, allowedFormats: ['pdf', 'jpg', 'png'] }, headers: H })).json()).id)
  const pdf = await samplePdf('Sample document')
  let main: { id: string; publicToken: string; clientId: string } | null = null
  for (const [i, r] of d.requests.entries()) {
    const [name, phone] = d.clients[r.client]
    const created = (await (await request.post('/api/requests', {
      data: { newClient: { name, phone }, title: r.title, deadline: day(r.deadlineDays), instructions: lang === 'he' ? 'נא לצלם את המסמכים באור טוב, כך שכל הפרטים ייראו בבירור.' : 'Please photograph each document in good light so every detail is readable.', items: r.docs.map((_, k) => ({ documentTypeId: types[k % types.length], required: true, note: '' })) },
      headers: H,
    })).json()).request
    if (r.sent) await request.post(`/api/requests/${created.id}/mark-sent`, { headers: H })
    for (const [k, st] of r.docs.entries()) {
      if (st === 'missing') continue
      const doc = created.requiredDocuments[k]
      await request.post(`/api/public/portal/${created.publicToken}/documents/${doc.id}`, { multipart: { file: { name: 'scan.pdf', mimeType: 'application/pdf', buffer: pdf } } })
      if (st === 'approved') await request.post(`/api/requests/${created.id}/documents/${doc.id}/review`, { data: { action: 'approve' }, headers: H })
      if (st === 'rejected') await request.post(`/api/requests/${created.id}/documents/${doc.id}/review`, { data: { action: 'reject', reason: d.rejectReason, notifyClient: false }, headers: H })
    }
    if (i === 0) main = created
  }
  // A signed agreement (with audit trail) and an open one for the signer screenshot.
  const sigDoc = await samplePdf(lang === 'he' ? 'Engagement letter' : 'Engagement letter', 26)
  const mkSig = async (title: string) => {
    const up = await (await request.post('/api/signatures/uploads', { multipart: { file: { name: 'agreement.pdf', mimeType: 'application/pdf', buffer: sigDoc } }, headers: H })).json()
    return (await (await request.post('/api/signatures', {
      data: { clientId: main!.clientId, title, document: up, canvasWidth: 1000, language: lang, fields: [
        { type: 'signature', label: d.fieldLabels[0], page: 1, x: 560, y: 1150, width: 320, height: 90, required: true, docIndex: 0 },
        { type: 'name', label: d.fieldLabels[1], page: 1, x: 80, y: 1170, width: 300, height: 50, required: true, docIndex: 0 },
        { type: 'date', label: d.fieldLabels[2], page: 1, x: 80, y: 1240, width: 200, height: 40, required: true, docIndex: 0 },
      ] },
      headers: H,
    })).json()).request
  }
  const signed = await mkSig(d.signTitle)
  const view = await (await request.get(`/api/public/sign/${signed.publicToken}`)).json()
  const values = view.fields.map((f: { id: string; type: string }) => ({ fieldId: f.id, value: f.type === 'signature' ? TINY_PNG : f.type === 'date' ? day(0) : d.signer }))
  expect((await request.post(`/api/public/sign/${signed.publicToken}/submit`, { data: { signerName: d.signer, consent: true, language: lang, values } })).status()).toBeLessThan(300)
  const open = await mkSig(d.signTitle)
  await request.put('/api/automation', {
    data: {
      requestReminders: { enabled: true, firstAfterDays: 2, repeatEveryDays: 3, maxReminders: 3, channel: 'whatsapp' },
      deadlineReminder: { enabled: true, daysBefore: 2 },
      signatureReminders: { enabled: true, firstAfterDays: 2, repeatEveryDays: 3, maxReminders: 2, channel: 'email' },
      quietHours: { enabled: true, start: '20:00', end: '08:00' }, weekendDays: [5, 6],
    },
    headers: H,
  })
  return { main: main!, signedId: signed.id as string, openToken: open.publicToken as string }
}

async function capture(browser: Browser, request: APIRequestContext, lang: Lang) {
  const s = await seed(request, lang)
  const dir = `${OUT}/screens/${lang}`
  mkdirSync(dir, { recursive: true })
  const jpg = { type: 'jpeg' as const, quality: 82 }

  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light', locale: lang === 'he' ? 'he-IL' : 'en-US', storageState: await request.storageState() })
  const d = await desk.newPage()
  await d.addInitScript((l) => { localStorage.setItem('dockly-language', l); localStorage.setItem('dockly-theme', 'light'); localStorage.setItem('dockly-dashboard-insights', 'open') }, lang)
  const shot = async (path: string, name: string, ready: () => Promise<void>) => {
    await d.goto(path)
    await ready()
    await d.waitForTimeout(700)
    await d.screenshot({ path: `${dir}/${name}.jpg`, ...jpg })
  }
  await shot('/app', 'dashboard', () => expect(d.getByRole('heading', { level: 1 })).toBeVisible())
  await shot(`/app/requests/${s.main.id}`, 'request', () => expect(d.getByRole('heading', { level: 1 })).toBeVisible())
  await shot(`/app/signatures/${s.signedId}`, 'signature', () => expect(d.getByRole('heading', { level: 1 })).toBeVisible())
  await shot('/app/settings/automation', 'automation', () => expect(d.getByRole('heading', { level: 1 })).toBeVisible())
  await desk.close()

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: lang === 'he' ? 'he-IL' : 'en-US' })
  const p = await phone.newPage()
  await p.addInitScript((l) => sessionStorage.setItem('dockly-public-lang', l), lang)
  await p.goto(`/p/${s.main.publicToken}`)
  await expect(p.getByText(DATA[lang].clients[0][0].split(' ')[0]).first()).toBeVisible()
  await p.waitForTimeout(600)
  await p.screenshot({ path: `${dir}/portal.jpg`, ...jpg })
  await p.goto(`/sign/${s.openToken}`)
  await expect(p.getByText(DATA[lang].signTitle).first()).toBeVisible()
  await p.waitForTimeout(1500)
  await p.screenshot({ path: `${dir}/sign.jpg`, ...jpg })
  await phone.close()
}

async function ogImage(browser: Browser, lang: Lang) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 630 } })
  const page = await ctx.newPage()
  const logo = readFileSync('public/brand/sadir-logo-light.svg', 'utf8')
  const shot = readFileSync(`${OUT}/screens/${lang}/dashboard.jpg`).toString('base64')
  const title = lang === 'he' ? 'כל המסמכים והחתימות מהלקוחות.<br><span>בלי לרדוף אחריהם.</span>' : 'Every client document and signature.<br><span>Without the chasing.</span>'
  const sub = lang === 'he' ? 'איסוף מסמכים וחתימות דיגיטליות · 30 יום חינם' : 'Document collection + e-signatures · 30 days free'
  // Text on the reading-start side, screenshot bleeding off the other edge.
  const textSide = lang === 'he' ? 'right' : 'left'
  const imgSide = lang === 'he' ? 'left' : 'right'
  await page.setContent(`<!doctype html><html lang="${lang}" dir="${lang === 'he' ? 'rtl' : 'ltr'}"><body style="margin:0"><div style="width:1200px;height:630px;overflow:hidden;font-family:Heebo,Segoe UI,Arial,sans-serif;background:linear-gradient(135deg,#141364 0%,#2a22a8 55%,#5b4dff 100%);color:#fff;position:relative">
    <div style="position:absolute;${textSide}:64px;top:64px;width:540px">
      <div style="height:52px;display:flex">${logo.replace('<svg', '<svg height="52"')}</div>
      <h1 style="font-size:46px;line-height:1.2;margin:44px 0 0;font-weight:700">${title.replace('<span>', '<span style="color:#cac3ff">')}</h1>
      <p style="font-size:24px;margin-top:28px;color:#e7e3ff">${sub}</p>
    </div>
    <img src="data:image/jpeg;base64,${shot}" style="position:absolute;top:150px;${imgSide}:-120px;width:640px;border-radius:14px;box-shadow:0 30px 60px rgba(0,0,0,.35)">
  </div></body></html>`)
  await page.waitForTimeout(300)
  await page.locator('body > div').screenshot({ path: `${OUT}/og-${lang}.png` })
  await ctx.close()
}

test('capture marketing screenshots', async ({ browser, playwright, baseURL }) => {
  for (const lang of ['he', 'en'] as const) {
    const request = await playwright.request.newContext({ baseURL })
    await capture(browser, request, lang)
    await ogImage(browser, lang)
    await request.dispose()
  }
})
