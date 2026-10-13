import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useI18n } from '@/contexts/I18nContext'
import { useAuth } from '@/contexts/AuthContext'
import { ApiError } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import { AuthShell, PasswordInput } from './AuthShell'

export default function SignInPage() {
  const { t } = useI18n()
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await signIn(email.trim(), password)
      const from = (location.state as { from?: string } | null)?.from
      navigate(from && from.startsWith('/') && !from.startsWith('//') ? from : '/', { replace: true })
    } catch (err) {
      const code = err instanceof ApiError ? err.code : ''
      setError(code === 'account_locked' || code === 'rate_limited' ? t('auth.locked') : code === 'invalid_credentials' ? t('auth.invalidCredentials') : t('common.loadFailedHint'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell
      title={t('auth.welcomeBack')}
      subtitle={t('auth.signInSubtitle')}
      footer={<>{t('auth.noAccount')} <Link to="/auth/signup" className="font-medium text-brand-600 hover:text-brand-700">{t('auth.signUp')}</Link></>}
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <div role="alert" className="rounded-md border border-danger/20 bg-danger-soft px-3 py-2.5 text-sm text-danger-fg">{error}</div>}
        <Input label={t('auth.email')} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} inputSize="lg" autoFocus />
        <PasswordInput
          label={t('auth.password')}
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          inputSize="lg"
        />
        <div className="flex justify-end">
          <Link to="/auth/forgot-password" className="text-sm font-medium text-brand-600 hover:text-brand-700">{t('auth.forgot')}</Link>
        </div>
        <Button type="submit" variant="primary" size="lg" fullWidth loading={busy} disabled={!email || !password}>{t('auth.signIn')}</Button>
      </form>
    </AuthShell>
  )
}
