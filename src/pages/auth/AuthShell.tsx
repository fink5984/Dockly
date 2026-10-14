import { useState, type ReactNode } from 'react'
import { CheckCircle2, Eye, EyeOff, Languages } from 'lucide-react'
import { useI18n } from '@/contexts/I18nContext'
import { Logo } from '@/components/brand/Logo'
import { Input, type InputProps } from '@/components/ui/Field'

export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  const { t, language, setLanguage } = useI18n()
  return (
    <div className="grid grid-cols-1 min-h-dvh bg-canvas lg:grid-cols-[1fr_minmax(420px,520px)]">
      <div className="flex flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Logo className="h-10" />
          <button type="button" onClick={() => setLanguage(language === 'he' ? 'en' : 'he')} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-fg-3 hover:bg-surface-3 hover:text-fg-2">
            <Languages className="size-4" /> {language === 'he' ? 'English' : 'עברית'}
          </button>
        </div>
        <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-fg-3">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-6 text-center text-sm text-fg-3">{footer}</div>}
        </main>
      </div>
      <aside className="relative hidden overflow-hidden bg-brand-900 p-12 text-white lg:flex lg:flex-col lg:justify-end dark:bg-brand-50">
        <div className="pointer-events-none absolute -end-24 -top-24 size-96 rounded-full bg-white/5" aria-hidden />
        <div className="pointer-events-none absolute -start-16 top-1/3 size-64 rounded-full bg-white/5" aria-hidden />
        <div className="relative">
          <p className="text-2xl font-semibold leading-snug text-white dark:text-fg">{t('auth.createSubtitle')}</p>
          <ul className="mt-8 space-y-4">
            {['marketing1', 'marketing2', 'marketing3'].map((k) => (
              <li key={k} className="flex items-start gap-3 text-sm text-white/80 dark:text-fg-2">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-brand-300 dark:text-brand-600" /> {t(`auth.${k}`)}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  )
}

export function PasswordInput(props: InputProps) {
  const [show, setShow] = useState(false)
  const { t } = useI18n()
  return (
    <Input
      {...props}
      type={show ? 'text' : 'password'}
      trailing={
        <button type="button" onClick={() => setShow((s) => !s)} className="rounded p-1 text-fg-4 hover:text-fg-2" aria-label={show ? t('auth.hidePassword') : t('auth.showPassword')}>
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      }
    />
  )
}
