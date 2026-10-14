import type { ReactNode } from 'react'
import { Languages, Menu } from 'lucide-react'
import { Logo } from '@/components/layout/Logo'
import type { MarketingCopy } from '../copy/types'
import { marketingPath, type MarketingLang, type MarketingPageKey } from '../routes'

export interface PageProps { copy: MarketingCopy; lang: MarketingLang }

export function Container({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8 ${className}`}>{children}</div>
}

const anchorOf = (home: string, id: string) => (home === '/' ? `/#${id}` : `${home}#${id}`)

/** The same page in the other language (hreflang pair). */
export function otherLangPath(page: MarketingPageKey, lang: MarketingLang) {
  const other = lang === 'he' ? 'en' : 'he'
  return page === 'notFound' ? marketingPath('home', other) : marketingPath(page, other)
}

export function Layout({ copy, lang, page, children }: PageProps & { page: MarketingPageKey; children: ReactNode }) {
  const home = marketingPath('home', lang)
  const pricing = marketingPath('pricing', lang)
  const links = [
    { href: anchorOf(home, 'product'), label: copy.nav.product },
    { href: anchorOf(home, 'how'), label: copy.nav.how },
    { href: pricing, label: copy.nav.pricing },
    { href: anchorOf(home, 'security'), label: copy.nav.security },
    { href: anchorOf(home, 'faq'), label: copy.nav.faq },
  ]
  const signup = `/auth/signup?lang=${lang}`
  return (
    <div className="mk-root flex min-h-dvh flex-col bg-white text-fg">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:shadow-lg">{copy.nav.skip}</a>
      <header className="sticky top-0 z-40 border-b border-line/70 bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/70">
        <Container className="flex h-16 items-center gap-6">
          <a href={home} className="flex items-center gap-2 rounded-md" aria-label={copy.nav.home}>
            <Logo className="size-8" />
            <span className="text-lg font-semibold tracking-tight">Dockly</span>
          </a>
          <nav aria-label={copy.nav.product} className="hidden flex-1 items-center gap-1 lg:flex">
            {links.map((l) => (
              <a key={l.href} href={l.href} aria-current={page === 'pricing' && l.href === pricing ? 'page' : undefined} className="rounded-md px-3 py-2 text-sm font-medium text-fg-2 hover:bg-surface-3 hover:text-fg aria-[current=page]:text-brand-700">{l.label}</a>
            ))}
          </nav>
          <div className="ms-auto flex items-center gap-2 lg:ms-0">
            <a href={otherLangPath(page, lang)} hrefLang={lang === 'he' ? 'en' : 'he'} lang={lang === 'he' ? 'en' : 'he'} className="hidden items-center gap-1.5 rounded-md px-2.5 py-2 text-sm text-fg-3 hover:bg-surface-3 hover:text-fg-2 sm:inline-flex" aria-label={copy.nav.otherLanguageLabel}>
              <Languages className="size-4" aria-hidden />{copy.nav.otherLanguage}
            </a>
            <a href="/auth/signin" className="hidden rounded-md px-3 py-2 text-sm font-medium text-fg-2 hover:bg-surface-3 hover:text-fg sm:inline-flex">{copy.nav.signIn}</a>
            <a href={signup} data-cta="header" className="inline-flex h-9 items-center rounded-full bg-brand-600 px-3.5 text-sm font-semibold text-white shadow-xs hover:bg-brand-700">{copy.nav.cta}</a>
            <details className="mk-menu relative lg:hidden">
              <summary className="flex size-9 cursor-pointer list-none items-center justify-center rounded-md text-fg-2 hover:bg-surface-3" aria-label={copy.nav.menu}>
                <Menu className="size-5" aria-hidden />
              </summary>
              <nav aria-label={copy.nav.product} className="absolute end-0 top-11 w-64 rounded-xl border border-line bg-white p-2 shadow-xl">
                {links.map((l) => <a key={l.href} href={l.href} className="block rounded-md px-3 py-2.5 text-sm font-medium text-fg-2 hover:bg-surface-3">{l.label}</a>)}
                <div className="my-2 h-px bg-line" />
                <a href="/auth/signin" className="block rounded-md px-3 py-2.5 text-sm font-medium text-fg-2 hover:bg-surface-3">{copy.nav.signIn}</a>
                <a href={otherLangPath(page, lang)} hrefLang={lang === 'he' ? 'en' : 'he'} className="block rounded-md px-3 py-2.5 text-sm text-fg-3 hover:bg-surface-3">{copy.nav.otherLanguage}</a>
              </nav>
            </details>
          </div>
        </Container>
      </header>
      <main id="main" className="flex-1">{children}</main>
      <Footer copy={copy} lang={lang} page={page} />
    </div>
  )
}

function Footer({ copy, lang, page }: PageProps & { page: MarketingPageKey }) {
  const home = marketingPath('home', lang)
  const anchor = (id: string) => anchorOf(home, id)
  const cols = [
    { title: copy.footer.product, links: [{ href: anchor('product'), label: copy.nav.product }, { href: anchor('how'), label: copy.nav.how }, { href: marketingPath('pricing', lang), label: copy.nav.pricing }, { href: anchor('faq'), label: copy.nav.faq }] },
    { title: copy.footer.legal, links: [{ href: marketingPath('privacy', lang), label: copy.legal.privacy.title }, { href: marketingPath('terms', lang), label: copy.legal.terms.title }, { href: marketingPath('accessibility', lang), label: copy.legal.accessibility.title }] },
    { title: copy.footer.contact, links: [{ href: 'mailto:%%CONTACT_EMAIL%%', label: '%%CONTACT_EMAIL%%' }, { href: '/auth/signin', label: copy.nav.signIn }, { href: otherLangPath(page, lang), label: copy.nav.otherLanguage }] },
  ]
  return (
    <footer className="border-t border-line bg-surface-2">
      <Container className="grid gap-10 py-14 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <a href={home} className="flex items-center gap-2"><Logo className="size-7" /><span className="font-semibold">Dockly</span></a>
          <p className="mt-3 max-w-xs text-sm text-fg-3">{copy.footer.tagline}</p>
        </div>
        {cols.map((c) => (
          <div key={c.title}>
            <h2 className="text-sm font-semibold text-fg">{c.title}</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {c.links.map((l) => <li key={l.href}><a href={l.href} className="text-fg-3 hover:text-fg" dir={l.href.startsWith('mailto:') ? 'ltr' : undefined}>{l.label}</a></li>)}
            </ul>
          </div>
        ))}
      </Container>
      <Container className="border-t border-line py-6 text-xs text-fg-4">
        © <span data-year>2026</span> %%LEGAL_NAME%%. {copy.footer.rights}
      </Container>
    </footer>
  )
}
