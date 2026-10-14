/**
 * <head> metadata for prerendered marketing pages: title, description,
 * canonical + hreflang alternates, Open Graph/Twitter, and JSON-LD.
 * %%SITE_URL%% is filled in by the server at response time (APP_BASE_URL),
 * so one build serves any domain.
 */
import { catalog } from '@shared/billing/pricing.mjs'
import { COPY } from './Page'
import { marketingPath, type MarketingLang, type MarketingPageKey } from './routes'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function headFor(page: MarketingPageKey, lang: MarketingLang) {
  const copy = COPY[lang]
  const meta = copy.meta[page]
  const tags: string[] = [
    `<title>${esc(meta.title)}</title>`,
    `<meta name="description" content="${esc(meta.description)}">`,
    '<meta name="theme-color" content="#4b4acf">',
  ]
  if (page === 'notFound') {
    tags.push('<meta name="robots" content="noindex">')
    return tags.join('\n    ')
  }
  const url = (l: MarketingLang) => `%%SITE_URL%%${marketingPath(page, l)}`
  tags.push(
    `<link rel="canonical" href="${url(lang)}">`,
    `<link rel="alternate" hreflang="he" href="${url('he')}">`,
    `<link rel="alternate" hreflang="en" href="${url('en')}">`,
    `<link rel="alternate" hreflang="x-default" href="${url('he')}">`,
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="Dockly">',
    `<meta property="og:title" content="${esc(meta.title)}">`,
    `<meta property="og:description" content="${esc(meta.description)}">`,
    `<meta property="og:url" content="${url(lang)}">`,
    `<meta property="og:locale" content="${lang === 'he' ? 'he_IL' : 'en_US'}">`,
    `<meta property="og:image" content="%%SITE_URL%%/marketing/og-${lang}.png">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta name="twitter:card" content="summary_large_image">',
  )
  if (page === 'home' || page === 'pricing') tags.push(`<script type="application/ld+json">${jsonLd(lang)}</script>`)
  return tags.join('\n    ')
}

/** Organization + SoftwareApplication with real catalog prices. No ratings or reviews. */
function jsonLd(lang: MarketingLang) {
  const copy = COPY[lang]
  const data = [
    { '@context': 'https://schema.org', '@type': 'Organization', name: 'Dockly', url: '%%SITE_URL%%/', logo: '%%SITE_URL%%/favicon.svg' },
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Dockly',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      inLanguage: ['he', 'en'],
      description: copy.meta.home.description,
      url: `%%SITE_URL%%${marketingPath('home', lang)}`,
      offers: catalog.plans.map((p) => ({
        '@type': 'Offer',
        name: `${copy.pricing.families[p.family].name} ${p.tier === 'pro' ? 'Pro' : 'Starter'}`,
        price: (p.monthly / 100).toFixed(2),
        priceCurrency: catalog.currency,
        priceSpecification: { '@type': 'UnitPriceSpecification', price: (p.monthly / 100).toFixed(2), priceCurrency: catalog.currency, unitText: 'MONTH', valueAddedTaxIncluded: false },
      })),
    },
  ]
  return JSON.stringify(data).replace(/</g, '\\u003c')
}
