import { Check, Gauge } from 'lucide-react'
import { catalog } from '@shared/billing/pricing.mjs'
import { Container, Layout, type PageProps } from '../components/Layout'
import { PricingCards, price } from '../components/PricingCards'
import { Faq, FinalCta } from './HomePage'

export function PricingPage({ copy, lang }: PageProps) {
  const p = copy.pricing
  const plans = ['collect', 'sign', 'suite'].flatMap((f) => catalog.plans.filter((x) => x.family === f))
  const dash = '—'
  return (
    <Layout copy={copy} lang={lang} page="pricing">
      <section className="relative overflow-hidden pt-16 pb-20 sm:pt-24" aria-labelledby="pricing-title">
        <div className="mk-hero-glow pointer-events-none absolute inset-x-0 top-0 h-[520px]" aria-hidden />
        <Container className="relative">
          <div className="mx-auto max-w-2xl text-center">
            <h1 id="pricing-title" className="text-4xl font-semibold tracking-tight sm:text-5xl">{p.title}</h1>
            <p className="mt-5 text-lg leading-relaxed text-fg-3">{p.subtitle}</p>
          </div>
          <div className="mt-12"><PricingCards copy={copy} lang={lang} /></div>
        </Container>
      </section>

      <section className="border-y border-line bg-surface-2 py-20" aria-labelledby="included-title">
        <Container>
          <h2 id="included-title" className="text-center text-2xl font-semibold tracking-tight">{p.included.title}</h2>
          <ul className="mx-auto mt-10 grid max-w-4xl gap-x-8 gap-y-4 sm:grid-cols-2">
            {p.included.items.map((i) => <li key={i} className="flex items-start gap-2.5 text-fg-2"><Check className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />{i}</li>)}
          </ul>
        </Container>
      </section>

      <section className="py-20" aria-labelledby="compare-title">
        <Container>
          <h2 id="compare-title" className="text-center text-2xl font-semibold tracking-tight">{p.compare.title}</h2>
          <div className="mt-10 overflow-x-auto rounded-2xl border border-line">
            <table className="w-full min-w-[720px] text-sm">
              <caption className="sr-only">{p.compare.caption}</caption>
              <thead className="bg-surface-2">
                <tr>
                  <th scope="col" className="px-4 py-3 text-start font-semibold">{p.compare.feature}</th>
                  {plans.map((pl) => (
                    <th key={pl.code} scope="col" className="px-3 py-3 text-center font-semibold">
                      <span className="block">{p.families[pl.family].name}</span>
                      <span className="block text-xs font-normal text-fg-3">{pl.tier === 'pro' ? p.pro : p.starter}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                <Row label={p.compare.labels.price} values={plans.map((pl) => `${price(pl.monthly, lang)} ${p.plusVat}`)} />
                <Row label={p.compare.labels.requests} values={plans.map((pl) => (pl.limits.requests ? String(pl.limits.requests) : dash))} />
                <Row label={p.compare.labels.envelopes} values={plans.map((pl) => (pl.limits.envelopes ? String(pl.limits.envelopes) : dash))} />
                <Row label={p.compare.labels.storage} values={plans.map((pl) => `${pl.limits.storageGb} GB`)} />
                <Row label={p.compare.labels.seats} values={plans.map((pl) => String(pl.limits.seats))} />
              </tbody>
            </table>
          </div>
        </Container>
      </section>

      <section className="border-t border-line bg-surface-2 py-20" aria-labelledby="extras-title">
        <Container>
          <div className="mx-auto max-w-2xl text-center">
            <h2 id="extras-title" className="text-2xl font-semibold tracking-tight">{p.extras.title}</h2>
            <p className="mt-3 text-fg-3">{p.extras.subtitle}</p>
          </div>
          <div className="mx-auto mt-10 grid max-w-4xl gap-6 md:grid-cols-2">
            <ExtraList title={p.extras.addonsTitle} rows={catalog.addons.map((a) => [p.extras.addons[a.code], `${price(a.monthly, lang)} ${p.extras.perMonth}`])} />
            <ExtraList title={p.extras.packsTitle} rows={catalog.packs.map((k) => [p.extras.packs[k.code], `${price(k.price, lang)} ${p.extras.oneTime}`])} />
          </div>
          <div className="mx-auto mt-8 flex max-w-4xl items-start gap-4 rounded-2xl border border-brand-200 bg-white p-6">
            <Gauge className="mt-0.5 size-6 shrink-0 text-brand-600" aria-hidden />
            <div><h3 className="font-semibold">{p.fair.title}</h3><p className="mt-1 text-sm leading-relaxed text-fg-3">{p.fair.body}</p></div>
          </div>
          <p className="mt-6 text-center text-xs text-fg-4">{p.provisional}</p>
        </Container>
      </section>

      <section className="py-20" aria-labelledby="pricing-faq-title">
        <Container className="max-w-3xl">
          <h2 id="pricing-faq-title" className="text-center text-2xl font-semibold tracking-tight">{copy.faq.title}</h2>
          <Faq items={p.faq} />
        </Container>
      </section>

      <FinalCta copy={copy} lang={lang} />
    </Layout>
  )
}

function Row({ label, values }: { label: string; values: string[] }) {
  return (
    <tr>
      <th scope="row" className="px-4 py-3 text-start font-medium text-fg-2">{label}</th>
      {values.map((v, i) => <td key={i} className="px-3 py-3 text-center tabular text-fg">{v}</td>)}
    </tr>
  )
}

function ExtraList({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-6">
      <h3 className="font-semibold">{title}</h3>
      <ul className="mt-4 divide-y divide-line">
        {rows.map(([a, b]) => <li key={a} className="flex items-center justify-between gap-4 py-3 text-sm"><span className="text-fg-2">{a}</span><span className="shrink-0 font-semibold tabular">{b}</span></li>)}
      </ul>
    </div>
  )
}
