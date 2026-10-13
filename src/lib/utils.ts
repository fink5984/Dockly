import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function initials(name?: string | null): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || '?').slice(0, 2)
  return letters.toUpperCase()
}

/** Stable, theme-safe accent for avatars derived from a string. */
const AVATAR_TONES = [
  'bg-brand-100 text-brand-800',
  'bg-success-soft text-success-fg',
  'bg-warning-soft text-warning-fg',
  'bg-info-soft text-info-fg',
  'bg-danger-soft text-danger-fg',
  'bg-neutral-soft text-neutral-fg',
]
export function avatarTone(seed: string) {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return AVATAR_TONES[h % AVATAR_TONES.length]
}

export function fileKind(mime?: string, name?: string): 'pdf' | 'image' | 'doc' | 'sheet' | 'file' {
  const m = (mime || '').toLowerCase()
  const ext = (name || '').split('.').pop()?.toLowerCase() || ''
  if (m === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (m.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'heic', 'gif'].includes(ext)) return 'image'
  if (m.includes('word') || ['doc', 'docx'].includes(ext)) return 'doc'
  if (m.includes('sheet') || m.includes('excel') || ['xls', 'xlsx'].includes(ext)) return 'sheet'
  return 'file'
}

export function portalUrl(token?: string) {
  return token ? `${window.location.origin}/p/${token}` : ''
}

export function signUrl(token?: string) {
  return token ? `${window.location.origin}/sign/${token}` : ''
}

/** Convert a yyyy-mm-dd input value to an ISO date the API accepts (end of day local). */
export function dateInputToIso(v: string): string | null {
  if (!v) return null
  return v
}

export function isoToDateInput(v?: string | null): string {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}
