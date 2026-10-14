import {
  ArrowLeft, ArrowRight, BellRing, Check, ChevronDown, Files, FileSignature, FolderSearch, Inbox, Languages, LayoutTemplate,
  Lock, MessageCircle, Repeat, ServerCog, ShieldCheck, Smartphone, Users, Fingerprint, EyeOff, Building2, Scale, Home, Landmark, Calculator, Umbrella,
} from 'lucide-react'
import { Container, Layout, type PageProps } from '../components/Layout'
import { PricingCards } from '../components/PricingCards'
import { marketingPath } from '../routes'

export const SCREENS = {
  dashboard: { w: 1440, h: 900 }, request: { w: 1440, h: 900 }, signature: { w: 1440, h: 900 }, automation: { w: 1440, h: 900 },
  portal: { w: 780, h: 1688 }, sign: { w: 780, h: 1688 },
} as const
export const screen = (lang: string, name: keyof typeof SCREENS) => `/marketing/screens/${lang}/${name}.jpg`

export function BrowserFrame({ src, alt, w, h, eager = false }: { src: string; alt: string; w: number; h: number; eager?: boolean }) {
  return (
    <figure className="overflow-hidden rounded-xl border border-line bg-white shadow-[0_30px_60px_-20px_rgb(16_24_40/0.25)]">
      <div className="flex h-8 items-center gap-1.5 border-b border-line bg-surface-2 px-3" aria-hidden>
        <span className="size-2.5 rounded-full bg-line-2" /><span className="size-2.5 rounded-full bg-line-2" /><span className="size-2.5 rounded-full bg-line-2" />
      </div>
      <img src={src} alt={alt} width={w} height={h} loading={eager ? 'eager' : 'lazy'} decoding="async" {...(eager ? { fetchPriority: 'high' as const } : {})} className="block h-auto w-full" />
    </figure>
  )
}

export function PhoneFrame({ src, alt, w, h, className = '' }: { src: string; alt: string; w: number; h: number; className?: string }) {
  return (
    <figure className={`overflow-hidden rounded-[2rem] border-[6px] border-fg bg-fg shadow-[0_30px_60px_-15px_rgb(16_24_40/0.35)] ${className}`}>
      <img src={src} alt={alt} width={w} height={h} loading="lazy" decoding="async" className="block h-auto w-full rounded-[1.6rem]" />
    </figure>
  )
}

function SectionHead({ id, title, subtitle, center = true }: { id?: string; title: string; subtitle?: string; center?: boolean }) {
  return (
    <div className={center ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl'}>
      <h2 id={id} className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">{title}</h2>
      {subtitle && <p className="mt-4 text-lg leading-relaxed text-fg-3">{subtitle}</p>}
    </div>
  )
}

const AUDIENCE_ICONS = [Calculator, Scale, Landmark, Umbrella, Home, Building2]
const PROBLEM_ICONS = [Files, Repeat, FileSignature]
const STEP_ICONS = [LayoutTemplate, MessageCircle, Smartphone, Inbox]
const FEATURE_ICONS = [LayoutTemplate, MessageCircle, Languages, Users, FolderSearch, Files]
const SECURITY_ICONS = [ServerCog, Lock, Fingerprint, EyeOff]
const TOUR_SHOT = { portal: 'portal', review: 'request', sign: 'signature', automation: 'automation' } as const

export function HomePage({ copy, lang }: PageProps) {
  const Arrow = lang === 'he' ? ArrowLeft : ArrowRight
  const signup = `/auth/signup?lang=${lang}`
  return (
    <Layout copy={copy} lang={lang} page="home">
      {/* Hero */}
      <section className="relative overflow-hidden" aria-labelledby="hero-title">
        <div className="mk-hero-glow pointer-events-none absolute inset-x-0 top-0 -z-0 h-[640px]" aria-hidden />
        <Container className="relative pt-16 pb-12 sm:pt-24">
          <div className="mx-auto max-w-3xl text-center">
            <p className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-white/80 px-3 py-1 text-sm font-medium text-brand-700">
              <BellRing className="size-4" aria-hidden />{copy.hero.eyebrow}
            </p>
            <h1 id="hero-title" className="mt-6 text-4xl font-semibold leading-[1.1] tracking-tight text-fg sm:text-6xl">
              {copy.hero.title}<br /><span className="text-brand-600">{copy.hero.titleAccent}</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-fg-3">{copy.hero.subtitle}</p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a href={signup} data-cta="hero" className="inline-flex h-12 items-center gap-2 rounded-lg bg-brand-600 px-6 text-md font-semibold text-white shadow-sm hover:bg-brand-700">
                {copy.hero.primary}<Arrow className="size-4" aria-hidden />
              </a>
              <a href="#how" className="inline-flex h-12 items-center rounded-lg border border-line-2 bg-white px-6 text-md font-semibold text-fg hover:bg-surface-2">{copy.hero.secondary}</a>
            </div>
            <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-fg-3">
              {copy.hero.points.map((p) => <li key={p} className="flex items-center gap-1.5"><Check className="size-4 text-success" aria-hidden />{p}</li>)}
            </ul>
          </div>
          <div className="relative mx-auto mt-14 max-w-5xl">
            <BrowserFrame src={screen(lang, 'dashboard')} alt={copy.hero.screenshotAlt} {...dims('dashboard')} eager />
            <PhoneFrame src={screen(lang, 'portal')} alt={copy.hero.phoneAlt} {...dims('portal')} className="absolute -bottom-10 end-[-1rem] hidden w-[22%] sm:block lg:end-[-3rem]" />
          </div>
        </Container>
      </section>

      {/* Audience */}
      <section className="border-y border-line bg-surface-2 py-10" aria-labelledby="audience-title">
        <Container>
          <h2 id="audience-title" className="text-center text-sm font-semibold text-fg-3">{copy.audience.title}</h2>
          <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {copy.audience.items.map((a, i) => {
              const Icon = AUDIENCE_ICONS[i % AUDIENCE_ICONS.length]
              return <li key={a} className="flex flex-col items-center gap-2 text-center text-sm font-medium text-fg-2"><Icon className="size-6 text-fg-4" aria-hidden />{a}</li>
            })}
          </ul>
        </Container>
      </section>

      {/* Problems */}
      <section className="py-24" aria-labelledby="problems-title">
        <Container>
          <SectionHead id="problems-title" title={copy.problems.title} subtitle={copy.problems.subtitle} />
          <ul className="mt-14 grid gap-6 md:grid-cols-3">
            {copy.problems.items.map((p, i) => {
              const Icon = PROBLEM_ICONS[i]
              return (
                <li key={p.title} className="rounded-2xl border border-line bg-white p-6">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-danger-soft text-danger"><Icon className="size-5" aria-hidden /></span>
                  <h3 className="mt-4 text-lg font-semibold">{p.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-fg-3">{p.body}</p>
                </li>
              )
            })}
          </ul>
        </Container>
      </section>

      {/* How it works */}
      <section id="how" className="scroll-mt-20 bg-brand-900 py-24 text-white" aria-labelledby="how-title">
        <Container>
          <div className="mx-auto max-w-2xl text-center">
            <h2 id="how-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">{copy.how.title}</h2>
            <p className="mt-4 text-lg text-brand-200">{copy.how.subtitle}</p>
          </div>
          <ol className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {copy.how.steps.map((s, i) => {
              const Icon = STEP_ICONS[i]
              return (
                <li key={s.title} className="relative rounded-2xl bg-white/[0.06] p-6 ring-1 ring-white/10">
                  <div className="flex items-center gap-3">
                    <span className="flex size-9 items-center justify-center rounded-full bg-white text-sm font-bold text-brand-800" aria-hidden>{i + 1}</span>
                    <Icon className="size-5 text-brand-300" aria-hidden />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-brand-100/80">{s.body}</p>
                </li>
              )
            })}
          </ol>
        </Container>
      </section>

      {/* Product tour */}
      <section id="product" className="scroll-mt-20 py-24" aria-labelledby="tour-title">
        <Container>
          <SectionHead id="tour-title" title={copy.tour.title} subtitle={copy.tour.subtitle} />
          <div className="mt-16 space-y-24">
            {copy.tour.items.map((item, i) => {
              const shot = TOUR_SHOT[item.key]
              const phone = shot === 'portal'
              return (
                <article key={item.key} className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
                  <div className={i % 2 ? 'lg:order-2' : ''}>
                    <p className="text-sm font-semibold text-brand-600">{item.eyebrow}</p>
                    <h3 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{item.title}</h3>
                    <p className="mt-4 text-md leading-relaxed text-fg-3">{item.body}</p>
                    <ul className="mt-6 space-y-3">
                      {item.bullets.map((b) => <li key={b} className="flex items-start gap-2.5 text-sm text-fg-2"><Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />{b}</li>)}
                    </ul>
                  </div>
                  <div className={`${i % 2 ? 'lg:order-1' : ''} ${phone ? 'flex items-start justify-center gap-6' : ''}`}>
                    {phone ? (
                      <>
                        <PhoneFrame src={screen(lang, 'portal')} alt={item.alt} {...dims('portal')} className="w-[46%] max-w-[260px]" />
                        <PhoneFrame src={screen(lang, 'sign')} alt={copy.tour.signPhoneAlt} {...dims('sign')} className="mt-12 w-[46%] max-w-[260px]" />
                      </>
                    ) : <BrowserFrame src={screen(lang, shot)} alt={item.alt} {...dims(shot)} />}
                  </div>
                </article>
              )
            })}
          </div>
        </Container>
      </section>

      {/* Features */}
      <section className="border-t border-line bg-surface-2 py-24" aria-labelledby="features-title">
        <Container>
          <SectionHead id="features-title" title={copy.features.title} subtitle={copy.features.subtitle} />
          <ul className="mt-14 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {copy.features.items.map((f, i) => {
              const Icon = FEATURE_ICONS[i]
              return (
                <li key={f.title} className="flex gap-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white text-brand-600 shadow-xs ring-1 ring-line"><Icon className="size-5" aria-hidden /></span>
                  <div><h3 className="font-semibold">{f.title}</h3><p className="mt-1.5 text-sm leading-relaxed text-fg-3">{f.body}</p></div>
                </li>
              )
            })}
          </ul>
        </Container>
      </section>

      {/* Security */}
      <section id="security" className="scroll-mt-20 py-24" aria-labelledby="security-title">
        <Container className="grid gap-12 lg:grid-cols-[1fr_1.3fr] lg:items-start">
          <div>
            <span className="flex size-12 items-center justify-center rounded-2xl bg-success-soft text-success"><ShieldCheck className="size-6" aria-hidden /></span>
            <h2 id="security-title" className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">{copy.security.title}</h2>
            <p className="mt-4 text-lg leading-relaxed text-fg-3">{copy.security.subtitle}</p>
            <a href={marketingPath('privacy', lang)} className="mt-6 inline-flex items-center gap-1.5 font-semibold text-brand-600 hover:underline">{copy.security.link}<Arrow className="size-4" aria-hidden /></a>
          </div>
          <ul className="grid gap-5 sm:grid-cols-2">
            {copy.security.items.map((s, i) => {
              const Icon = SECURITY_ICONS[i]
              return (
                <li key={s.title} className="rounded-2xl border border-line p-6">
                  <Icon className="size-5 text-success" aria-hidden />
                  <h3 className="mt-3 font-semibold">{s.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-fg-3">{s.body}</p>
                </li>
              )
            })}
          </ul>
        </Container>
      </section>

      {/* Pricing teaser */}
      <section id="pricing" className="mk-track-pricing scroll-mt-20 border-t border-line bg-surface-2 py-24" aria-labelledby="pricing-title">
        <Container>
          <SectionHead id="pricing-title" title={copy.pricingTeaser.title} subtitle={copy.pricingTeaser.subtitle} />
          <div className="mt-12"><PricingCards copy={copy} lang={lang} showToggles={false} /></div>
          <p className="mt-8 text-center">
            <a href={marketingPath('pricing', lang)} className="inline-flex items-center gap-1.5 font-semibold text-brand-600 hover:underline">{copy.pricingTeaser.cta}<Arrow className="size-4" aria-hidden /></a>
          </p>
        </Container>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-20 py-24" aria-labelledby="faq-title">
        <Container className="max-w-3xl">
          <SectionHead id="faq-title" title={copy.faq.title} />
          <Faq items={copy.faq.items} />
        </Container>
      </section>

      <FinalCta copy={copy} lang={lang} />
    </Layout>
  )
}

function dims(name: keyof typeof SCREENS) {
  return { w: SCREENS[name].w, h: SCREENS[name].h }
}

export function Faq({ items }: { items: { q: string; a: string }[] }) {
  return (
    <div className="mt-10 divide-y divide-line rounded-2xl border border-line bg-white">
      {items.map((f) => (
        <details key={f.q} className="group px-6">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-start font-semibold text-fg">
            {f.q}<ChevronDown className="size-5 shrink-0 text-fg-4 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <p className="pb-5 text-sm leading-relaxed text-fg-3">{f.a}</p>
        </details>
      ))}
    </div>
  )
}

export function FinalCta({ copy, lang }: PageProps) {
  return (
    <section className="px-4 pb-24" aria-labelledby="final-title">
      <div className="mk-final mx-auto max-w-5xl overflow-hidden rounded-3xl bg-brand-700 px-6 py-16 text-center text-white sm:px-12">
        <h2 id="final-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">{copy.final.title}</h2>
        <p className="mx-auto mt-4 max-w-xl text-lg text-brand-100">{copy.final.subtitle}</p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a href={`/auth/signup?lang=${lang}`} data-cta="final" className="inline-flex h-12 items-center rounded-lg bg-white px-6 font-semibold text-brand-800 hover:bg-brand-50">{copy.final.cta}</a>
          <a href={marketingPath('pricing', lang)} className="inline-flex h-12 items-center rounded-lg px-6 font-semibold text-white ring-1 ring-white/30 hover:bg-white/10">{copy.final.secondary}</a>
        </div>
        <p className="mt-6 text-sm text-brand-200">{copy.final.note}</p>
      </div>
    </section>
  )
}
