import { KeyRound } from 'lucide-react'
import { useI18n } from '@/contexts/I18nContext'
import { Button } from '@/components/ui/Button'
import { AuthShell } from './AuthShell'

/** Honest flow: self-service email reset needs an email provider, which may not be configured. */
export default function ForgotPasswordPage() {
  const { t } = useI18n()
  return (
    <AuthShell title={t('auth.forgotTitle')}>
      <div className="rounded-xl border border-line bg-surface p-5 shadow-xs">
        <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-brand-soft text-brand-600"><KeyRound className="size-5" /></div>
        <p className="text-sm leading-relaxed text-fg-2">{t('auth.forgotBody')}</p>
      </div>
      <Button to="/auth/signin" variant="secondary" fullWidth className="mt-6">{t('auth.backToSignIn')}</Button>
    </AuthShell>
  )
}
