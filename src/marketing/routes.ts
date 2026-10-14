/** Marketing pages and their URLs. Hebrew is the default language at the root; English lives under /en. */
export type MarketingPageKey = 'home' | 'pricing' | 'privacy' | 'terms' | 'accessibility' | 'notFound'
export type MarketingLang = 'he' | 'en'

export const MARKETING_PAGES: Exclude<MarketingPageKey, 'notFound'>[] = ['home', 'pricing', 'privacy', 'terms', 'accessibility']

export function marketingPath(page: Exclude<MarketingPageKey, 'notFound'>, lang: MarketingLang) {
  const base = page === 'home' ? '' : `/${page}`
  return lang === 'en' ? `/en${base}` || '/en' : base || '/'
}
