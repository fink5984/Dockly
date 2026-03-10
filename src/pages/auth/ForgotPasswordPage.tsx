import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/contexts/I18nContext'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Globe, ArrowLeft, ArrowRight, CheckCircle } from 'lucide-react'

export function ForgotPasswordPage() {
  const { t, language, setLanguage, direction } = useI18n()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const isRtl = direction === 'rtl'
  const BackArrow = isRtl ? ArrowRight : ArrowLeft

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setSent(true)
  }

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
          {sent ? (
            <div className="text-center py-8">
              <CheckCircle className="w-12 h-12 text-success mx-auto mb-4" />
              <h2 className="text-xl font-bold mb-2">{t('auth.resetSent')}</h2>
              <p className="text-[var(--text-tertiary)] text-sm mb-6">{email}</p>
              <Link to="/auth/signin">
                <Button variant="outline">
                  <BackArrow className="w-4 h-4" /> {t('auth.backToSignIn')}
                </Button>
              </Link>
            </div>
          ) : (
            <>
              <h2 className="text-2xl font-bold mb-1">{t('auth.forgotPassword')}</h2>
              <p className="text-[var(--text-tertiary)] mb-6">{t('auth.resetPassword')}</p>
              <form onSubmit={handleSubmit} className="space-y-4">
                <Input label={t('auth.email')} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" />
                <Button type="submit" className="w-full" size="lg">{t('auth.sendResetLink')}</Button>
              </form>
              <p className="text-center mt-5">
                <Link to="/auth/signin" className="text-sm text-primary-600 hover:underline flex items-center justify-center gap-1">
                  <BackArrow className="w-3 h-3" /> {t('auth.backToSignIn')}
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
