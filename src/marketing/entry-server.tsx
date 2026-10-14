/**
 * Build-time renderer for the marketing site (vite build --ssr). Produces
 * static HTML for every page in both languages; scripts/prerender.mjs writes
 * them into dist/site. No hydration: the pages are static, with a small
 * script for progressive enhancement.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { MarketingPage } from './Page'
import { headFor } from './head'
import { MARKETING_PAGES, marketingPath, type MarketingLang, type MarketingPageKey } from './routes'

export interface RenderedPage { path: string; file: string; lang: MarketingLang; page: MarketingPageKey; head: string; body: string }

export function renderAll(): RenderedPage[] {
  const out: RenderedPage[] = []
  for (const lang of ['he', 'en'] as const) {
    for (const page of [...MARKETING_PAGES, 'notFound'] as MarketingPageKey[]) {
      const path = page === 'notFound' ? (lang === 'he' ? '/404' : '/en/404') : marketingPath(page, lang)
      const body = `<div data-mk-page="${page}">${renderToStaticMarkup(<MarketingPage page={page} lang={lang} />)}</div>`
      out.push({ path, file: `${lang}/${page}.html`, lang, page, head: headFor(page, lang), body })
    }
  }
  return out
}
