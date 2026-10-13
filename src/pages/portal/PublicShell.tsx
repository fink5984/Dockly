import type { CSSProperties, ReactNode } from 'react'
import { Languages, Lock, Phone, Mail } from 'lucide-react'
import { useI18n } from '@/contexts/I18nContext'
import { Logo } from '@/components/layout/Logo'

const PUBLIC_LANG_KEY = 'dockly-public-lang'
/** Language explicitly chosen by the client on a public page (this tab only). */
export function publicLanguageChoice(): 'he' | 'en' | null {
  try { const v = sessionStorage.getItem(PUBLIC_LANG_KEY); return v === 'he' || v === 'en' ? v : null } catch { return null }
}
function rememberPublicLanguage(l: 'he' | 'en') {
  try { sessionStorage.setItem(PUBLIC_LANG_KEY, l) } catch { /* ignore */ }
}

function luminance(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return 0
  const n = parseInt(m[1], 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}

/** CSS variables that re-skin brand tokens with the business's color (contrast-safe). */
export function brandStyle(color?: string): CSSProperties | undefined {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return undefined
  const light = luminance(color) > 0.45
  return {
    ['--dk-brand-500' as string]: color,
    ['--dk-brand-600' as string]: color,
    ['--dk-brand-700' as string]: `color-mix(in srgb, ${color} 82%, black)`,
    ['--dk-brand-800' as string]: `color-mix(in srgb, ${color} 70%, black)`,
    ['--dk-brand-soft' as string]: `color-mix(in srgb, ${color} 10%, transparent)`,
    ['--dk-brand-fg' as string]: light ? '#111827' : '#ffffff',
    ['--dk-ring' as string]: `color-mix(in srgb, ${color} 30%, transparent)`,
  }
}

interface Props {
  workspace?: { name: string; logo?: string; brandColor?: string; email?: string; phone?: string }
  children: ReactNode
  showContact?: boolean
}

export function PublicShell({ workspace, children, showContact = true }: Props) {
  const { t, language, setLanguage } = useI18n()
  return (
    <div className="min-h-dvh bg-canvas" style={brandStyle(workspace?.brandColor)}>
      <div className="h-1 bg-brand-600" aria-hidden />
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-4">
          {workspace?.logo ? (
            <img src={workspace.logo} alt="" className="size-9 rounded-lg border border-line bg-white object-contain" />
          ) : workspace ? (
            <span className="flex size-9 items-center justify-center rounded-lg bg-brand-600 text-sm font-semibold text-brand-fg" aria-hidden>{workspace.name.slice(0, 1)}</span>
          ) : <Logo className="size-9" />}
          <span className="min-w-0 flex-1 truncate font-semibold">{workspace?.name || 'Dockly'}</span>
          <button type="button" onClick={() => { const l = language === 'he' ? 'en' : 'he'; setLanguage(l); rememberPublicLanguage(l) }} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-fg-3 hover:bg-surface-3 hover:text-fg-2" aria-label={t('common.language')}>
            <Languages className="size-4" /> {language === 'he' ? 'English' : 'עברית'}
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6 sm:py-10">{children}</main>
      <footer className="mx-auto max-w-3xl space-y-3 px-4 pb-10 text-center text-xs text-fg-4">
        {showContact && workspace && (workspace.phone || workspace.email) && (
          <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            <span>{t('portal.questions', { name: workspace.name })}</span>
            {workspace.phone && <a href={`tel:${workspace.phone}`} className="inline-flex items-center gap-1 text-fg-3 hover:text-fg-2" dir="ltr"><Phone className="size-3.5" />{workspace.phone}</a>}
            {workspace.email && <a href={`mailto:${workspace.email}`} className="inline-flex items-center gap-1 text-fg-3 hover:text-fg-2" dir="ltr"><Mail className="size-3.5" />{workspace.email}</a>}
          </p>
        )}
        <p className="inline-flex items-center gap-1.5"><Lock className="size-3.5" />{t('portal.secure')}</p>
        <p>{t('common.poweredBy')}</p>
      </footer>
    </div>
  )
}

export function PublicMessage({ icon, title, body, children }: { icon: ReactNode; title: string; body?: string; children?: ReactNode }) {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-line bg-surface p-8 text-center shadow-sm">
      <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-surface-3 text-fg-3 [&>svg]:size-6">{icon}</div>
      <h1 className="text-lg font-semibold">{title}</h1>
      {body && <p className="mt-2 text-sm text-fg-3">{body}</p>}
      {children && <div className="mt-5">{children}</div>}
    </div>
  )
}
