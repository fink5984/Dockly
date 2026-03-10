import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/contexts/I18nContext'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { cn } from '@/lib/utils'
import { Globe, FileCheck, ArrowRight, ArrowLeft } from 'lucide-react'

export function SignInPage() {
  const { t, language, setLanguage, direction } = useI18n()
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const isRtl = direction === 'rtl'
  const Arrow = isRtl ? ArrowLeft : ArrowRight

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await signIn(email, password)
    } catch (err: any) {
      setError(err?.message || 'Sign in failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex" dir={direction}>
      {/* Left panel – branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-primary-900 relative overflow-hidden flex-col justify-between p-12 text-white">
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-20">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center font-bold text-lg">D</div>
            <span className="text-xl font-semibold tracking-tight">Dockly</span>
          </div>
          <h1 className="text-4xl font-bold leading-tight mb-4">{t('app.tagline')}</h1>
          <p className="text-lg text-white/70 max-w-md leading-relaxed">{t('app.description')}</p>
          <div className="mt-16 grid grid-cols-2 gap-6">
            {[
              { icon: FileCheck, label: 'Smart document tracking' },
              { icon: FileCheck, label: 'Client case management' },
              { icon: FileCheck, label: 'WhatsApp integration ready' },
              { icon: FileCheck, label: 'Multi-tenant workspaces' },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-3 text-white/80">
                <item.icon className="w-5 h-5 text-primary-300" />
                <span className="text-sm">{item.label}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="relative z-10 text-sm text-white/40">© 2026 Dockly. All rights reserved.</p>
        <div className="absolute inset-0 bg-gradient-to-br from-primary-800/50 to-primary-900" />
        <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-primary-700/20" />
        <div className="absolute -top-16 -right-16 w-64 h-64 rounded-full bg-primary-600/10" />
      </div>

      {/* Right panel – form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="flex justify-between items-center mb-10">
            <div className="lg:hidden flex items-center gap-2">
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

          <h2 className="text-2xl font-bold mb-1">{t('auth.welcomeBack')}</h2>
          <p className="text-[var(--text-tertiary)] mb-8">{t('auth.signInSubtitle')}</p>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label={t('auth.email')}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
            />
            <Input
              label={t('auth.password')}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" defaultChecked className="rounded border-[var(--border-primary)]" />
                {t('auth.rememberMe')}
              </label>
              <Link to="/auth/forgot-password" className="text-sm text-primary-600 hover:underline">
                {t('auth.forgotPassword')}
              </Link>
            </div>
            <Button type="submit" loading={loading} className="w-full" size="lg">
              {t('auth.signIn')} <Arrow className="w-4 h-4" />
            </Button>
          </form>

          <p className="text-center text-sm text-[var(--text-tertiary)] mt-6">
            {t('auth.noAccount')}{' '}
            <Link to="/auth/signup" className="text-primary-600 font-medium hover:underline">
              {t('auth.createAccount')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
