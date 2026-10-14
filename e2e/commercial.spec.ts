import { test, expect, type Page } from '@playwright/test'

/**
 * The commercial funnel end to end in a real browser:
 * landing → pricing → signup with a plan → onboarding → trial → billing →
 * hosted checkout (sandbox) → verified activation. Plus RTL/mobile checks.
 */

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
}

test.describe('marketing site', () => {
  test('Hebrew home is RTL, accessible-ish and fits a phone', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'he-IL' })
    const page = await ctx.newPage()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(page.locator('html')).toHaveAttribute('lang', 'he')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('בלי לרדוף אחריהם')
    await noHorizontalScroll(page)
    // Exactly one h1, and every image has alt text.
    expect(await page.locator('h1').count()).toBe(1)
    expect(await page.locator('img:not([alt])').count()).toBe(0)
    // Mobile menu works without leaving the page.
    await page.locator('details.mk-menu summary').click()
    await expect(page.locator('details.mk-menu nav')).toBeVisible()
    expect(errors).toEqual([])
    await ctx.close()
  })

  test('pricing toggles switch variants and the CTA carries the plan', async ({ page }) => {
    await page.goto('/en/pricing')
    const suite = page.locator('.mk-pricing li').filter({ hasText: 'Collection + Signatures' })
    await expect(suite.getByText('₪129').filter({ visible: true })).toBeVisible()
    await page.getByRole('radio', { name: 'Pro' }).click()
    await expect(suite.getByText('₪339').filter({ visible: true })).toBeVisible()
    await page.getByRole('radio', { name: 'Yearly' }).click()
    await expect(suite.getByText(/billed yearly/).filter({ visible: true })).toHaveText(/₪3,390 billed yearly/)
    const cta = suite.getByRole('link', { name: 'Start free trial' }).filter({ visible: true })
    await expect(cta).toHaveAttribute('href', /plan=suite_pro&interval=year/)
  })

  test('legal pages exist in both languages', async ({ page }) => {
    for (const p of ['/privacy', '/terms', '/accessibility', '/en/privacy', '/en/terms', '/en/accessibility']) {
      const r = await page.goto(p)
      expect(r?.status(), p).toBe(200)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    }
  })
})

test.describe.serial('trial → paid', () => {
  let page: Page
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage()
    await page.addInitScript(() => { localStorage.setItem('dockly-theme', 'light') })
  })

  test('signs up from a pricing CTA and starts a no-card trial', async () => {
    await page.goto('/en/pricing')
    await page.locator('.mk-pricing li').filter({ hasText: 'Collection + Signatures' }).getByRole('link', { name: 'Start free trial' }).filter({ visible: true }).click()
    await expect(page).toHaveURL(/\/auth\/signup\?lang=en&plan=suite_starter&interval=month/)
    await page.getByLabel('Full name').fill('Paying Customer')
    await page.getByLabel('Work email').fill(`buyer_${Date.now()}@example.test`)
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('correct horse battery')
    await expect(page.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', '/en/terms')
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page).toHaveURL(/\/onboarding/)
    await expect(page.getByText('Your 30-day free trial has started')).toBeVisible()
    await page.getByLabel('Business name').fill('Buyer & Co')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('radio', { name: 'Both' }).click()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: 'Finish setup' }).click()
    await expect(page).toHaveURL('/app')
    await expect(page.getByRole('status').filter({ hasText: /30 days left in your free trial/ })).toBeVisible()
  })

  test('chooses the plan picked on the pricing page and pays on the hosted page', async () => {
    await page.getByRole('link', { name: 'Choose a plan' }).click()
    await expect(page).toHaveURL(/\/app\/billing/)
    await expect(page.getByText('Test mode: payments are simulated')).toBeVisible()
    const suite = page.locator('#plans li').filter({ hasText: 'Collection + Signatures' })
    await suite.getByRole('button', { name: 'Subscribe' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('₪152.22')).toBeVisible() // 129 + 18% VAT
    await expect(dialog.getByText(/trial days are added to your first period/)).toBeVisible()
    await dialog.getByRole('button', { name: 'Continue to secure payment' }).click()
    // Sandbox hosted page (stands in for Cardcom)
    await expect(page).toHaveURL(/\/billing\/sandbox\//)
    await expect(page.getByText('SANDBOX')).toBeVisible()
    await page.getByRole('button', { name: /Pay/ }).click()
    // Return page confirms with the server before claiming success.
    await expect(page).toHaveURL(/\/app\/billing\/return\?session=/)
    await expect(page.getByRole('heading', { name: 'Payment confirmed' })).toBeVisible({ timeout: 20_000 })
    await page.getByRole('link', { name: 'Back to billing' }).click()
    await expect(page.locator('#plans li').filter({ hasText: 'Collection + Signatures' }).getByRole('button', { name: 'Current plan' })).toBeDisabled()
    await expect(page.getByText('•••• 4242')).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Subscription' })).toBeVisible()
  })

  test('upgrades immediately with the card on file (prorated)', async () => {
    await page.goto('/app/billing')
    await page.locator('#plans').getByRole('radio', { name: 'Pro' }).click()
    // An upgrade with a card on file is charged directly (prorated) — no hosted page.
    await page.locator('#plans li').filter({ hasText: 'Collection + Signatures' }).getByRole('button', { name: 'Upgrade' }).click()
    await page.getByRole('dialog').getByRole('button', { name: /Pay .* and upgrade/ }).click()
    await expect(page.getByText('Your plan was updated')).toBeVisible()
    await expect(page.getByText('Pro').first()).toBeVisible()
  })
})
