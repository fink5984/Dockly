import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { PenLine, Calendar, User, Type, Hash, CheckSquare, ZoomIn, ZoomOut, Trash2, MousePointerClick, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/contexts/I18nContext'
import { PdfPage } from './PdfPage'
import { Input, Switch } from '@/components/ui/Field'
import { Button, IconButton } from '@/components/ui/Button'
import type { SignatureFieldType } from '@/types'

/** Field geometry is stored in units of a 1000-wide page (sent to the server as canvasWidth). */
export const REF_WIDTH = 1000

export interface EditorField {
  id: string
  type: SignatureFieldType
  label: string
  page: number
  x: number
  y: number
  width: number
  height: number
  required: boolean
  docIndex: number
}

export const FIELD_TYPES: { type: SignatureFieldType; icon: typeof PenLine; w: number; h: number }[] = [
  { type: 'signature', icon: PenLine, w: 240, h: 80 },
  { type: 'initials', icon: Hash, w: 100, h: 60 },
  { type: 'name', icon: User, w: 260, h: 44 },
  { type: 'date', icon: Calendar, w: 170, h: 44 },
  { type: 'text', icon: Type, w: 260, h: 44 },
  { type: 'checkbox', icon: CheckSquare, w: 36, h: 36 },
]

export const fieldTone: Record<SignatureFieldType, string> = {
  signature: 'border-brand-500 bg-brand-500/10 text-brand-700',
  initials: 'border-brand-500 bg-brand-500/10 text-brand-700',
  name: 'border-info bg-info/10 text-info-fg',
  date: 'border-success bg-success/10 text-success-fg',
  text: 'border-warning bg-warning/10 text-warning-fg',
  checkbox: 'border-danger bg-danger/10 text-danger-fg',
}

interface Props {
  doc: PDFDocumentProxy
  docIndex: number
  fields: EditorField[]
  onChange: (fields: EditorField[]) => void
}

export function FieldEditor({ doc, docIndex, fields, onChange }: Props) {
  const { t } = useI18n()
  const scroller = useRef<HTMLDivElement>(null)
  const [fitWidth, setFitWidth] = useState(700)
  const [zoom, setZoom] = useState(1)
  const [tool, setTool] = useState<SignatureFieldType | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [pageHeights, setPageHeights] = useState<Record<number, number>>({})
  const width = Math.round(fitWidth * zoom)
  const scale = width / REF_WIDTH
  const fieldsRef = useRef(fields)
  fieldsRef.current = fields

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const measure = () => setFitWidth(Math.max(280, Math.min(900, el.clientWidth - 32)))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const update = useCallback((id: string, patch: Partial<EditorField>) => {
    onChange(fieldsRef.current.map((f) => (f.id === id ? { ...f, ...patch } : f)))
  }, [onChange])

  const pageHeightUnits = (page: number) => (pageHeights[page] ? pageHeights[page] / scale : REF_WIDTH * 1.414)
  const clamp = (f: EditorField, x: number, y: number, w = f.width, h = f.height) => ({
    x: Math.max(0, Math.min(REF_WIDTH - w, x)),
    y: Math.max(0, Math.min(pageHeightUnits(f.page) - h, y)),
  })

  const placeAt = (page: number, e: React.MouseEvent<HTMLDivElement>) => {
    if (!tool) { setSelected(null); return }
    const rect = e.currentTarget.getBoundingClientRect()
    const cfg = FIELD_TYPES.find((f) => f.type === tool)!
    const ux = (e.clientX - rect.left) / scale - cfg.w / 2
    const uy = (e.clientY - rect.top) / scale - cfg.h / 2
    const f: EditorField = {
      id: crypto.randomUUID(), type: tool, label: t(`signatures.field.${tool}`), page, docIndex, x: 0, y: 0, width: cfg.w, height: cfg.h, required: tool !== 'text',
    }
    Object.assign(f, clamp(f, ux, uy))
    onChange([...fieldsRef.current, f])
    setSelected(f.id)
    setTool(null)
  }

  const startDrag = (e: React.PointerEvent, f: EditorField, mode: 'move' | 'resize') => {
    e.stopPropagation()
    e.preventDefault()
    setSelected(f.id)
    const sx = e.clientX
    const sy = e.clientY
    const start = { ...f }
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / scale
      const dy = (ev.clientY - sy) / scale
      if (mode === 'move') {
        update(f.id, clamp(start, start.x + dx, start.y + dy))
      } else {
        // Pages are laid out LTR (PDF space), so the handle is always bottom-right.
        const w = Math.max(24, Math.min(REF_WIDTH - start.x, start.width + dx))
        const h = Math.max(20, start.height + dy)
        update(f.id, { width: w, height: h })
      }
    }
    const up = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      target.removeEventListener('pointercancel', up)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
    target.addEventListener('pointercancel', up)
  }

  // Keyboard: arrows nudge, Delete removes, Escape deselects / cancels tool.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select')) return
      if (e.key === 'Escape') { setTool(null); setSelected(null); return }
      const f = fieldsRef.current.find((x) => x.id === selected)
      if (!f) return
      const step = e.shiftKey ? 10 : 2
      const moves: Record<string, [number, number]> = { ArrowUp: [0, -step], ArrowDown: [0, step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] }
      if (moves[e.key]) {
        e.preventDefault()
        update(f.id, clamp(f, f.x + moves[e.key][0], f.y + moves[e.key][1]))
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        onChange(fieldsRef.current.filter((x) => x.id !== f.id))
        setSelected(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, onChange, update]) // eslint-disable-line react-hooks/exhaustive-deps

  const sel = fields.find((f) => f.id === selected)
  const pages = Array.from({ length: doc.numPages }, (_, i) => i + 1)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
      {/* Tools */}
      <div className="flex shrink-0 flex-col gap-3 lg:w-56">
        <div className="rounded-xl border border-line bg-surface p-3">
          <p className="mb-2 text-xs font-medium text-fg-3">{t('signatures.editor.tools')}</p>
          <div className="grid grid-cols-3 gap-1.5 lg:grid-cols-1">
            {FIELD_TYPES.map(({ type, icon: Icon }) => (
              <button
                key={type}
                type="button"
                aria-pressed={tool === type}
                onClick={() => setTool(tool === type ? null : type)}
                className={cn(
                  'flex items-center gap-2 rounded-md border px-2.5 py-2 text-sm transition-colors',
                  tool === type ? 'border-brand-500 bg-brand-soft text-brand-700' : 'border-line hover:border-line-2 hover:bg-surface-2',
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className="truncate">{t(`signatures.field.${type}`)}</span>
              </button>
            ))}
          </div>
          <p className="mt-3 flex items-start gap-1.5 text-xs text-fg-3">
            <MousePointerClick className="mt-px size-3.5 shrink-0" />
            {tool ? t('signatures.editor.clickToPlace') : t('signatures.editor.chooseTool')}
          </p>
        </div>
        {sel && (
          <div className="space-y-3 rounded-xl border border-line bg-surface p-3">
            <p className="text-xs font-medium text-fg-3">{t('signatures.editor.selected')}</p>
            <Input inputSize="sm" label={t('signatures.editor.label')} value={sel.label} onChange={(e) => update(sel.id, { label: e.target.value })} maxLength={120} />
            <Switch checked={sel.required} onChange={(v) => update(sel.id, { required: v })} label={t('common.required')} />
            <div className="flex gap-2">
              <Button size="sm" icon={<Copy className="size-3.5" />} onClick={() => {
                const c = { ...sel, id: crypto.randomUUID(), ...clamp(sel, sel.x + 20, sel.y + 20) }
                onChange([...fields, c]); setSelected(c.id)
              }}>{t('signatures.editor.duplicate')}</Button>
              <Button size="sm" variant="ghost" className="text-danger-fg" icon={<Trash2 className="size-3.5" />} onClick={() => { onChange(fields.filter((f) => f.id !== sel.id)); setSelected(null) }}>{t('common.remove')}</Button>
            </div>
            <p className="text-2xs text-fg-4">{t('signatures.editor.keyboardHint')}</p>
          </div>
        )}
      </div>

      {/* Pages */}
      <div className="relative flex min-h-[60vh] min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-surface-3">
        <div className="flex items-center justify-between gap-2 border-b border-line bg-surface px-3 py-2">
          <span className="text-xs text-fg-3">{t('signatures.editor.pages', { count: doc.numPages })} · {t('signatures.editor.fieldCount', { count: fields.filter((f) => f.docIndex === docIndex).length })}</span>
          <div className="flex items-center gap-1">
            <IconButton size="sm" label={t('signatures.editor.zoomOut')} icon={<ZoomOut className="size-4" />} onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} disabled={zoom <= 0.5} />
            <button type="button" onClick={() => setZoom(1)} className="w-12 rounded text-xs tabular text-fg-2 hover:bg-surface-3">{Math.round(zoom * 100)}%</button>
            <IconButton size="sm" label={t('signatures.editor.zoomIn')} icon={<ZoomIn className="size-4" />} onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.25).toFixed(2)))} disabled={zoom >= 2.5} />
          </div>
        </div>
        <div ref={scroller} className="flex-1 overflow-auto scroll-thin p-4" style={{ maxHeight: '75vh' }}>
          <div className="mx-auto flex flex-col items-center gap-4" style={{ width }}>
            {pages.map((p) => (
              <div key={p} className="relative shadow-md" dir="ltr">
                <PdfPage doc={doc} pageNumber={p} width={width} onRendered={(s) => setPageHeights((h) => (h[p] === s.height ? h : { ...h, [p]: s.height }))} />
                <div
                  className={cn('absolute inset-0', tool ? 'cursor-crosshair' : 'cursor-default')}
                  onClick={(e) => placeAt(p, e)}
                  role="presentation"
                >
                  {fields.filter((f) => f.docIndex === docIndex && f.page === p).map((f) => {
                    const Icon = FIELD_TYPES.find((x) => x.type === f.type)!.icon
                    const isSel = f.id === selected
                    return (
                      <div
                        key={f.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`${f.label} (${t(`signatures.field.${f.type}`)})`}
                        aria-pressed={isSel}
                        onClick={(e) => { e.stopPropagation(); setSelected(f.id) }}
                        onFocus={() => setSelected(f.id)}
                        onPointerDown={(e) => startDrag(e, f, 'move')}
                        className={cn(
                          'absolute flex touch-none select-none items-center justify-center gap-1 overflow-hidden rounded-[4px] border-2 border-dashed text-[11px] font-medium',
                          fieldTone[f.type], isSel ? 'z-10 border-solid shadow-md ring-2 ring-brand-500/30' : 'cursor-move',
                        )}
                        style={{ left: f.x * scale, top: f.y * scale, width: f.width * scale, height: f.height * scale }}
                      >
                        {f.type !== 'checkbox' && <Icon className="size-3.5 shrink-0" />}
                        {f.type !== 'checkbox' && f.width * scale > 70 && <span className="truncate" dir="auto">{f.label}{f.required ? ' *' : ''}</span>}
                        {isSel && (
                          <span
                            onPointerDown={(e) => startDrag(e, f, 'resize')}
                            className="absolute bottom-0 end-0 size-3 translate-x-1/2 translate-y-1/2 cursor-nwse-resize rounded-sm border-2 border-white bg-brand-600 shadow"
                            aria-hidden
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
                <span className="absolute -bottom-0 start-full ms-2 hidden text-2xs text-fg-4 sm:block">{p}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
