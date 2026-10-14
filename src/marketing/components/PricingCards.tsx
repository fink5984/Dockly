import { Check, FileSignature, FolderInput, Layers, Minus } from 'lucide-react'
import { catalog, formatMoney, intervalPrice, suiteSavings, type Interval, type Plan } from '@shared/billing/pricing.mjs'
import type { MarketingCopy } from '../copy/types'
import type { MarketingLang } from '../routes'

const FAMILIES = ['collect', 'sign', 'suite'] as const
const ICONS = { collect: FolderInput, sign: FileSignature, suite: Layers }
const TIERS: Plan['tier'][] = ['starter', 'pro']
const INTERVALS: Interval[] = ['month', 'year']

export const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''))
export const price = (minor: number, lang: MarketingLang) => formatMoney(minor, { locale: lang === 'he' ? 'he-IL' : 'en-IL' })
const planOf = (family: string, tier: string) => catalog.plans.find((p) => p.family === family && p.tier === tier)!

/**
 * Pricing cards for every tier × interval, all present in the HTML (crawlable,
 * works without JS). The toggles only switch which variant is visible via the
 * data-interval / data-tier attributes on the wrapper (see marketing.css).
 */
export function PricingCards({ copy, lang, showToggles = true }: { copy: MarketingCopy; lang: MarketingLang; showToggles?: boolean }) {
  const p = copy.pricing
  const savings = suiteSavings()
  return (
    <div className="mk-pricing" data-interval="month" data-tier="starter">
      {showToggles && (
        <div className="mb-8 flex flex-wrap items-center justify-center gap-3">
          <Toggle name="tier" label={p.tierLabel} options={[['starter', p.starter], ['pro', p.pro]]} />
          <div className="flex items-center gap-2">
            <Toggle name="interval" label={p.intervalLabel} options={[['month', p.monthly], ['year', p.yearly]]} />
            <span className="rounded-full bg-success-soft px-2.5 py-1 text-xs font-semibold text-success-fg">{p.yearlySave}</span>
          </div>
        </div>
      )}
      <ul className="grid gap-5 lg:grid-cols-3">
        {FAMILIES.map((family) => {
          const Icon = ICONS[family]
          const best = family === 'suite'
          return (
            <li key={family} className={`relative flex flex-col rounded-2xl border bg-white p-6 shadow-sm ${best ? 'border-brand-500 ring-1 ring-brand-500 lg:-my-2 lg:py-8' : 'border-line'}`}>
              {best && <span className="absolute -top-3 start-6 rounded-full bg-brand-600 px-3 py-1 text-xs font-semibold text-white">{p.bestValue}</span>}
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><Icon className="size-5" aria-hidden /></span>
                <h3 className="text-lg font-semibold text-fg">{p.families[family].name}</h3>
              </div>
              <p className="mt-3 min-h-12 text-sm leading-relaxed text-fg-3">{p.families[family].desc}</p>
              {TIERS.map((tier) => {
                const plan = planOf(family, tier)
                return (
                  <div key={tier} data-only-tier={tier} className="flex flex-1 flex-col">
                    {INTERVALS.map((interval) => {
                      const monthly = interval === 'year' ? Math.round(intervalPrice(plan.monthly, 'year') / 12) : plan.monthly
                      return (
                        <div key={interval} data-only-interval={interval} className="mt-5">
                          <p className="flex items-baseline gap-1.5">
                            <span className="text-4xl font-semibold tracking-tight tabular">{price(monthly, lang)}</span>
                            <span className="text-sm text-fg-3">{p.perMonth} {p.plusVat}</span>
                          </p>
                          <p className="mt-1 min-h-5 text-xs text-fg-3">
                            {interval === 'year' ? fill(p.billedYearly, { amount: price(intervalPrice(plan.monthly, 'year'), lang) }) : best && savings[plan.code] ? fill(p.save, { amount: price(savings[plan.code], lang) }) : ''}
                          </p>
                        </div>
                      )
                    })}
                    <ul className="mt-5 flex-1 space-y-2.5 text-sm">
                      <Item ok={plan.limits.requests > 0}>{plan.limits.requests > 0 ? fill(p.limits.requests, { n: plan.limits.requests }) : p.limits.noRequests}</Item>
                      <Item ok={plan.limits.envelopes > 0}>{plan.limits.envelopes > 0 ? fill(p.limits.envelopes, { n: plan.limits.envelopes }) : p.limits.noEnvelopes}</Item>
                      <Item ok>{fill(p.limits.storage, { n: plan.limits.storageGb })}</Item>
                      <Item ok>{fill(p.limits.seats, { n: plan.limits.seats })}</Item>
                    </ul>
                    {INTERVALS.map((interval) => (
                      <a
                        key={interval}
                        data-only-interval={interval}
                        data-plan={plan.code}
                        data-plan-interval={interval}
                        href={`/auth/signup?lang=${lang}&plan=${plan.code}&interval=${interval}`}
                        className={`mt-6 inline-flex h-11 items-center justify-center rounded-full px-5 text-sm font-semibold ${best ? 'bg-brand-600 text-white hover:bg-brand-700' : 'border border-line-2 bg-white text-fg hover:bg-surface-2'}`}
                      >
                        {p.cta}
                      </a>
                    ))}
                  </div>
                )
              })}
            </li>
          )
        })}
      </ul>
      <p className="mt-6 text-center text-sm text-fg-3">{p.trialNote} {p.provisional}</p>
    </div>
  )
}

function Toggle({ name, label, options }: { name: string; label: string; options: [string, string][] }) {
  return (
    <div role="radiogroup" aria-label={label} data-toggle={name} className="inline-flex rounded-lg border border-line-2 bg-surface-3 p-1">
      {options.map(([value, text], i) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={i === 0}
          data-value={value}
          className="h-8 rounded-md px-3.5 text-sm font-medium text-fg-3 aria-checked:bg-white aria-checked:text-fg aria-checked:shadow-xs"
        >
          {text}
        </button>
      ))}
    </div>
  )
}

function Item({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className={`flex items-start gap-2.5 ${ok ? 'text-fg-2' : 'text-fg-4'}`}>
      {ok ? <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : <Minus className="mt-0.5 size-4 shrink-0" aria-hidden />}
      <span>{children}</span>
    </li>
  )
}
