import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/contexts/I18nContext'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Globe, ArrowRight, ArrowLeft } from 'lucide-react'

export function SignUpPage() {
  const { t, language, setLanguage, direction } = useI18n()
  const { signUp } = useAuth()
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', confirm: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const isRtl = direction === 'rtl'
  const Arrow = isRtl ? ArrowLeft : ArrowRight

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (form.password !== form.confirm) {
      setError(t('auth.passwordMismatch') || 'Passwords do not match')
      return
    }
    if (form.password.length < 6) {
      setError(t('auth.passwordTooShort') || 'Password must be at least 6 characters')
      return
    }
    setLoading(true)
    try {
      await signUp(form)
    } catch (err: any) {
      setError(err?.message || 'Sign up failed')
    } finally {
      setLoading(false)
    }
  }

  const update = (field: string, value: string) => setForm(prev => ({ ...prev, [field]: value }))

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[var(--bg-secondary)]" dir={direction}>
      <div className="w-full max-w-md">
        <div className="flex justify-between items-center mb-10">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center text-white font-bold text-sm">D</div>
            <span className="font-semibold">Dockly</span>
          </div>
          <button
            onClick={() => setLanguage(language === 'en' ? 'he' : 'en')}
            className="flex items-center gap-1.5 text-sm text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
          >
            <Globe className="w-4 h-4" />
            {language === 'en' ? 'עברית' : 'English'}
          </button>
        </div>

        <div className="bg-[var(--bg-primary)] rounded-2xl shadow-xl border border-[var(--border-primary)] p-8">
          <h2 className="text-2xl font-bold mb-1">{t('auth.createWorkspace')}</h2>
          <p className="text-[var(--text-tertiary)] mb-6">{t('auth.signUpSubtitle')}</p>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input label={t('auth.fullName')} value={form.name} onChange={e => update('name', e.target.value)} placeholder="David Cohen" />
            <Input label={t('auth.email')} type="email" value={form.email} onChange={e => update('email', e.target.value)} placeholder="you@company.com" />
            <Input label={t('auth.phone')} type="tel" value={form.phone} onChange={e => update('phone', e.target.value)} placeholder="+972-50-000-0000" />
            <Input label={t('auth.password')} type="password" value={form.password} onChange={e => update('password', e.target.value)} placeholder="••••••••" />
            <Input label={t('auth.confirmPassword')} type="password" value={form.confirm} onChange={e => update('confirm', e.target.value)} placeholder="••••••••" />
            <Button type="submit" loading={loading} className="w-full" size="lg">
              {t('auth.createAccount')} <Arrow className="w-4 h-4" />
            </Button>
          </form>

          <p className="text-center text-sm text-[var(--text-tertiary)] mt-5">
            {t('auth.hasAccount')}{' '}
            <Link to="/auth/signin" className="text-primary-600 font-medium hover:underline">
              {t('auth.signIn')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
