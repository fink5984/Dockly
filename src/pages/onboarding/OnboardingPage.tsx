import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, FileSignature, FolderInput, Layers, Sparkles } from 'lucide-react'
import { useI18n } from '@/contexts/I18nContext'
import { useAuth } from '@/contexts/AuthContext'
import { useApp } from '@/contexts/AppContext'
import { workspaceApi, libraryApi, billingApi } from '@/services'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Field'
import { Stepper } from '@/components/ui/Misc'
import { Logo } from '@/components/layout/Logo'
import type { Language } from '@/types'

const BUSINESS_TYPES = ['accounting', 'legal', 'mortgage', 'insurance', 'finance', 'consulting', 'realEstate', 'other']

export default function OnboardingPage() {
  const { t, language, setLanguage } = useI18n()
  const { user, workspace, setWorkspace } = useAuth()
  const { toastError } = useApp()
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({
    name: '', businessType: 'accounting', phone: user?.phone || '', email: user?.email || '',
    defaultLanguage: (workspace?.defaultLanguage || language) as Language, timezone: 'Asia/Jerusalem',
  })
  const [starters, setStarters] = useState<{ key: string; en: string; he: string; docs: [string, string][] }[]>([])
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [interest, setInterest] = useState<'collect' | 'sign' | 'both'>('both')

  useEffect(() => { libraryApi.starters().then(setStarters).catch(() => {}) }, [])
  useEffect(() => {
    const map: Record<string, string> = { accounting: 'tax', legal: 'legal', mortgage: 'mortgage', insurance: 'insurance' }
    const k = map[form.businessType]
    setChosen(k ? new Set([k]) : new Set())
  }, [form.businessType])

  const saveDetails = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) { setError(t('onboarding.nameRequired')); return }
    setStep(1)
  }

  const finish = async () => {
    setBusy(true)
    try {
      const ws = await workspaceApi.update({ ...form, name: form.name.trim(), contactPerson: user?.name || '' })
      await billingApi.setInterest(interest).catch(() => {})
      if (interest !== 'sign') for (const key of chosen) await libraryApi.installStarter(key, form.defaultLanguage).catch(() => {})
      setLanguage(form.defaultLanguage)
      setWorkspace(ws)
      navigate('/app', { replace: true })
    } catch (err) {
      toastError(err, t('onboarding.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="flex h-16 items-center gap-2.5 border-b border-line bg-surface px-6">
        <Logo className="size-8" /><span className="font-semibold">Dockly</span>
      </header>
      <main className="mx-auto max-w-xl px-5 py-10">
        <Stepper steps={[{ id: 'details', label: t('onboarding.stepDetails') }, { id: 'needs', label: t('billing.onboarding.stepNeeds') }, { id: 'templates', label: t('onboarding.stepTemplates') }]} current={step} onStepClick={setStep} />
        <p className="mt-6 flex items-center gap-2 rounded-lg bg-success-soft px-3 py-2 text-sm text-success-fg"><Sparkles className="size-4 shrink-0" aria-hidden />{t('billing.onboarding.trialStarted')}</p>
        {step === 0 ? (
          <form onSubmit={saveDetails} className="mt-8 space-y-5" noValidate>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{t('onboarding.title', { name: user?.name ? `, ${user.name.split(' ')[0]}` : '' })}</h1>
              <p className="mt-1 text-sm text-fg-3">{t('onboarding.subtitle')}</p>
            </div>
            <Input label={t('onboarding.businessName')} value={form.name} onChange={(e) => { setForm({ ...form, name: e.target.value }); setError('') }} error={error} required autoFocus inputSize="lg" hint={t('onboarding.businessNameHint')} />
            <Select label={t('onboarding.businessType')} value={form.businessType} onChange={(e) => setForm({ ...form, businessType: e.target.value })} options={BUSINESS_TYPES.map((b) => ({ value: b, label: t(`onboarding.types.${b}`) }))} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label={t('onboarding.phone')} type="tel" dir="ltr" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} hint={t('onboarding.contactHint')} />
              <Input label={t('onboarding.email')} type="email" dir="ltr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <Select label={t('onboarding.clientLanguage')} value={form.defaultLanguage} onChange={(e) => setForm({ ...form, defaultLanguage: e.target.value as Language })} options={[{ value: 'he', label: 'עברית' }, { value: 'en', label: 'English' }]} hint={t('onboarding.clientLanguageHint')} />
            <Button type="submit" variant="primary" size="lg" fullWidth>{t('common.next')}</Button>
          </form>
        ) : step === 1 ? (
          <div className="mt-8 space-y-5">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{t('billing.onboarding.title')}</h1>
              <p className="mt-1 text-sm text-fg-3">{t('billing.onboarding.subtitle')}</p>
            </div>
            <div role="radiogroup" aria-label={t('billing.onboarding.title')} className="grid gap-3">
              {([['collect', FolderInput], ['sign', FileSignature], ['both', Layers]] as const).map(([k, Icon]) => (
                <button key={k} type="button" role="radio" aria-checked={interest === k} onClick={() => setInterest(k)}
                  className={cn('flex items-center gap-3 rounded-xl border p-4 text-start transition-colors', interest === k ? 'border-brand-500 bg-brand-soft' : 'border-line bg-surface hover:border-line-2')}>
                  <span className="flex size-9 items-center justify-center rounded-lg bg-surface text-brand-600 ring-1 ring-line"><Icon className="size-5" /></span>
                  <span className="flex-1 text-sm font-semibold">{t(`billing.onboarding.${k}`)}</span>
                  {interest === k && <Check className="size-4 text-brand-600" />}
                </button>
              ))}
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" size="lg" onClick={() => setStep(0)}>{t('common.back')}</Button>
              {interest === 'sign'
                ? <Button variant="primary" size="lg" className="flex-1" loading={busy} onClick={finish}>{t('onboarding.finish')}</Button>
                : <Button variant="primary" size="lg" className="flex-1" onClick={() => setStep(2)}>{t('common.next')}</Button>}
            </div>
          </div>
        ) : (
          <div className="mt-8 space-y-5">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{t('onboarding.templatesTitle')}</h1>
              <p className="mt-1 text-sm text-fg-3">{t('onboarding.templatesSubtitle')}</p>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {starters.map((s) => {
                const on = chosen.has(s.key)
                return (
                  <li key={s.key}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => setChosen((c) => { const n = new Set(c); if (n.has(s.key)) n.delete(s.key); else n.add(s.key); return n })}
                      className={cn('relative w-full rounded-xl border p-4 text-start transition-colors', on ? 'border-brand-500 bg-brand-soft' : 'border-line bg-surface hover:border-line-2')}
                    >
                      {on && <span className="absolute end-3 top-3 flex size-5 items-center justify-center rounded-full bg-brand-600 text-brand-fg"><Check className="size-3" /></span>}
                      <p className="pe-6 text-sm font-semibold">{form.defaultLanguage === 'he' ? s.he : s.en}</p>
                      <p className="mt-1 text-xs text-fg-3 line-clamp-2">{s.docs.map((d) => (form.defaultLanguage === 'he' ? d[1] : d[0])).join(' · ')}</p>
                    </button>
                  </li>
                )
              })}
            </ul>
            <div className="flex gap-3">
              <Button variant="secondary" size="lg" onClick={() => setStep(1)}>{t('common.back')}</Button>
              <Button variant="primary" size="lg" className="flex-1" loading={busy} onClick={finish}>{t('onboarding.finish')}</Button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
