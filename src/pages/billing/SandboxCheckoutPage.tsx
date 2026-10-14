import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { FlaskConical, Lock } from 'lucide-react'
import { useI18n } from '@/contexts/I18nContext'
import { useApi } from '@/hooks/useApi'
import { billingApi } from '@/services'
import { money } from '@/lib/billing'
import { cn } from '@/lib/utils'
import { Logo } from '@/components/brand/Logo'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { DetailRow } from '@/components/ui/Card'
import { EmptyState, ListSkeleton } from '@/components/ui/States'

/**
 * Stand-in for the payment provider's hosted page when BILLING_PROVIDER is
 * 'sandbox' (development, tests, staging). Clearly labelled; collects no card.
 */
export default function SandboxCheckoutPage() {
  const { ref = '' } = useParams()
  const { t, language } = useI18n()
  const { data, error } = useApi(`sandbox:${ref}`, () => billingApi.sandboxPage(ref))
  const [card, setCard] = useState('success')
  const [busy, setBusy] = useState<string | null>(null)

  const complete = async (choice: string) => {
    setBusy(choice)
    try {
      const r = await billingApi.sandboxComplete(ref, choice)
      window.location.assign(r.returnUrl)
    } catch {
      setBusy(null)
    }
  }

  return (
    <div className="min-h-dvh bg-canvas">
      <div className="bg-warning px-4 py-2 text-center text-sm font-semibold text-white dark:text-fg-inverse" role="note">
        <FlaskConical className="me-1.5 inline size-4 align-[-3px]" aria-hidden />{t('billing.sandbox.badge')} — {t('billing.sandbox.hint')}
      </div>
      <main className="mx-auto max-w-md px-4 py-10">
        <Logo className="mb-6 h-8" />
        <Card className="p-6">
          {error ? <EmptyState compact title={t('billing.sandbox.notFound')} /> : !data ? <ListSkeleton rows={4} /> : data.status !== 'pending' ? <EmptyState compact title={t('billing.sandbox.notFound')} /> : (
            <>
              <h1 className="text-xl font-semibold">{t('billing.sandbox.title')}</h1>
              <p className="mt-1 text-sm text-fg-3">{t('billing.sandbox.for', { workspace: data.workspace })}</p>
              {data.operation !== 'CreateTokenOnly' && (
                <dl className="mt-5 divide-y divide-line">
                  <DetailRow label={t('billing.action.subtotal')}>{money(data.subtotal, language)}</DetailRow>
                  <DetailRow label={t('billing.action.vat', { rate: 18 })}>{money(data.vat, language)}</DetailRow>
                  <DetailRow label={<span className="font-semibold text-fg">{t('billing.action.total')}</span>}>{money(data.amount, language)}</DetailRow>
                </dl>
              )}
              <fieldset className="mt-5">
                <legend className="mb-2 text-sm font-medium text-fg-2">{t('billing.sandbox.card')}</legend>
                <div className="space-y-2">
                  {data.cards.map((c) => (
                    <label key={c} className={cn('flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm', card === c ? 'border-brand-500 bg-brand-soft' : 'border-line')}>
                      <input type="radio" name="card" value={c} checked={card === c} onChange={() => setCard(c)} className="accent-brand-600" />
                      <span className="font-mono text-xs text-fg-3" dir="ltr">{c === 'decline' ? '4000 0000 0000 0002' : c === 'renewal_decline' ? '4000 0000 0000 0341' : '4242 4242 4242 4242'}</span>
                      <span className="text-fg-2">{t(`billing.sandbox.cards.${c}`)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <Button className="mt-6" variant="primary" size="lg" fullWidth icon={<Lock className="size-4" />} loading={busy === card} disabled={Boolean(busy)} onClick={() => complete(card)}>
                {data.operation === 'CreateTokenOnly' ? t('billing.sandbox.save') : t('billing.sandbox.pay', { amount: money(data.amount, language) })}
              </Button>
              <Button className="mt-2" variant="ghost" fullWidth disabled={Boolean(busy)} onClick={() => complete('cancel')}>{t('billing.sandbox.cancel')}</Button>
            </>
          )}
        </Card>
      </main>
    </div>
  )
}
