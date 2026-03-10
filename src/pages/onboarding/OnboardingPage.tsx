import { useState } from 'react'
import { useI18n } from '@/contexts/I18nContext'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Input'
import { Building2, ArrowRight, ArrowLeft } from 'lucide-react'
import { updateWorkspace } from '@/services/settingsService'

export function OnboardingPage() {
  const { t, direction } = useI18n()
  const { user, workspace, completeOnboarding } = useAuth()
  const isRtl = direction === 'rtl'
  const Arrow = isRtl ? ArrowLeft : ArrowRight

  const [business, setBusiness] = useState({
    name: '',
    type: 'mortgage',
    contact: user?.name || '',
    phone: user?.phone || '',
    email: user?.email || '',
    language: 'en',
    timezone: 'Asia/Jerusalem',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleFinish = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!business.name.trim()) {
      setError(t('onboarding.businessNameRequired') || 'Business name is required')
      return
    }

    if (!workspace?.id && !user?.workspaceId) {
      setError('No workspace found. Please sign up again.')
      return
    }

    const wsId = workspace?.id || user?.workspaceId || ''

    setLoading(true)
    try {
      const updatedWs = await updateWorkspace(wsId, {
        name: business.name.trim(),
        businessType: business.type,
        contactPerson: business.contact,
        phone: business.phone,
        email: business.email,
        defaultLanguage: business.language,
        timezone: business.timezone,
      })
      completeOnboarding(updatedWs)
    } catch (err: any) {
      console.error('[Onboarding] Save failed:', err)
      setError(err?.message || 'Failed to save business details')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg-secondary)] flex flex-col" dir={direction}>
      {/* Header */}
      <div className="bg-[var(--bg-primary)] border-b border-[var(--border-primary)] px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center text-white font-bold text-sm">D</div>
          <span className="font-semibold">Dockly</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 px-6 py-12">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center mx-auto mb-4">
              <Building2 className="w-7 h-7 text-primary-600" />
            </div>
            <h1 className="text-2xl font-bold mb-2">{t('onboarding.title')}</h1>
            <p className="text-[var(--text-tertiary)]">{t('onboarding.subtitle')}</p>
          </div>

          <form onSubmit={handleFinish}>
            <div className="bg-[var(--bg-primary)] rounded-2xl border border-[var(--border-primary)] p-8 shadow-sm">
              <h2 className="text-lg font-semibold mb-6">{t('onboarding.step1')}</h2>

              {error && (
                <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
                  {error}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  label={t('onboarding.businessName')}
                  value={business.name}
                  onChange={e => setBusiness(p => ({ ...p, name: e.target.value }))}
                  placeholder="Acme Mortgage"
                  required
                />
                <Select
                  label={t('onboarding.businessType')}
                  value={business.type}
                  onChange={e => setBusiness(p => ({ ...p, type: e.target.value }))}
                  options={[
                    { value: 'mortgage', label: t('businessTypes.mortgage') },
                    { value: 'law', label: t('businessTypes.law') },
                    { value: 'accounting', label: t('businessTypes.accounting') },
                    { value: 'insurance', label: t('businessTypes.insurance') },
                    { value: 'admin', label: t('businessTypes.admin') },
                    { value: 'other', label: t('businessTypes.other') },
                  ]}
                />
                <Input
                  label={t('onboarding.contactPerson')}
                  value={business.contact}
                  onChange={e => setBusiness(p => ({ ...p, contact: e.target.value }))}
                />
                <Input
                  label={t('auth.phone')}
                  value={business.phone}
                  onChange={e => setBusiness(p => ({ ...p, phone: e.target.value }))}
                />
                <Input
                  label={t('auth.email')}
                  type="email"
                  value={business.email}
                  onChange={e => setBusiness(p => ({ ...p, email: e.target.value }))}
                />
                <Select
                  label={t('onboarding.defaultLanguage')}
                  value={business.language}
                  onChange={e => setBusiness(p => ({ ...p, language: e.target.value }))}
                  options={[
                    { value: 'en', label: t('common.english') },
                    { value: 'he', label: t('common.hebrew') },
                  ]}
                />
              </div>
            </div>

            <div className="flex justify-end mt-6">
              <Button type="submit" loading={loading} size="lg">
                {t('onboarding.finish')} <Arrow className="w-4 h-4" />
              </Button>
            </div>
          </form>

          <p className="text-center text-xs text-[var(--text-tertiary)] mt-6">
            {t('onboarding.finishDesc')}
          </p>
        </div>
      </div>
    </div>
  )
}
