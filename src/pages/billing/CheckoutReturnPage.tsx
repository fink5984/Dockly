import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react'
import { useI18n } from '@/contexts/I18nContext'
import { useAuth } from '@/contexts/AuthContext'
import { billingApi } from '@/services'
import { invalidate } from '@/hooks/useApi'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import type { CheckoutSession } from '@/types/billing'

type View = 'checking' | 'success' | 'failed' | 'canceled' | 'slow'

/**
 * Landing page after the hosted payment page. The redirect proves nothing:
 * this page asks the server, which asks the payment provider directly, and
 * only shows success once the server has applied a verified payment.
 */
export default function CheckoutReturnPage() {
  const { t } = useI18n()
  const { refresh } = useAuth()
  const [params] = useSearchParams()
  const sessionId = params.get('session') || ''
  const returned = params.get('result')
  const [view, setView] = useState<View>(returned === 'canceled' ? 'canceled' : 'checking')
  const [session, setSession] = useState<CheckoutSession | null>(null)
  const stopped = useRef(false)

  useEffect(() => {
    if (!sessionId || view === 'canceled') return
    stopped.current = false
    const started = Date.now()
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const s = await billingApi.syncSession(sessionId)
        setSession(s)
        if (s.status === 'completed') {
          setView('success')
          invalidate('billing')
          await refresh()
          return
        }
        if (s.status === 'failed' || s.status === 'expired' || s.status === 'canceled') { setView('failed'); return }
      } catch { /* keep polling; the reconciler also catches up */ }
      if (stopped.current) return
      if (Date.now() - started > 60_000) { setView('slow'); return }
      timer = setTimeout(poll, Date.now() - started < 10_000 ? 1500 : 4000)
    }
    poll()
    return () => { stopped.current = true; clearTimeout(timer) }
  }, [sessionId, view, refresh])

  const successText = session?.kind === 'payment_method' ? t('billing.return.successCard') : session?.kind === 'pack' ? t('billing.return.successPack') : t('billing.return.successSubscribe')
  const content: Record<View, { icon: React.ReactNode; title: string; body: string }> = {
    checking: { icon: <Loader2 className="size-7 animate-spin text-brand-600" />, title: t('billing.return.checking'), body: t('billing.return.checkingHint') },
    slow: { icon: <Clock className="size-7 text-warning" />, title: t('billing.return.checking'), body: t('billing.return.slow') },
    success: { icon: <CheckCircle2 className="size-7 text-success" />, title: t('billing.return.success'), body: successText },
    failed: { icon: <XCircle className="size-7 text-danger" />, title: t('billing.return.failed'), body: t('billing.return.failedHint') },
    canceled: { icon: <XCircle className="size-7 text-fg-3" />, title: t('billing.return.canceled'), body: t('billing.return.canceledHint') },
  }
  const c = content[view]
  return (
    <div className="mx-auto max-w-md py-10">
      <Card className="px-6 py-10 text-center">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-surface-2" aria-hidden>{c.icon}</div>
        <div role="status" aria-live="polite">
          <h1 className="text-xl font-semibold text-fg">{c.title}</h1>
          <p className="mt-2 text-sm text-fg-3">{c.body}</p>
        </div>
        <div className="mt-6 flex justify-center gap-2">
          {(view === 'failed' || view === 'canceled') && <Button to="/app/billing#plans" variant="primary">{t('billing.return.retry')}</Button>}
          <Button to="/app/billing" variant={view === 'success' ? 'primary' : 'secondary'}>{t('billing.return.back')}</Button>
        </div>
      </Card>
    </div>
  )
}
