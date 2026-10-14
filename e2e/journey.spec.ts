import { test, expect, type Page, type Browser } from '@playwright/test'
import { PDFDocument, StandardFonts } from 'pdf-lib'

/** Fictional test fixture — never real client documents. */
async function pdf(title: string) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  doc.addPage([595.28, 841.89]).drawText(title, { x: 60, y: 760, size: 18, font })
  return Buffer.from(await doc.save())
}

async function english(page: Page) {
  await page.addInitScript(() => { localStorage.setItem('dockly-language', 'en'); localStorage.setItem('dockly-theme', 'light') })
}

async function anonPage(browser: Browser, lang: 'en' | 'he' = 'en') {
  const ctx = await browser.newContext({ locale: lang === 'he' ? 'he-IL' : 'en-US' })
  const p = await ctx.newPage()
  await p.addInitScript((l) => sessionStorage.setItem('dockly-public-lang', l), lang)
  return p
}

test.describe.serial('business ↔ client journey', () => {
  let page: Page
  let portalLink = ''
  const email = `owner_${Date.now()}@example.test`

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage()
    await english(page)
  })

  test('business signs up and completes onboarding', async () => {
    await page.goto('/auth/signup')
    await page.getByLabel('Full name').fill('Noa Tester')
    await page.getByLabel('Work email').fill(email)
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('correct horse battery')
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page).toHaveURL(/\/onboarding/)
    await page.getByLabel('Business name').fill('Tester & Co')
    await page.getByRole('button', { name: 'Continue' }).click()
    // What the workspace needs (defaults to both products)
    await expect(page.getByRole('radio', { name: 'Both' })).toHaveAttribute('aria-checked', 'true')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: 'Finish setup' }).click()
    await expect(page).toHaveURL('/app')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Noa')
  })

  test('business creates a request with a new client', async () => {
    // Old dashboard URL (pre-/app) still lands on the right screen.
    await page.goto('/requests/new')
    await expect(page).toHaveURL('/app/requests/new')
    await page.getByRole('button', { name: 'New client' }).first().click()
    await page.getByLabel('Full name').fill('Dana Client')
    await page.getByLabel('Mobile phone').fill('050-123-4567')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByLabel('Request title').fill('Annual tax pack')
    const boxes = page.locator('ul input[type=checkbox]')
    await expect(boxes.first()).toBeVisible()
    await boxes.nth(0).check()
    await boxes.nth(1).check()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByLabel('Instructions for the client').fill('Please upload clear scans.')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByText('I’ll share the link').click()
    await page.getByRole('button', { name: 'Create request' }).click()
    await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Annual tax pack' })).toBeVisible()
    portalLink = (await page.locator('span.font-mono', { hasText: '/p/' }).first().textContent())!.trim()
    expect(portalLink).toMatch(/\/p\/[A-Za-z0-9_-]{40,}$/)
  })

  test('client uploads in the portal; business rejects with a reason; client replaces; business approves', async ({ browser }) => {
    const client = await anonPage(browser)
    await client.goto(new URL(portalLink).pathname)
    await expect(client.getByRole('heading', { name: /Hi Dana/ })).toBeVisible()
    await expect(client.getByText('Please upload clear scans.')).toBeVisible()
    const firstCard = client.locator('li').filter({ has: client.getByRole('button', { name: 'Upload' }) }).first()
    await firstCard.locator('input[type=file]').first().setInputFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: await pdf('Scan 1') })
    await expect(client.getByText('Received', { exact: true }).first()).toBeVisible()

    await page.reload()
    await page.getByRole('button', { name: 'Reject' }).first().click()
    await page.getByRole('button', { name: /blurry/ }).click()
    await page.getByRole('button', { name: 'Request replacement' }).click()
    await expect(page.getByText('Needs replacement').first()).toBeVisible()

    await client.reload()
    await expect(client.getByText('Please upload a new file').first()).toBeVisible()
    await expect(client.getByText(/image is blurry/)).toBeVisible()
    const rejected = client.locator('li').filter({ hasText: 'Please upload a new file' }).first()
    await rejected.locator('input[type=file]').first().setInputFiles({ name: 'scan-sharp.pdf', mimeType: 'application/pdf', buffer: await pdf('Scan 2') })
    await expect(client.getByText('Please upload a new file')).toHaveCount(0)
    await expect(client.getByText('Received', { exact: true })).toHaveCount(1)

    await page.reload()
    await page.getByRole('button', { name: 'Approve' }).first().click()
    await expect(page.getByText('Approved').first()).toBeVisible()
    await expect(page.getByText(/2 versions/)).toBeVisible()
    await client.close()
  })

  test('business requests a signature; client signs; business downloads the signed PDF and certificate', async ({ browser }) => {
    await page.goto('/signatures/new')
    await page.getByLabel('Signer (client)').selectOption({ label: 'Dana Client' })
    await page.getByLabel('Document title').fill('Engagement letter')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.locator('input[type=file]').first().setInputFiles({ name: 'engagement.pdf', mimeType: 'application/pdf', buffer: await pdf('Engagement letter') })
    await expect(page.getByText('1 page')).toBeVisible()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: 'Signature', exact: true }).click()
    const pageEl = page.locator('[dir=ltr] .absolute.inset-0').first()
    await expect(pageEl).toBeVisible()
    await pageEl.click({ position: { x: 300, y: 500 } })
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: 'Create request' }).click()
    await expect(page).toHaveURL(/\/signatures\/[0-9a-f-]{36}$/)
    const signLink = (await page.locator('span.font-mono', { hasText: '/sign/' }).first().textContent())!.trim()

    const signer = await anonPage(browser)
    await signer.goto(new URL(signLink).pathname)
    await expect(signer.getByRole('heading', { name: 'Engagement letter' })).toBeVisible()
    await signer.getByRole('button', { name: /Signature \(Required\)/ }).click()
    const pad = signer.locator('canvas[role=img]')
    const box = (await pad.boundingBox())!
    await signer.mouse.move(box.x + 40, box.y + 80)
    await signer.mouse.down()
    for (let i = 0; i < 10; i++) await signer.mouse.move(box.x + 60 + i * 25, box.y + 70 + (i % 2) * 30)
    await signer.mouse.up()
    await signer.getByRole('button', { name: 'Apply' }).click()
    await signer.getByRole('button', { name: 'Finish & sign' }).click()
    await signer.getByLabel(/I agree to sign this document electronically/).check()
    await signer.getByRole('button', { name: 'Sign document' }).click()
    await expect(signer.getByRole('heading', { name: 'Signed — thank you!' })).toBeVisible()
    await signer.close()

    await page.reload()
    await expect(page.getByText('Signed').first()).toBeVisible()
    await expect(page.getByText('Verified intact')).toBeVisible()
    const id = page.url().split('/').pop()
    const cert = await page.request.get(`/api/signatures/${id}/certificate?lang=en`)
    expect(cert.status()).toBe(200)
    expect(cert.headers()['content-type']).toContain('application/pdf')
    const file = await page.request.get(`/api/signatures/${id}/file?variant=signed`)
    expect(file.status()).toBe(200)
  })

  test('activity reflects what happened', async () => {
    await page.goto('/activity')
    await expect(page.getByText(/uploaded/).first()).toBeVisible()
    await expect(page.getByText(/asked for a replacement/).first()).toBeVisible()
    await expect(page.getByText(/signed a document/).first()).toBeVisible()
  })
})

test('invalid and unauthorized access', async ({ browser, request }) => {
  const p = await anonPage(browser)
  await p.goto('/p/this-token-does-not-exist-at-all-123456')
  await expect(p.getByRole('heading', { name: 'This link isn’t valid' })).toBeVisible()
  await p.goto('/sign/this-token-does-not-exist-at-all-123456')
  await expect(p.getByRole('heading', { name: 'This signing link isn’t valid' })).toBeVisible()
  await p.goto('/requests')
  await expect(p).toHaveURL(/\/auth\/signin/)
  expect((await request.get('/api/clients')).status()).toBe(401)
  await p.close()
})

test('Hebrew RTL and mobile layout', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'he-IL', isMobile: true, hasTouch: true })
  const p = await ctx.newPage()
  await p.addInitScript(() => localStorage.setItem('dockly-language', 'he'))
  await p.goto('/auth/signin')
  await expect(p.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(p.getByRole('heading', { name: 'שמחים לראות אותך שוב' })).toBeVisible()
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  await ctx.close()
})
