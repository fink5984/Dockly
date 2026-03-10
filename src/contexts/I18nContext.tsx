import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { t as translate } from '@/i18n'
import type { Language, Direction } from '@/types'

interface I18nContextType {
  language: Language
  direction: Direction
  setLanguage: (lang: Language) => void
  t: (key: string) => string
}

const I18nContext = createContext<I18nContextType | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    const saved = localStorage.getItem('dockly-language')
    return (saved as Language) || 'en'
  })

  const direction: Direction = language === 'he' ? 'rtl' : 'ltr'

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang)
    localStorage.setItem('dockly-language', lang)
    document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr'
    document.documentElement.lang = lang
  }, [])

  const t = useCallback(
    (key: string) => translate(key, language),
    [language]
  )

  return (
    <I18nContext.Provider value={{ language, direction, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) throw new Error('useI18n must be used within I18nProvider')
  return context
}
