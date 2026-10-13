import en from './en'
import he from './he'
import { sections } from './sections'
import type { Language } from '@/types'

export type Dict = { [k: string]: string | Dict }

function merge(base: Dict, lang: Language): Dict {
  const out: Dict = { ...base }
  for (const [ns, s] of Object.entries(sections)) out[ns] = s[lang] as Dict
  return out
}

export const dictionaries: Record<Language, Dict> = { en: merge(en, 'en'), he: merge(he, 'he') }

function lookup(dict: Dict, path: string): string | undefined {
  let cur: string | Dict | undefined = dict
  for (const part of path.split('.')) {
    if (!cur || typeof cur === 'string') return undefined
    cur = cur[part]
  }
  return typeof cur === 'string' ? cur : undefined
}

export type Vars = Record<string, string | number | undefined | null>

/**
 * Translate `key`, interpolating {{name}} placeholders.
 * Plurals: when vars.count is given, `key_one` / `key_two` / `key_other` are tried first.
 */
export function translate(lang: Language, key: string, vars?: Vars): string {
  const dict = dictionaries[lang]
  let template: string | undefined
  if (vars && typeof vars.count === 'number') {
    const rule = new Intl.PluralRules(lang === 'he' ? 'he' : 'en').select(vars.count)
    template = lookup(dict, `${key}_${rule}`) ?? lookup(dict, `${key}_other`)
  }
  template = template ?? lookup(dict, key) ?? lookup(dictionaries.en, key)
  if (template === undefined) {
    if (import.meta.env.DEV) console.warn(`[i18n] missing key: ${key}`)
    return key
  }
  if (!vars) return template
  return template.replace(/\{\{(\w+)\}\}/g, (_, name) => {
    const v = vars[name]
    return v === undefined || v === null ? '' : String(v)
  })
}

/** Flatten nested keys, ignoring plural-form suffixes (used by the parity test). */
export function flattenKeys(dict: Dict, prefix = ''): string[] {
  return Object.entries(dict).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k.replace(/_(zero|one|two|few|many|other)$/, '')}`] : flattenKeys(v, `${prefix}${k}.`))
}
