import { useRef, useState, type ReactNode } from 'react'
import { FileText, FileImage, FileSpreadsheet, File as FileIco, UploadCloud, Camera } from 'lucide-react'
import { cn, fileKind } from '@/lib/utils'
import { useI18n } from '@/contexts/I18nContext'

export function FileIcon({ mime, name, className }: { mime?: string; name?: string; className?: string }) {
  const kind = fileKind(mime, name)
  const map = {
    pdf: { Icon: FileText, cls: 'text-danger bg-danger-soft' },
    image: { Icon: FileImage, cls: 'text-info bg-info-soft' },
    doc: { Icon: FileText, cls: 'text-brand-600 bg-brand-soft' },
    sheet: { Icon: FileSpreadsheet, cls: 'text-success bg-success-soft' },
    file: { Icon: FileIco, cls: 'text-fg-3 bg-surface-3' },
  }[kind]
  return (
    <span className={cn('inline-flex size-9 shrink-0 items-center justify-center rounded-lg', map.cls, className)} aria-hidden>
      <map.Icon className="size-[18px]" />
    </span>
  )
}

const EXT_ALIASES: Record<string, string[]> = {
  jpg: ['jpg', 'jpeg'], jpeg: ['jpg', 'jpeg'], heic: ['heic', 'heif'], tif: ['tif', 'tiff'], tiff: ['tif', 'tiff'],
}

export function acceptFor(formats: string[]) {
  const exts = new Set<string>()
  formats.forEach((f) => (EXT_ALIASES[f] || [f]).forEach((e) => exts.add(e)))
  return [...exts].map((e) => `.${e}`).join(',')
}

/** Client-side pre-check mirroring the server's rules (server still validates content). */
export function precheckFile(file: File, formats: string[], maxMB: number): 'too_large' | 'wrong_type' | 'empty' | null {
  if (file.size === 0) return 'empty'
  if (file.size > maxMB * 1024 * 1024) return 'too_large'
  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  const allowed = new Set<string>()
  formats.forEach((f) => (EXT_ALIASES[f] || [f]).forEach((e) => allowed.add(e)))
  if (formats.length && !allowed.has(ext)) return 'wrong_type'
  return null
}

interface UploadZoneProps {
  onFiles: (files: File[]) => void
  accept?: string
  multiple?: boolean
  disabled?: boolean
  title?: ReactNode
  hint?: ReactNode
  compact?: boolean
  /** Offer a "take photo" button on touch devices */
  camera?: boolean
  className?: string
  id?: string
}

export function UploadZone({ onFiles, accept, multiple, disabled, title, hint, compact, camera, className, id }: UploadZoneProps) {
  const { t } = useI18n()
  const input = useRef<HTMLInputElement>(null)
  const cam = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const pick = (list: FileList | null) => {
    if (!list || list.length === 0) return
    onFiles(Array.from(list).slice(0, multiple ? 20 : 1))
  }
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) pick(e.dataTransfer.files) }}
      className={cn(
        'relative rounded-xl border-2 border-dashed text-center transition-colors',
        over ? 'border-brand-500 bg-brand-soft' : 'border-line-2 bg-surface-2 hover:border-fg-4/60',
        disabled && 'pointer-events-none opacity-60',
        compact ? 'px-4 py-4' : 'px-6 py-8',
        className,
      )}
    >
      <input
        ref={input}
        id={id}
        type="file"
        className="sr-only"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(e) => { pick(e.target.files); e.target.value = '' }}
      />
      {camera && (
        <input ref={cam} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { pick(e.target.files); e.target.value = '' }} />
      )}
      <div className={cn('flex items-center justify-center gap-3', compact ? 'flex-row' : 'flex-col')}>
        <span className={cn('flex items-center justify-center rounded-full bg-surface text-brand-600 shadow-xs border border-line', compact ? 'size-9' : 'size-11')}>
          <UploadCloud className={compact ? 'size-4' : 'size-5'} />
        </span>
        <div className={compact ? 'text-start' : ''}>
          <p className="text-sm font-medium text-fg">
            {title || (
              <>
                <button type="button" onClick={() => input.current?.click()} className="font-semibold text-brand-600 hover:text-brand-700 focus-visible:outline-none focus-visible:underline">
                  {t('upload.choose')}
                </button>{' '}
                <span className="hidden sm:inline">{t('upload.orDrag')}</span>
              </>
            )}
          </p>
          {hint && <p className="mt-0.5 text-xs text-fg-3">{hint}</p>}
        </div>
      </div>
      {(title || camera) && (
        <div className={cn('mt-3 flex flex-wrap items-center justify-center gap-2', compact && 'mt-2')}>
          {title && (
            <button type="button" onClick={() => input.current?.click()} className="inline-flex h-9 items-center gap-2 rounded-md bg-brand-600 px-3.5 text-sm font-medium text-brand-fg shadow-xs hover:bg-brand-700">
              <UploadCloud className="size-4" /> {t('upload.choose')}
            </button>
          )}
          {camera && (
            <button type="button" onClick={() => cam.current?.click()} className="inline-flex h-9 items-center gap-2 rounded-md border border-line-2 bg-surface px-3.5 text-sm font-medium text-fg-2 shadow-xs hover:bg-surface-2 sm:hidden">
              <Camera className="size-4" /> {t('upload.takePhoto')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
