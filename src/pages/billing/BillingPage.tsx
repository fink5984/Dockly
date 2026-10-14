import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { CreditCard, ExternalLink, FileText, FlaskConical, Info, Minus, Plus, ShieldCheck } from 'lucide-react'
import type { Interval, Plan } from '@shared/billing/pricing.mjs'
import { useI18n } from '@/contexts/I18nContext'
import { useAuth } from '@/contexts/AuthContext'
import { useApp } from '@/contexts/AppContext'
import { useApi } from '@/hooks/useApi'
import { billingApi } from '@/services'
import { cn } from '@/lib/utils'
import {
  catalog, changeKind, currentAddons, daysUntil, findPlan, money, previewCharge, readPlanIntent, recommendedFamily, statusTone,
} from '@/lib/billing'
import type { BillingState } from '@/types/billing'
import { PageHeader } from '@/components/ui/Misc'
import { Card, CardBody, CardHeader, DetailRow } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Dialog, ConfirmDialog } from '@/components/ui/Dialog'
import { Input, Select } from '@/components/ui/Field'
import { ErrorState, ListSkeleton, ProgressBar, EmptyState } from '@/components/ui/States'
import { PlanPicker } from '@/components/billing/PlanPicker'

const GB = 1024 ** 3

export default function BillingPage() {
  const { t, fmt } = useI18n()
  const { can, refresh } = useAuth()
  const { toast, toastError } = useApp()
  const owner = can('owner')
  const { data, error, refetch } = useApi<BillingState>('billing', billingApi.state, { topics: ['billing'] })
  const [params] = useSearchParams()
  const { hash } = useLocation()
  const intent = useMemo(() => ({ plan: params.get('plan') || readPlanIntent().plan, interval: (params.get('interval') || readPlanIntent().interval) as Interval | undefined }), [params])

  const [interval, setInterval] = useState<Interval>(intent.interval === 'year' ? 'year' : 'month')
  const [tier, setTier] = useState<Plan['tier']>(findPlan(intent.plan || '')?.tier || 'starter')
  const [confirm, setConfirm] = useState<Plan | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const synced = useRef(false)

  // Start from the workspace's current plan once it's known.
  useEffect(() => {
    if (!data || synced.current) return
    synced.current = true
    const current = findPlan(data.subscription.planCode || '')
    if (current && !intent.plan) setTier(current.tier)
    if (data.subscription.interval && !intent.interval) setInterval(data.subscription.interval)
  }, [data, intent])

  useEffect(() => {
    if (!data || !hash) return
    document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [data, hash])

  if (error) return <><PageHeader title={t('billing.title')} /><Card><ErrorState onRetry={refetch} /></Card></>
  if (!data) return <><PageHeader title={t('billing.title')} /><Card><ListSkeleton rows={6} /></Card></>

  const s = data.subscription
  const paid = s.status === 'active' || s.status === 'past_due'
  const canPay = data.provider.available

  const after = async (fn: () => Promise<unknown>, success?: string) => {
    try {
      await fn()
      if (success) toast({ tone: 'success', title: success })
      await Promise.all([refetch(), refresh()])
    } catch (e) {
      toastError(e, t('common.error'))
      throw e
    }
  }

  return (
    <>
      <PageHeader
        title={t('billing.title')}
        description={t('billing.subtitle')}
        meta={<Badge tone={statusTone[s.status]} dot size="md">{s.status === 'active' && s.cancelAtPeriodEnd ? t('billing.status.canceling', { date: fmt.date(s.currentPeriodEnd) }) : t(`billing.status.${s.status}`)}</Badge>}
      />

      <div className="space-y-6">
        {data.provider.name === 'sandbox' && (
          <Notice icon={<FlaskConical className="size-4" />} tone="warning">{t('billing.provider.sandbox')}</Notice>
        )}
        {!canPay && (
          <Notice icon={<Info className="size-4" />} tone="info">
            {t('billing.provider.disabled')}{' '}
            {data.provider.salesEmail && <a className="font-semibold underline" href={`mailto:${data.provider.salesEmail}`}>{t('billing.provider.contact')}</a>}
          </Notice>
        )}
        {!owner && <Notice icon={<ShieldCheck className="size-4" />} tone="neutral">{t('billing.ownerOnly')}</Notice>}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <CurrentPlan state={data} onClearPending={owner ? () => after(() => billingApi.clearPending()) : undefined} />
          <Usage state={data} owner={owner && canPay} onBuy={(code) => after(async () => {
            const r = await billingApi.buyPack(code)
            if (r.action === 'checkout') window.location.assign(r.redirectUrl)
          }, t('billing.packs.bought'))} />
        </div>

        <section id="plans" className="scroll-mt-24">
          <Card>
            <CardHeader title={t('billing.plans.title')} description={t('billing.plans.subtitle')} />
            <CardBody>
              <PlanPicker
                interval={interval}
                onIntervalChange={setInterval}
                tier={tier}
                onTierChange={setTier}
                recommended={recommendedFamily(s.interest)}
                highlightPlan={intent.plan}
                kindOf={owner && canPay ? (p) => changeKind(data, p.code, interval) : null}
                onChoose={setConfirm}
              />
            </CardBody>
          </Card>
        </section>

        {paid && <Addons state={data} owner={owner && canPay} onSave={(addons) => after(async () => {
          const r = await billingApi.change({ planCode: s.planCode!, interval: s.interval!, addons })
          if (r.action === 'checkout') window.location.assign(r.redirectUrl)
          else if (r.action === 'scheduled') toast({ tone: 'success', title: t('billing.action.scheduled', { date: fmt.date(r.effectiveAt) }) })
          else if (r.action === 'applied') toast({ tone: 'success', title: t('billing.action.applied') })
        })} />}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <PaymentMethod state={data} owner={owner && canPay} />
          <BillingDetails state={data} owner={owner} onSave={(d) => after(() => billingApi.saveDetails(d), t('billing.details.saved'))} />
        </div>

        <Invoices state={data} />

        {owner && s.status === 'active' && (
          <section id="cancel" className="scroll-mt-24">
            <Card>
              <CardHeader
                title={t('billing.cancel.title')}
                description={t('billing.cancel.hint')}
                action={s.cancelAtPeriodEnd
                  ? <Button variant="primary" onClick={() => after(() => billingApi.resume(), t('billing.cancel.resumed')).catch(() => {})}>{t('billing.banner.resume')}</Button>
                  : <Button variant="secondary" onClick={() => setCancelOpen(true)}>{t('billing.cancel.button')}</Button>}
              />
            </Card>
          </section>
        )}
      </div>

      {confirm && (
        <ConfirmChange
          state={data}
          plan={confirm}
          interval={interval}
          onClose={() => setConfirm(null)}
          onDone={() => Promise.all([refetch(), refresh()])}
        />
      )}
      <CancelDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        periodEnd={s.currentPeriodEnd}
        onConfirm={(reason) => after(() => billingApi.cancel(reason), t('billing.cancel.done', { date: fmt.date(s.currentPeriodEnd) }))}
      />
    </>
  )
}

function Notice({ icon, tone, children }: { icon: React.ReactNode; tone: 'warning' | 'info' | 'neutral'; children: React.ReactNode }) {
  const cls = { warning: 'border-warning/25 bg-warning-soft text-warning-fg', info: 'border-info/20 bg-info-soft text-info-fg', neutral: 'border-line bg-surface-2 text-fg-2' }[tone]
  return <div className={cn('flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm', cls)}><span className="mt-0.5 shrink-0" aria-hidden>{icon}</span><p>{children}</p></div>
}

function planName(t: (k: string) => string, code: string | null) {
  const p = findPlan(code || '')
  return p ? `${t(`billing.family.${p.family}`)} · ${t(`billing.tier.${p.tier}`)}` : ''
}

function CurrentPlan({ state, onClearPending }: { state: BillingState; onClearPending?: () => Promise<unknown> }) {
  const { t, fmt, language } = useI18n()
  const s = state.subscription
  const trialDays = daysUntil(s.trialEndsAt)
  const trialTotal = s.trialStartedAt && s.trialEndsAt ? Math.max(1, Math.round((new Date(s.trialEndsAt).getTime() - new Date(s.trialStartedAt).getTime()) / 86_400_000)) : catalog.trial.days
  const nextCharge = s.periodSubtotal ? s.periodSubtotal + Math.round(s.periodSubtotal * catalog.vatRate) : null
  return (
    <Card>
      <CardHeader title={t('billing.current.title')} icon={<CreditCard />} />
      <CardBody className="space-y-4">
        <div>
          <p className="text-lg font-semibold text-fg">
            {s.planCode ? planName(t, s.planCode) : s.status === 'trialing' ? t('billing.current.trial') : s.status === 'legacy' ? t('billing.status.legacy') : t('billing.current.none')}
          </p>
          {s.planCode && s.interval && <p className="text-sm text-fg-3">{t(`billing.interval.${s.interval}`)}</p>}
        </div>
        {s.status === 'trialing' && (
          <div>
            <div className="mb-1.5 flex justify-between text-sm"><span className="text-fg-2">{t('billing.banner.trial', { count: trialDays })}</span><span className="text-fg-3">{t('billing.current.trialEnds', { date: fmt.date(s.trialEndsAt) })}</span></div>
            <ProgressBar value={((trialTotal - trialDays) / trialTotal) * 100} label={t('billing.status.trialing')} />
            <p className="mt-2 text-xs text-fg-3">{t('billing.banner.trialNoCard')}</p>
          </div>
        )}
        {s.status === 'legacy' && <p className="text-sm text-fg-3">{s.legacyUntil ? t('billing.banner.legacyUntil', { date: fmt.date(s.legacyUntil) }) : t('billing.current.legacyHint')}</p>}
        {(s.status === 'active' || s.status === 'past_due') && (
          <dl className="divide-y divide-line">
            <DetailRow label={s.cancelAtPeriodEnd ? t('billing.current.ends', { date: '' }).replace(/\s*$/, '') : t('billing.current.renews', { date: '' }).replace(/\s*$/, '')}>{fmt.date(s.currentPeriodEnd)}</DetailRow>
            {!s.cancelAtPeriodEnd && nextCharge !== null && !s.pending && <DetailRow label={t('billing.current.nextChargeLabel')}>{money(nextCharge, language)}</DetailRow>}
          </dl>
        )}
        {s.status === 'past_due' && <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-fg">{t('billing.banner.pastDue', { date: fmt.date(s.graceEndsAt) })}</p>}
        {s.status === 'suspended' && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-fg">{t('billing.banner.suspended')}</p>}
        {s.status === 'expired' && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-fg">{t('billing.banner.expired')}</p>}
        {s.pending && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-info-soft px-3 py-2 text-sm text-info-fg">
            <span>{t('billing.current.scheduled', { plan: planName(t, s.pending.planCode), interval: t(`billing.interval.${s.pending.interval}`), date: fmt.date(s.currentPeriodEnd) })}</span>
            {onClearPending && <Button size="xs" variant="ghost" onClick={() => onClearPending().catch(() => {})}>{t('billing.current.cancelScheduled')}</Button>}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function Meter({ label, used, limit, format, notIncluded }: { label: string; used: number; limit: number | null; format: (n: number) => string; notIncluded?: boolean }) {
  const { t } = useI18n()
  const pct = limit ? (used / limit) * 100 : 0
  const state = limit === null || notIncluded ? null : pct >= 100 ? 'over' : pct >= 80 ? 'near' : null
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium text-fg-2">{label}</span>
        <span className={cn('tabular', state === 'over' ? 'font-semibold text-danger' : 'text-fg-3')}>
          {notIncluded ? t('billing.usage.notIncluded') : limit === null ? `${format(used)} · ${t('billing.usage.unlimited')}` : t('billing.usage.of', { used: format(used), limit: format(limit) })}
        </span>
      </div>
      {!notIncluded && limit !== null && <ProgressBar value={pct} tone={state ? 'warning' : undefined} label={label} />}
      {state && <p className={cn('mt-1 text-xs', state === 'over' ? 'text-danger' : 'text-warning-fg')}>{t(`billing.usage.${state}`)}</p>}
    </div>
  )
}

function Usage({ state, owner, onBuy }: { state: BillingState; owner: boolean; onBuy: (packCode: string) => Promise<unknown> }) {
  const { t, fmt, language } = useI18n()
  const [busy, setBusy] = useState<string | null>(null)
  const { limits, products } = state.entitlements
  const u = state.usage
  const canBuyPacks = owner && state.subscription.status === 'active'
  const buy = async (code: string) => { setBusy(code); try { await onBuy(code) } catch { /* toasted */ } finally { setBusy(null) } }
  const pack = (code: string) => catalog.packs.find((p) => p.code === code)!
  const packButton = (code: string, metric: 'requests' | 'envelopes') => canBuyPacks && products.includes(pack(code).requiresProduct) && (
    <Button size="xs" variant="subtle" icon={<Plus className="size-3" />} loading={busy === code} onClick={() => buy(code)}>
      {t('billing.usage.addPack', { count: pack(code).grants[metric], price: money(Math.round(pack(code).price * (1 + catalog.vatRate)), language) })}
    </Button>
  )
  return (
    <section id="usage" className="scroll-mt-24">
      <Card className="h-full">
        <CardHeader title={t('billing.usage.title')} description={t('billing.usage.resets', { date: fmt.date(u.windowEnd) })} />
        <CardBody className="space-y-5">
          <div className="space-y-2">
            <Meter label={t('billing.usage.requests')} used={u.requests} limit={limits.requests} format={fmt.number} notIncluded={!products.includes('collect')} />
            {packButton('requests_25', 'requests')}
          </div>
          <div className="space-y-2">
            <Meter label={t('billing.usage.envelopes')} used={u.envelopes} limit={limits.envelopes} format={fmt.number} notIncluded={!products.includes('sign')} />
            {packButton('envelopes_25', 'envelopes')}
          </div>
          <Meter label={t('billing.usage.storage')} used={u.storageBytes} limit={limits.storageBytes} format={(n) => (n >= GB ? `${fmt.number(Math.round((n / GB) * 10) / 10)} GB` : fmt.bytes(n))} />
          <Meter label={t('billing.usage.seats')} used={u.seats} limit={limits.seats} format={fmt.number} />
          {canBuyPacks && <p className="text-xs text-fg-4">{t('billing.usage.packHint')}</p>}
        </CardBody>
      </Card>
    </section>
  )
}

function Addons({ state, owner, onSave }: { state: BillingState; owner: boolean; onSave: (addons: Record<string, number>) => Promise<unknown> }) {
  const { t, language } = useI18n()
  const initial = currentAddons(state)
  const [qty, setQty] = useState<Record<string, number>>(initial)
  const [busy, setBusy] = useState(false)
  const dirty = catalog.addons.some((a) => (qty[a.code] || 0) !== (initial[a.code] || 0))
  const per = state.subscription.interval === 'year' ? t('billing.perYear') : t('billing.perMonth')
  return (
    <Card>
      <CardHeader title={t('billing.addons.title')} description={t('billing.addons.subtitle')} />
      <CardBody>
        <ul className="divide-y divide-line">
          {catalog.addons.map((a) => {
            const q = qty[a.code] || 0
            const unit = state.subscription.interval === 'year' ? a.monthly * catalog.yearlyMonthsCharged : a.monthly
            return (
              <li key={a.code} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-medium text-fg">{t(`billing.addons.${a.code}`)}</p>
                  <p className="text-xs text-fg-3">{t('billing.addons.each', { price: money(unit, language), per })} {t('billing.plusVat')}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="secondary" aria-label="−" disabled={!owner || q <= 0} onClick={() => setQty({ ...qty, [a.code]: q - 1 })} icon={<Minus className="size-3.5" />} />
                  <span className="w-8 text-center text-sm font-semibold tabular" aria-live="polite">{q}</span>
                  <Button size="sm" variant="secondary" aria-label="+" disabled={!owner || q >= a.max} onClick={() => setQty({ ...qty, [a.code]: q + 1 })} icon={<Plus className="size-3.5" />} />
                </div>
              </li>
            )
          })}
        </ul>
        {owner && dirty && (
          <div className="mt-3 flex justify-end">
            <Button variant="primary" loading={busy} onClick={async () => { setBusy(true); try { await onSave(qty) } catch { /* toasted */ } finally { setBusy(false) } }}>{t('billing.addons.update')}</Button>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function PaymentMethod({ state, owner }: { state: BillingState; owner: boolean }) {
  const { t } = useI18n()
  const { toastError } = useApp()
  const [busy, setBusy] = useState(false)
  const pm = state.subscription.paymentMethod
  const update = async () => {
    setBusy(true)
    try {
      const r = await billingApi.updatePaymentMethod()
      window.location.assign(r.redirectUrl)
    } catch (e) {
      toastError(e, t('common.error'))
      setBusy(false)
    }
  }
  return (
    <section id="payment" className="scroll-mt-24">
      <Card className="h-full">
        <CardHeader title={t('billing.payment.title')} icon={<CreditCard />} />
        <CardBody className="space-y-3">
          {pm ? (
            <div className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5">
              <span className="flex h-8 w-11 items-center justify-center rounded-md bg-surface-3 text-2xs font-bold uppercase text-fg-2">{pm.brand || 'Card'}</span>
              <div className="text-sm">
                <p className="font-medium text-fg" dir="ltr">•••• {pm.last4}</p>
                {pm.expMonth && pm.expYear && <p className="text-xs text-fg-3">{t('billing.payment.expires', { month: String(pm.expMonth).padStart(2, '0'), year: pm.expYear })}</p>}
              </div>
            </div>
          ) : <p className="text-sm text-fg-3">{t('billing.payment.none')}</p>}
          <p className="flex items-start gap-1.5 text-xs text-fg-4"><ShieldCheck className="mt-px size-3.5 shrink-0" />{t('billing.payment.secure')}</p>
          {owner && (pm || state.subscription.status === 'past_due' || state.subscription.status === 'suspended') && (
            <Button loading={busy} onClick={update}>{pm ? t('billing.payment.update') : t('billing.payment.add')}</Button>
          )}
        </CardBody>
      </Card>
    </section>
  )
}

function BillingDetails({ state, owner, onSave }: { state: BillingState; owner: boolean; onSave: (d: { name: string; email: string; taxId: string }) => Promise<unknown> }) {
  const { t } = useI18n()
  const [form, setForm] = useState(state.subscription.billingDetails)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const dirty = JSON.stringify(form) !== JSON.stringify(state.subscription.billingDetails)
  return (
    <Card className="h-full">
      <CardHeader title={t('billing.details.title')} icon={<FileText />} />
      <CardBody>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault()
            if (form.taxId && !/^\d{5,12}$/.test(form.taxId)) { setErr(t('billing.details.taxIdHint')); return }
            setBusy(true)
            try { await onSave(form) } catch { /* toasted */ } finally { setBusy(false) }
          }}
        >
          <Input label={t('billing.details.name')} value={form.name} disabled={!owner} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label={t('billing.details.email')} type="email" dir="ltr" value={form.email} disabled={!owner} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input label={t('billing.details.taxId')} inputMode="numeric" dir="ltr" value={form.taxId} disabled={!owner} error={err} hint={t('billing.details.taxIdHint')} onChange={(e) => { setErr(''); setForm({ ...form, taxId: e.target.value.replace(/\D/g, '') }) }} />
          {owner && <Button type="submit" disabled={!dirty} loading={busy}>{t('common.save')}</Button>}
        </form>
      </CardBody>
    </Card>
  )
}

function Invoices({ state }: { state: BillingState }) {
  const { t, fmt, language } = useI18n()
  const tone = { paid: 'success', pending: 'warning', failed: 'danger', void: 'neutral', refunded: 'neutral' } as const
  return (
    <Card>
      <CardHeader title={t('billing.invoices.title')} />
      {state.invoices.length === 0 ? <EmptyState compact icon={<FileText />} title={t('billing.invoices.empty')} /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{t('billing.invoices.title')}</caption>
            <thead className="border-y border-line bg-surface-2 text-xs text-fg-3">
              <tr>
                <th scope="col" className="px-5 py-2 text-start font-medium">{t('billing.invoices.number')}</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">{t('billing.invoices.date')}</th>
                <th scope="col" className="hidden px-3 py-2 text-start font-medium sm:table-cell">{t('billing.invoices.description')}</th>
                <th scope="col" className="px-3 py-2 text-end font-medium">{t('billing.invoices.amount')}</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">{t('billing.invoices.status')}</th>
                <th scope="col" className="px-5 py-2"><span className="sr-only">{t('billing.invoices.view')}</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {state.invoices.map((i) => (
                <tr key={i.id}>
                  <td className="px-5 py-3 font-medium tabular" dir="ltr">{i.number}</td>
                  <td className="px-3 py-3 text-fg-2">{fmt.date(i.paidAt || i.createdAt)}</td>
                  <td className="hidden px-3 py-3 text-fg-2 sm:table-cell">{t(`billing.invoices.kind.${i.kind}`)}</td>
                  <td className="px-3 py-3 text-end font-medium tabular">{money(i.total, language)}</td>
                  <td className="px-3 py-3"><Badge tone={tone[i.status]}>{t(`billing.invoices.st.${i.status}`)}</Badge></td>
                  <td className="px-5 py-3 text-end">
                    <span className="inline-flex items-center gap-3">
                      <Link to={`/app/billing/invoices/${i.id}`} className="font-medium text-brand-600 hover:underline">{t('billing.invoices.view')}</Link>
                      {i.documentUrl && <a href={i.documentUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-fg-3 hover:text-fg-2">{t('billing.invoices.taxDoc')}<ExternalLink className="size-3" /></a>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function ConfirmChange({ state, plan, interval, onClose, onDone }: { state: BillingState; plan: Plan; interval: Interval; onClose: () => void; onDone: () => Promise<unknown> }) {
  const { t, fmt, language } = useI18n()
  const { toast, toastError } = useApp()
  const [busy, setBusy] = useState(false)
  // One key per dialog: a double click or a retry reuses the same checkout.
  const key = useMemo(() => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())), [])
  const addons = currentAddons(state)
  const preview = previewCharge(state, plan.code, interval, addons)
  const trialDays = state.subscription.status === 'trialing' ? daysUntil(state.subscription.trialEndsAt) : 0
  const confirmLabel = preview.kind === 'subscribe' ? t('billing.action.confirmSubscribe') : preview.kind === 'upgrade' ? t('billing.action.confirmUpgrade', { amount: money(preview.total, language) }) : t('billing.action.confirmSchedule')

  const go = async () => {
    setBusy(true)
    try {
      const r = await billingApi.change({ planCode: plan.code, interval, addons }, key)
      if (r.action === 'checkout') {
        toast({ tone: 'info', title: t('billing.action.redirecting') })
        window.location.assign(r.redirectUrl)
        return
      }
      if (r.action === 'applied') toast({ tone: 'success', title: t('billing.action.applied') })
      else if (r.action === 'processing') toast({ tone: 'info', title: t('billing.action.processing') })
      else if (r.action === 'scheduled') toast({ tone: 'success', title: t('billing.action.scheduled', { date: fmt.date(r.effectiveAt) }) })
      else toast({ tone: 'info', title: t('billing.action.noChange') })
      await onDone()
      onClose()
    } catch (e) {
      toastError(e, t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('billing.action.confirmTitle')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={busy} onClick={go}>{confirmLabel}</Button></>}
    >
      <div className="space-y-4 text-sm">
        <div className="rounded-lg border border-line p-3">
          <p className="font-semibold text-fg">{t(`billing.family.${plan.family}`)} · {t(`billing.tier.${plan.tier}`)}</p>
          <p className="text-fg-3">{t(`billing.interval.${interval}`)} · {money(preview.full.subtotal, language)} {interval === 'year' ? t('billing.perYear') : t('billing.perMonth')} {t('billing.plusVat')}</p>
        </div>
        {preview.kind !== 'schedule' && (
          <dl className="divide-y divide-line">
            <DetailRow label={t('billing.action.subtotal')}>{money(preview.subtotal, language)}</DetailRow>
            <DetailRow label={t('billing.action.vat', { rate: Math.round(catalog.vatRate * 100) })}>{money(preview.vat, language)}</DetailRow>
            <DetailRow label={<span className="font-semibold text-fg">{t('billing.action.dueToday')}</span>}><span className="text-md">{money(preview.total, language)}</span></DetailRow>
          </dl>
        )}
        <p className="text-fg-3">
          {preview.kind === 'subscribe' ? t('billing.action.subscribeHint') : preview.kind === 'upgrade' ? t('billing.action.upgradeHint') : t('billing.action.scheduleHint', { date: fmt.date(state.subscription.currentPeriodEnd) })}
        </p>
        {preview.kind === 'subscribe' && trialDays > 0 && <p className="rounded-md bg-success-soft px-3 py-2 text-success-fg">{t('billing.action.trialCarryOver', { count: trialDays })}</p>}
      </div>
    </Dialog>
  )
}

function CancelDialog({ open, onClose, onConfirm, periodEnd }: { open: boolean; onClose: () => void; onConfirm: (reason?: string) => Promise<unknown>; periodEnd: string | null }) {
  const { t, fmt } = useI18n()
  const [reason, setReason] = useState('')
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      tone="danger"
      title={t('billing.cancel.title')}
      description={`${t('billing.cancel.hint')} ${t('billing.cancel.done', { date: fmt.date(periodEnd) })}`}
      confirmLabel={t('billing.cancel.confirm')}
      onConfirm={async () => { await onConfirm(reason || undefined) }}
    >
      <Select
        label={t('billing.cancel.reason')}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        options={[{ value: '', label: '—' }, ...['too_expensive', 'missing_features', 'not_using', 'switching', 'other'].map((r) => ({ value: r, label: t(`billing.cancel.reasons.${r}`) }))]}
      />
    </ConfirmDialog>
  )
}
