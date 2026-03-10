import en from './en.json'
import he from './he.json'
import type { Language } from '@/types'

const translations: Record<Language, Record<string, unknown>> = { en, he }

export function getNestedValue(obj: Record<string, unknown>, path: string): string {
  const keys = path.split('.')
  let current: unknown = obj
  for (const key of keys) {
    if (current && typeof current === 'object' && key in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[key]
    } else {
      return path
    }
  }
  return typeof current === 'string' ? current : path
}

export function t(key: string, lang: Language): string {
  return getNestedValue(translations[lang] as Record<string, unknown>, key)
}

export { en, he, translations }
