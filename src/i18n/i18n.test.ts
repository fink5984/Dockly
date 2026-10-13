import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { dictionaries, flattenKeys, translate } from './index'

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return walk(p)
    return /\.tsx?$/.test(f) && !f.endsWith('.test.ts') ? [p] : []
  })
}

describe('i18n dictionaries', () => {
  const en = new Set(flattenKeys(dictionaries.en))
  const he = new Set(flattenKeys(dictionaries.he))

  it('English and Hebrew have the same keys', () => {
    expect([...en].filter((k) => !he.has(k))).toEqual([])
    expect([...he].filter((k) => !en.has(k))).toEqual([])
  })

  it('every literal key used in the UI exists', () => {
    const missing: string[] = []
    for (const file of walk(join(__dirname, '..'))) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z][\w.-]*)'/g)) {
        const key = m[1]
        if (!en.has(key) && !en.has(key.replace(/\.$/, ''))) missing.push(`${key}  (${file.split(/[\\/]src[\\/]/)[1]})`)
      }
    }
    expect(missing).toEqual([])
  })

  it('interpolates and pluralizes (incl. Hebrew dual)', () => {
    expect(translate('en', 'requests.toReview', { count: 1 })).toBe('1 to review')
    expect(translate('he', 'requests.toReview', { count: 2 })).toBe('2 לבדיקה')
    expect(translate('he', 'requests.toReview', { count: 1 })).toBe('אחד לבדיקה')
    expect(translate('en', 'portal.greeting', { name: 'Dana' })).toContain('Dana')
  })
})
