import { useEffect, useRef } from 'react'
import { MarketingPage, COPY } from './Page'
import { initMarketing } from './behaviors'
import type { MarketingLang, MarketingPageKey } from './routes'
import './marketing.css'

/**
 * Client-side rendering of a marketing page (development, and in-app
 * navigation to a marketing URL). Production visitors get the prerendered
 * HTML of the same components from the server.
 */
export default function MarketingRoute({ page, lang }: { page: MarketingPageKey; lang: MarketingLang }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const html = document.documentElement
    const prev = { lang: html.lang, dir: html.dir, title: document.title, dark: html.classList.contains('dark') }
    html.lang = lang
    html.dir = lang === 'he' ? 'rtl' : 'ltr'
    html.classList.remove('dark') // the marketing site is light-only
    document.title = COPY[lang].meta[page].title
    // Fill the deployment placeholders the server substitutes in production.
    let alive = true
    fetch('/api/public/site').then((r) => r.json()).then((site: { legalName: string; contactEmail: string }) => {
      if (!alive || !ref.current) return
      const fill = (v: string) => v.replace(/%%SITE_URL%%/g, location.origin).replace(/%%LEGAL_NAME%%/g, site.legalName).replace(/%%CONTACT_EMAIL%%/g, site.contactEmail)
      const walker = document.createTreeWalker(ref.current, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.nodeType === Node.TEXT_NODE && n.nodeValue?.includes('%%')) n.nodeValue = fill(n.nodeValue)
        if (n instanceof HTMLAnchorElement && n.getAttribute('href')?.includes('%%')) n.setAttribute('href', fill(n.getAttribute('href')!))
      }
    }).catch(() => {})
    const cleanup = initMarketing(ref.current || document, { page, lang })
    return () => {
      alive = false
      cleanup()
      html.lang = prev.lang
      html.dir = prev.dir
      document.title = prev.title
      if (prev.dark) html.classList.add('dark')
    }
  }, [page, lang])
  return <div ref={ref} data-mk-page={page}><MarketingPage page={page} lang={lang} /></div>
}
