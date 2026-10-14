import en from './copy/en'
import he from './copy/he'
import type { MarketingCopy } from './copy/types'
import type { MarketingLang, MarketingPageKey } from './routes'
import { HomePage } from './pages/HomePage'
import { PricingPage } from './pages/PricingPage'
import { LegalPage, NotFoundPage } from './pages/LegalPage'

export const COPY: Record<MarketingLang, MarketingCopy> = { he, en }

export function MarketingPage({ page, lang }: { page: MarketingPageKey; lang: MarketingLang }) {
  const copy = COPY[lang]
  switch (page) {
    case 'home': return <HomePage copy={copy} lang={lang} />
    case 'pricing': return <PricingPage copy={copy} lang={lang} />
    case 'privacy':
    case 'terms':
    case 'accessibility': return <LegalPage copy={copy} lang={lang} doc={page} />
    default: return <NotFoundPage copy={copy} lang={lang} />
  }
}
