import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Gauge, HardDrive, Lock, PackagePlus, Users } from 'lucide-react'
import { onPaymentRequired, type ApiError } from '@/lib/api'
import { useI18n } from '@/contexts/I18nContext'
import { useAuth } from '@/contexts/AuthContext'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'

const ICON: Record<string, typeof Gauge> = {
  quota_exceeded: Gauge, plan_required: PackagePlus, subscription_inactive: Lock, storage_limit_reached: HardDrive, seat_limit_reached: Users,
}

/**
 * Explains a plan limit the server refused an action for (HTTP 402) and
 * offers the right next step. Mounted once in the app shell.
 */
export function UpgradeDialog() {
  const [err, setErr] = useState<ApiError | null>(null)
  const { t, fmt } = useI18n()
  const { can, refresh } = useAuth()
  const navigate = useNavigate()
  const owner = can('owner')

  useEffect(() => onPaymentRequired((e) => {
    setErr(e)
    refresh() // the banner and gating catch up with the server's view
  }), [refresh])

  if (!err) return null
  const d = (err.details || {}) as { metric?: string; limit?: number; resetsAt?: string; product?: string; status?: string; seats?: number }
  const code = ICON[err.code] ? err.code : 'subscription_inactive'
  const Icon = ICON[code]

  let body = ''
  if (code === 'quota_exceeded') body = t(`billing.upgrade.quota_exceeded.${d.metric === 'envelopes' ? 'envelopes' : 'requests'}`, { limit: d.limit, date: fmt.date(d.resetsAt) })
  else if (code === 'plan_required') body = t(`billing.upgrade.plan_required.${d.product === 'collect' ? 'collect' : 'sign'}`)
  else if (code === 'subscription_inactive') body = t(`billing.upgrade.subscription_inactive.${d.status === 'suspended' ? 'suspended' : d.status === 'canceled' ? 'canceled' : 'expired'}`)
  else if (code === 'seat_limit_reached') body = t('billing.upgrade.seat_limit_reached.body', { seats: d.seats })
  else body = t('billing.upgrade.storage_limit_reached.body')

  const go = (hash = '') => { setErr(null); navigate(`/app/billing${hash}`) }
  const close = () => setErr(null)

  return (
    <Dialog
      open
      onClose={close}
      size="sm"
      title={
        <span className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-brand-soft text-brand-600"><Icon className="size-4" /></span>
          {t(`billing.upgrade.${code}.title`)}
        </span>
      }
      footer={
        <>
          <Button variant="ghost" onClick={close}>{t('billing.upgrade.later')}</Button>
          {owner && code === 'quota_exceeded' && <Button onClick={() => go('#usage')}>{t('billing.upgrade.buyPack')}</Button>}
          {owner && <Button variant="primary" onClick={() => go(d.status === 'suspended' ? '#payment' : '#plans')}>{t('billing.upgrade.seePlans')}</Button>}
        </>
      }
    >
      <p className="text-sm text-fg-2">{body}</p>
      {!owner && <p className="mt-3 rounded-md bg-surface-2 px-3 py-2 text-sm text-fg-3">{t('billing.upgrade.askOwner')}</p>}
    </Dialog>
  )
}
