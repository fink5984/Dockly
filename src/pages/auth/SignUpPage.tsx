import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { attribution, rememberPlanIntent, sessionId } from '@/marketing/behaviors'
import { useI18n } from '@/contexts/I18nContext'
import { useAuth } from '@/contexts/AuthContext'
import { ApiError } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import { AuthShell, PasswordInput } from './AuthShell'

export default function SignUpPage() {
  const { t, language, setLanguage } = useI18n()
  const [params] = useSearchParams()
  const { signUp } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  // Arriving from the marketing site: keep the language and the plan the visitor picked.
  useEffect(() => {
    const lang = params.get('lang')
    if (lang === 'he' || lang === 'en') setLanguage(lang)
    const plan = params.get('plan')
    if (plan) rememberPlanIntent(plan, params.get('interval') || 'month')
  }, [params, setLanguage])

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const errs: Record<string, string> = {}
    if (!form.name.trim()) errs.name = t('common.required')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errs.email = t('onboarding.invalidEmail')
    if (form.password.length < 8) errs.password = t('auth.passwordHint')
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      // Non-identifying attribution only (see server/lib/funnel.mjs).
      const plan = params.get('plan')
      const interval = params.get('interval')
      await signUp({ ...form, email: form.email.trim(), language, attribution: { sessionId: sessionId(), ...attribution(), ...(plan ? { plan } : {}), ...(interval ? { interval } : {}) } })
      navigate('/onboarding', { replace: true })
    } catch (err) {
      if (err instanceof ApiError && err.code === 'email_taken') setErrors({ email: t('auth.emailTaken') })
      else if (err instanceof ApiError && err.code === 'weak_password') setErrors({ password: err.message })
      else if (err instanceof ApiError && err.code === 'rate_limited') setErrors({ _: t('auth.locked') })
      else setErrors({ _: t('common.loadFailedHint') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell
      title={t('auth.createTitle')}
      subtitle={t('auth.createSubtitle')}
      footer={<>{t('auth.haveAccount')} <Link to="/auth/signin" className="font-medium text-brand-600 hover:text-brand-700">{t('auth.signIn')}</Link></>}
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {errors._ && <div role="alert" className="rounded-md border border-danger/20 bg-danger-soft px-3 py-2.5 text-sm text-danger-fg">{errors._}</div>}
        <Input label={t('auth.name')} autoComplete="name" required value={form.name} onChange={set('name')} error={errors.name} inputSize="lg" autoFocus />
        <Input label={t('auth.email')} type="email" autoComplete="email" required value={form.email} onChange={set('email')} error={errors.email} inputSize="lg" />
        <Input label={t('auth.phone')} type="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} optionalLabel={t('common.optional')} inputSize="lg" dir="ltr" />
        <PasswordInput label={t('auth.password')} autoComplete="new-password" required value={form.password} onChange={set('password')} error={errors.password} hint={t('auth.passwordHint')} inputSize="lg" />
        <Button type="submit" variant="primary" size="lg" fullWidth loading={busy}>{t('auth.signUp')}</Button>
        <p className="text-center text-xs text-fg-4">
          {t('auth.agreePrefix')}{language === 'he' ? '' : ' '}<a href={language === 'he' ? '/terms' : '/en/terms'} target="_blank" rel="noopener" className="underline hover:text-fg-2">{t('auth.termsLink')}</a>{t('auth.agreeJoin')}<a href={language === 'he' ? '/privacy' : '/en/privacy'} target="_blank" rel="noopener" className="underline hover:text-fg-2">{t('auth.privacyLink')}</a>.
        </p>
        <p className="text-center text-xs font-medium text-success-fg">{t('auth.trialNote')}</p>
      </form>
    </AuthShell>
  )
}
