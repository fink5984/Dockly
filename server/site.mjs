/**
 * Public marketing site: serves the pages prerendered at build time
 * (dist/.site, see scripts/prerender.mjs), fills in deployment values, and
 * provides robots.txt and sitemap.xml.
 *
 * URL layout: Hebrew at the root, English under /en. The dashboard is at
 * /app; client links (/p, /upload, /sign) and /auth are unchanged.
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { config } from './config.mjs'
import { attachUser } from './middleware/auth.mjs'

export const SITE_PAGES = {
  '/': 'he/home', '/en': 'en/home',
  '/pricing': 'he/pricing', '/en/pricing': 'en/pricing',
  '/privacy': 'he/privacy', '/en/privacy': 'en/privacy',
  '/terms': 'he/terms', '/en/terms': 'en/terms',
  '/accessibility': 'he/accessibility', '/en/accessibility': 'en/accessibility',
}

/** Paths that belong to the single-page app (dashboard, auth, client links). */
const SPA_PREFIXES = ['/app', '/auth', '/onboarding', '/p/', '/upload/', '/sign/', '/billing/',
  // dashboard URLs from before /app existed — the SPA redirects them
  '/requests', '/cases', '/clients', '/signatures', '/documents', '/document-types', '/activity', '/templates', '/settings', '/whatsapp']

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function siteValues() {
  return {
    siteUrl: config.appBaseUrl,
    legalName: config.site.legalName,
    contactEmail: config.site.contactEmail || '[contact email not configured]',
  }
}

export function mountSite(app, distDir) {
  // A dot-directory: express.static never serves it, so templates with placeholders aren't public.
  const siteDir = join(distDir, '.site')

  app.get('/api/public/site', (_req, res) => {
    const v = siteValues()
    res.json({ legalName: v.legalName, contactEmail: v.contactEmail })
  })

  app.get('/robots.txt', (_req, res) => {
    res.type('text/plain').setHeader('Cache-Control', 'public, max-age=3600')
    res.send(['User-agent: *', 'Allow: /', 'Disallow: /app', 'Disallow: /api/', 'Disallow: /p/', 'Disallow: /upload/', 'Disallow: /sign/', 'Disallow: /billing/', 'Disallow: /auth/invite/', '', `Sitemap: ${config.appBaseUrl}/sitemap.xml`, ''].join('\n'))
  })

  app.get('/sitemap.xml', (_req, res) => {
    const pairs = [['/', '/en'], ['/pricing', '/en/pricing'], ['/privacy', '/en/privacy'], ['/terms', '/en/terms'], ['/accessibility', '/en/accessibility']]
    const url = (p) => `${config.appBaseUrl}${p}`
    const entries = pairs.flatMap(([he, en]) => [he, en].map((loc) => `  <url><loc>${url(loc)}</loc>` +
      `<xhtml:link rel="alternate" hreflang="he" href="${url(he)}"/><xhtml:link rel="alternate" hreflang="en" href="${url(en)}"/>` +
      `<xhtml:link rel="alternate" hreflang="x-default" href="${url(he)}"/></url>`))
    res.type('application/xml').setHeader('Cache-Control', 'public, max-age=3600')
    res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries.join('\n')}\n</urlset>\n`)
  })

  if (!existsSync(siteDir)) return { available: false }

  const cache = new Map()
  const page = (name) => {
    if (!cache.has(name)) {
      const v = siteValues()
      const html = readFileSync(join(siteDir, `${name}.html`), 'utf8')
        .replace(/%%SITE_URL%%/g, v.siteUrl)
        .replace(/%%LEGAL_NAME%%/g, escapeHtml(v.legalName))
        .replace(/%%CONTACT_EMAIL%%/g, escapeHtml(v.contactEmail))
      cache.set(name, html)
    }
    return cache.get(name)
  }

  const send = (res, name, status = 200) => {
    res.status(status)
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Content-Language', name.startsWith('en/') ? 'en' : 'he')
    res.send(page(name))
  }

  app.get(Object.keys(SITE_PAGES), attachUser, (req, res) => {
    const path = req.path.replace(/\/+$/, '') || '/'
    // Signed-in users who open the root land in their dashboard, as before.
    if (path === '/' && req.user) {
      res.setHeader('Cache-Control', 'private, no-store')
      return res.redirect(302, '/app')
    }
    res.setHeader('Cache-Control', path === '/' ? 'private, no-cache' : 'public, max-age=600')
    if (path === '/') res.setHeader('Vary', 'Cookie')
    send(res, SITE_PAGES[path])
  })

  return {
    available: true,
    /** For GET requests the SPA doesn't own: a real 404 page with a 404 status. */
    notFound(req, res, next) {
      if (req.method !== 'GET' || req.path.startsWith('/api/') || SPA_PREFIXES.some((p) => req.path === p || req.path.startsWith(p.endsWith('/') ? p : `${p}/`) || req.path === p.replace(/\/$/, ''))) return next()
      if (/\.[a-z0-9]{2,5}$/i.test(req.path)) return next() // missing static file
      res.setHeader('Cache-Control', 'no-cache')
      send(res, req.path.startsWith('/en/') || req.path === '/en' ? 'en/notFound' : 'he/notFound', 404)
    },
  }
}
