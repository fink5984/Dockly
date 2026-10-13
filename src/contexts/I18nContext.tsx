import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { translate, type Vars } from '@/i18n'
import type { Language, Direction } from '@/types'

interface I18nContextType {
  language: Language
  direction: Direction
  isRtl: boolean
  setLanguage: (lang: Language) => void
  t: (key: string, vars?: Vars) => string
  /** Locale-aware formatters */
  fmt: {
    date: (v?: string | Date | null, opts?: Intl.DateTimeFormatOptions) => string
    dateTime: (v?: string | Date | null) => string
    relative: (v?: string | Date | null) => string
    number: (n: number) => string
    bytes: (n?: number | null) => string
  }
}

const I18nContext = createContext<I18nContextType | null>(null)
const STORAGE_KEY = 'dockly-language'

export function detectLanguage(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'he' || saved === 'en') return saved
  } catch { /* storage unavailable */ }
  return navigator.language?.toLowerCase().startsWith('he') ? 'he' : 'en'
}

export function applyDocumentLanguage(lang: Language) {
  document.documentElement.lang = lang
  document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr'
}

export function makeFormatters(language: Language) {
  const locale = language === 'he' ? 'he-IL' : 'en-GB'
  const toDate = (v?: string | Date | null) => {
    if (!v) return null
    const d = typeof v === 'string' ? new Date(v) : v
    return Number.isNaN(d.getTime()) ? null : d
  }
  // Own wording instead of Intl.RelativeTimeFormat: browser ICU data varies
  // (e.g. Chrome renders Hebrew as "לפני דקה (1)").
  const REL = language === 'he'
    ? {
      now: 'עכשיו',
      past: { minute: ['לפני דקה', 'לפני שתי דקות', 'לפני {n} דקות'], hour: ['לפני שעה', 'לפני שעתיים', 'לפני {n} שעות'], day: ['אתמול', 'שלשום', 'לפני {n} ימים'] },
      future: { minute: ['בעוד דקה', 'בעוד שתי דקות', 'בעוד {n} דקות'], hour: ['בעוד שעה', 'בעוד שעתיים', 'בעוד {n} שעות'], day: ['מחר', 'מחרתיים', 'בעוד {n} ימים'] },
    }
    : {
      now: 'just now',
      past: { minute: ['1 min ago', '2 min ago', '{n} min ago'], hour: ['1 hour ago', '2 hours ago', '{n} hours ago'], day: ['yesterday', '2 days ago', '{n} days ago'] },
      future: { minute: ['in 1 min', 'in 2 min', 'in {n} min'], hour: ['in 1 hour', 'in 2 hours', 'in {n} hours'], day: ['tomorrow', 'in 2 days', 'in {n} days'] },
    }
  const rel = (n: number, unit: 'minute' | 'hour' | 'day') => {
    const forms = (n < 0 ? REL.past : REL.future)[unit]
    const a = Math.abs(n)
    return (a === 1 ? forms[0] : a === 2 ? forms[1] : forms[2]).replace('{n}', String(a))
  }
  const rtf = { format: (n: number, unit: 'second' | 'minute' | 'hour' | 'day') => (unit === 'second' ? REL.now : rel(n, unit)) }
  return {
    date: (v?: string | Date | null, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) => {
      const d = toDate(v)
      return d ? new Intl.DateTimeFormat(locale, opts).format(d) : ''
    },
    dateTime: (v?: string | Date | null) => {
      const d = toDate(v)
      return d ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d) : ''
    },
    relative: (v?: string | Date | null) => {
      const d = toDate(v)
      if (!d) return ''
      const diff = (d.getTime() - Date.now()) / 1000
      const abs = Math.abs(diff)
      if (abs < 45) return rtf.format(0, 'second')
      if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
      if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
      if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), 'day')
      return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }).format(d)
    },
    number: (n: number) => new Intl.NumberFormat(locale).format(n),
    bytes: (n?: number | null) => {
      if (!n) return '0 B'
      const units = ['B', 'KB', 'MB', 'GB']
      const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
      return `${new Intl.NumberFormat(locale, { maximumFractionDigits: i === 0 ? 0 : 1 }).format(n / 1024 ** i)} ${units[i]}`
    },
  }
}

/** `persist={false}` for public client pages: their language choice must not change the staff preference. */
export function I18nProvider({ children, initial, persist = true }: { children: ReactNode; initial?: Language; persist?: boolean }) {
  const [language, setLanguageState] = useState<Language>(() => initial || detectLanguage())

  useEffect(() => { applyDocumentLanguage(language) }, [language])

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang)
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, lang) } catch { /* ignore */ }
    }
  }, [persist])

  const value = useMemo<I18nContextType>(() => ({
    language,
    direction: language === 'he' ? 'rtl' : 'ltr',
    isRtl: language === 'he',
    setLanguage,
    t: (key, vars) => translate(language, key, vars),
    fmt: makeFormatters(language),
  }), [language, setLanguage])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within I18nProvider')
  return ctx
}
