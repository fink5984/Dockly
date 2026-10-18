import { test, expect, type Page } from '@playwright/test'

// Passkeys need a domain (not 127.0.0.1); the e2e server accepts localhost too.
const PORT = process.env.E2E_PORT || '3199'
const BASE = `http://localhost:${PORT}`
// A second address the app is served from (stands in for the old Railway link).
const OTHER = `http://old.localhost:${PORT}`
const PASSWORD = 'correct horse battery'

/** Chrome's virtual authenticator stands in for the fingerprint sensor. */
async function fingerprintDevice(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  })
}

async function signUp(page: Page, email: string, base = BASE) {
  await page.goto(`${base}/auth/signup`)
  await page.getByLabel('Full name').fill('Passkey Tester')
  await page.getByLabel('Work email').fill(email)
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/onboarding/)
  await page.getByLabel('Business name').fill('Passkey Office')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Finish setup' }).click()
  await expect(page).toHaveURL(/\/app/)
}

async function signOutViaApi(page: Page) {
  await page.evaluate(() => fetch('/api/auth/signout', { method: 'POST', headers: { 'X-Requested-With': 'dockly' } }))
}

async function passwordSignIn(page: Page, email: string, base = BASE) {
  await page.goto(`${base}/auth/signin`)
  await page.getByLabel('Work email').fill(email)
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

test.describe.serial('fingerprint sign-in offer', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { localStorage.setItem('dockly-language', 'en'); localStorage.setItem('dockly-theme', 'light') })
  })

  test('offers fingerprint after a password sign-in, then signs in with it', async ({ page }) => {
    await fingerprintDevice(page)
    const email = `passkey_${Date.now()}@example.test`
    await signUp(page, email)
    await signOutViaApi(page)

    await passwordSignIn(page, email)
    await expect(page.getByRole('heading', { name: 'Sign in faster next time' })).toBeVisible()
    await page.getByRole('button', { name: 'Turn on fingerprint sign-in' }).click()
    await expect(page).toHaveURL(/\/app/)

    // Next time: one tap, no email or password.
    await signOutViaApi(page)
    await page.goto(`${BASE}/auth/signin`)
    await page.getByRole('button', { name: 'Sign in with fingerprint or face' }).click()
    await expect(page).toHaveURL(/\/app/)

    // This device is set up: a later password sign-in goes straight in.
    await signOutViaApi(page)
    await passwordSignIn(page, email)
    await expect(page).toHaveURL(/\/app/)
  })

  test('"Not now" goes straight in and does not ask again', async ({ page }) => {
    await fingerprintDevice(page)
    const email = `passkey_skip_${Date.now()}@example.test`
    await signUp(page, email)
    await signOutViaApi(page)

    await passwordSignIn(page, email)
    await page.getByRole('button', { name: 'Not now' }).click()
    await expect(page).toHaveURL(/\/app/)

    await signOutViaApi(page)
    await passwordSignIn(page, email)
    await expect(page).toHaveURL(/\/app/)
    await expect(page.getByRole('heading', { name: 'Sign in faster next time' })).toHaveCount(0)
  })

  test('works on each address the app is served from', async ({ page }) => {
    await fingerprintDevice(page)
    const email = `passkey_two_${Date.now()}@example.test`
    await signUp(page, email, OTHER)
    await signOutViaApi(page)

    // Old address: set up and use fingerprint sign-in there.
    await passwordSignIn(page, email, OTHER)
    await page.getByRole('button', { name: 'Turn on fingerprint sign-in' }).click()
    await expect(page).toHaveURL(/old\.localhost.*\/app/)
    await signOutViaApi(page)
    await page.goto(`${OTHER}/auth/signin`)
    await page.getByRole('button', { name: 'Sign in with fingerprint or face' }).click()
    await expect(page).toHaveURL(/old\.localhost.*\/app/)

    // Main address: its own passkey, set up and used the same way.
    await passwordSignIn(page, email)
    await page.getByRole('button', { name: 'Turn on fingerprint sign-in' }).click()
    await expect(page).toHaveURL(/\/app/)
    await signOutViaApi(page)
    await page.goto(`${BASE}/auth/signin`)
    await page.getByRole('button', { name: 'Sign in with fingerprint or face' }).click()
    await expect(page).toHaveURL(/\/app/)
  })
})
