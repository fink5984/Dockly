/**
 * Public site routing: marketing pages, the dashboard move to /app, and that
 * every URL customers already have (client links, legacy dashboard paths)
 * still reaches the app. Needs a production build (`npm run build`); skipped otherwise.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync } from 'fs'
import { join } from 'path'
import { startApp, stopApp, newOwner, skipIntegration, Client } from './helpers.mjs'

const built = existsSync(join(import.meta.dirname, '..', '..', 'dist', '.site', 'he', 'home.html'))

describe.skipIf(skipIntegration() || !built)('public site', () => {
  let base, anon
  beforeAll(async () => { base = await startApp(); anon = new Client(base) })
  afterAll(stopApp)

  const html = async (c, path) => {
    const r = await c.request('GET', path, { raw: true })
    return { status: r.status, body: await r.text(), headers: r.headers }
  }

  it('serves the Hebrew home page at / with full metadata', async () => {
    const r = await html(anon, '/')
    expect(r.status).toBe(200)
    expect(r.body).toContain('<html lang="he" dir="rtl">')
    expect(r.body).toContain('rel="canonical" href="http://localhost/"')
    expect(r.body).toContain('hreflang="en" href="http://localhost/en"')
    expect(r.body).toContain('application/ld+json')
    expect(r.body).not.toMatch(/%%[A-Z_]+%%/)
    expect(r.headers.get('content-language')).toBe('he')
    // No invented social proof.
    expect(r.body).not.toMatch(/aggregateRating|testimonial|★/i)
  })

  it('serves English under /en and every legal page in both languages', async () => {
    const en = await html(anon, '/en')
    expect(en.body).toContain('<html lang="en" dir="ltr">')
    for (const p of ['/pricing', '/privacy', '/terms', '/accessibility', '/en/pricing', '/en/privacy', '/en/terms', '/en/accessibility']) {
      const r = await html(anon, p)
      expect(r.status, p).toBe(200)
      expect(r.body).not.toMatch(/%%[A-Z_]+%%/)
    }
  })

  it('shows catalog prices on the pricing page', async () => {
    const { catalog } = await import('../../shared/billing/pricing.mjs')
    const r = await html(anon, '/en/pricing')
    const suite = catalog.plans.find((p) => p.code === 'suite_starter')
    expect(r.body).toContain(String(suite.monthly / 100))
    expect(r.body).toContain('href="/auth/signup?lang=en&amp;plan=suite_starter&amp;interval=month"')
  })

  it('sends signed-in users from / to their dashboard', async () => {
    const c = await newOwner(base)
    const r = await c.request('GET', '/', { raw: true })
    expect(r.status).toBe(302)
    expect(r.headers.get('location')).toBe('/app')
  })

  it('keeps client links, auth and old dashboard URLs on the app', async () => {
    for (const p of ['/p/some-token', '/upload/some-token', '/sign/some-token', '/auth/signin', '/app', '/app/requests/123', '/requests/123', '/cases/5', '/clients', '/settings/team', '/billing/sandbox/x']) {
      const r = await html(anon, p)
      expect(r.status, p).toBe(200)
      expect(r.body, p).toContain('<div id="root">')
    }
  })

  it('returns a real 404 for unknown pages', async () => {
    const r = await html(anon, '/no-such-page')
    expect(r.status).toBe(404)
    expect(r.body).toContain('noindex')
    expect((await html(anon, '/en/nope')).body).toContain('lang="en"')
  })

  it('publishes robots.txt and a sitemap with language alternates', async () => {
    const robots = await html(anon, '/robots.txt')
    expect(robots.body).toContain('Disallow: /app')
    expect(robots.body).toContain('Disallow: /p/')
    expect(robots.body).toContain('Sitemap: http://localhost/sitemap.xml')
    const sm = await html(anon, '/sitemap.xml')
    expect(sm.body).toContain('<loc>http://localhost/en/pricing</loc>')
    expect(sm.body).toContain('hreflang="he"')
  })

  it('never serves the raw page templates', async () => {
    expect((await html(anon, '/.site/he/home.html')).body).not.toContain('%%SITE_URL%%')
    expect((await html(anon, '/marketing.html')).body).not.toContain('<!--mk-body-->')
  })
})
