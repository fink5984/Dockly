/** Shape of the marketing copy. Hebrew and English must both satisfy it. */
export interface LegalSection { heading: string; paragraphs?: string[]; bullets?: string[] }
export interface LegalDoc { title: string; intro: string; updated: string; sections: LegalSection[] }

export interface MarketingCopy {
  meta: Record<'home' | 'pricing' | 'privacy' | 'terms' | 'accessibility' | 'notFound', { title: string; description: string }>
  nav: { product: string; how: string; pricing: string; faq: string; security: string; signIn: string; cta: string; menu: string; close: string; otherLanguage: string; otherLanguageLabel: string; skip: string; home: string }
  hero: { eyebrow: string; title: string; titleAccent: string; subtitle: string; primary: string; secondary: string; points: string[]; screenshotAlt: string; phoneAlt: string }
  audience: { title: string; items: string[] }
  problems: { title: string; subtitle: string; items: { title: string; body: string }[] }
  how: { title: string; subtitle: string; steps: { title: string; body: string }[] }
  tour: { title: string; subtitle: string; signPhoneAlt: string; items: { key: 'portal' | 'review' | 'sign' | 'automation'; eyebrow: string; title: string; body: string; bullets: string[]; alt: string }[] }
  features: { title: string; subtitle: string; items: { title: string; body: string }[] }
  security: { title: string; subtitle: string; items: { title: string; body: string }[]; link: string }
  pricingTeaser: { title: string; subtitle: string; cta: string }
  faq: { title: string; items: { q: string; a: string }[] }
  final: { title: string; subtitle: string; cta: string; secondary: string; note: string }
  footer: { tagline: string; product: string; company: string; legal: string; contact: string; rights: string }
  pricing: {
    title: string; subtitle: string; monthly: string; yearly: string; yearlySave: string; starter: string; pro: string; tierLabel: string; intervalLabel: string
    perMonth: string; plusVat: string; billedYearly: string; save: string; cta: string; trialNote: string; bestValue: string
    families: Record<'collect' | 'sign' | 'suite', { name: string; desc: string }>
    limits: { requests: string; envelopes: string; storage: string; seats: string; noRequests: string; noEnvelopes: string }
    included: { title: string; items: string[] }
    compare: { title: string; feature: string; caption: string; labels: { price: string; requests: string; envelopes: string; storage: string; seats: string } }
    extras: { title: string; subtitle: string; addonsTitle: string; packsTitle: string; addons: Record<string, string>; packs: Record<string, string>; perMonth: string; oneTime: string }
    fair: { title: string; body: string }
    faq: { q: string; a: string }[]
    provisional: string
  }
  legal: { privacy: LegalDoc; terms: LegalDoc; accessibility: LegalDoc; toc: string }
  notFound: { title: string; body: string; home: string }
}
