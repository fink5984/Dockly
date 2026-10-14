import { useEffect, useRef, useState } from 'react'
import { Eraser, PenLine, Type } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Segmented } from '@/components/ui/Field'

interface Labels { draw: string; type: string; clear: string; placeholder: string; typePlaceholder: string; hint: string }

/**
 * Signature capture. The canvas backing store is sized to its displayed size ×
 * devicePixelRatio and pointer coordinates are taken relative to the element,
 * so strokes land exactly under the finger/pen at any zoom or screen size.
 */
export function SignaturePad({ onChange, labels, initialName = '', compact = false }: {
  onChange: (pngDataUrl: string | null) => void; labels: Labels; initialName?: string; compact?: boolean
}) {
  const [mode, setMode] = useState<'draw' | 'type'>('draw')
  const [typed, setTyped] = useState(initialName)
  const canvas = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const hasInk = useRef(false)
  const height = compact ? 140 : 190

  const setup = () => {
    const c = canvas.current
    if (!c) return
    const dpr = Math.max(1, window.devicePixelRatio || 1)
    const rect = c.getBoundingClientRect()
    c.width = Math.round(rect.width * dpr)
    c.height = Math.round(rect.height * dpr)
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#111827'
    ctx.lineWidth = 2.4
    hasInk.current = false
  }

  useEffect(() => {
    if (mode !== 'draw') return
    setup()
    const onResize = () => { setup(); onChange(null) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  const point = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const exportTrimmed = (c: HTMLCanvasElement): string | null => {
    const ctx = c.getContext('2d')!
    const { width, height: h } = c
    const data = ctx.getImageData(0, 0, width, h).data
    let minX = width, minY = h, maxX = -1, maxY = -1
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 10) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    if (maxX < 0) return null
    const pad = 8
    const out = document.createElement('canvas')
    out.width = maxX - minX + pad * 2
    out.height = maxY - minY + pad * 2
    out.getContext('2d')!.drawImage(c, minX - pad, minY - pad, out.width, out.height, 0, 0, out.width, out.height)
    return out.toDataURL('image/png')
  }

  const down = (e: React.PointerEvent) => {
    e.preventDefault()
    canvas.current!.setPointerCapture(e.pointerId)
    drawing.current = true
    last.current = point(e)
    const ctx = canvas.current!.getContext('2d')!
    ctx.beginPath()
    ctx.arc(last.current.x, last.current.y, 1.1, 0, Math.PI * 2)
    ctx.fillStyle = '#111827'
    ctx.fill()
    hasInk.current = true
  }
  const move = (e: React.PointerEvent) => {
    if (!drawing.current || !last.current) return
    const p = point(e)
    const ctx = canvas.current!.getContext('2d')!
    const mid = { x: (last.current.x + p.x) / 2, y: (last.current.y + p.y) / 2 }
    ctx.beginPath()
    ctx.moveTo(last.current.x, last.current.y)
    ctx.quadraticCurveTo(last.current.x, last.current.y, mid.x, mid.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    last.current = p
  }
  const up = () => {
    if (!drawing.current) return
    drawing.current = false
    last.current = null
    onChange(hasInk.current ? exportTrimmed(canvas.current!) : null)
  }
  const clear = () => { setup(); onChange(null) }

  // Typed signature → rendered to PNG with a handwriting-style font stack.
  useEffect(() => {
    if (mode !== 'type') return
    const text = typed.trim()
    if (!text) { onChange(null); return }
    const c = document.createElement('canvas')
    const size = 64
    const ctx = c.getContext('2d')!
    const font = `italic 500 ${size}px "Segoe Script", "Brush Script MT", "Snell Roundhand", "Noto Serif Hebrew", cursive`
    ctx.font = font
    const w = Math.ceil(ctx.measureText(text).width) + 32
    c.width = w
    c.height = size * 1.6
    ctx.font = font
    ctx.fillStyle = '#111827'
    ctx.textBaseline = 'middle'
    ctx.direction = /[֐-׿]/.test(text) ? 'rtl' : 'ltr'
    ctx.textAlign = 'center'
    ctx.fillText(text, w / 2, c.height / 2)
    onChange(c.toDataURL('image/png'))
  }, [typed, mode]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Segmented
          label={labels.draw}
          value={mode}
          onChange={(m) => { setMode(m); onChange(null) }}
          options={[{ value: 'draw', label: labels.draw, icon: <PenLine className="size-3.5" /> }, { value: 'type', label: labels.type, icon: <Type className="size-3.5" /> }]}
        />
        {mode === 'draw' && (
          <button type="button" onClick={clear} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-fg-3 hover:bg-surface-3 hover:text-fg-2">
            <Eraser className="size-4" /> {labels.clear}
          </button>
        )}
      </div>
      {mode === 'draw' ? (
        <div className="relative rounded-xl border-2 border-dashed border-line-2 bg-white">
          <canvas
            ref={canvas}
            className="block w-full touch-none cursor-crosshair rounded-xl"
            style={{ height }}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            aria-label={labels.placeholder}
            role="img"
          />
          <div className="pointer-events-none absolute inset-x-6 bottom-8 border-b border-slate-300" aria-hidden />
          <p className="pointer-events-none absolute bottom-2 start-6 text-xs text-slate-400">{labels.hint}</p>
        </div>
      ) : (
        <div className="space-y-2">
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={labels.typePlaceholder}
            aria-label={labels.typePlaceholder}
            className="h-11 w-full rounded-full border border-line-2 bg-surface px-4 text-md focus:border-brand-500 focus:outline-none"
            maxLength={60}
            autoFocus
          />
          <div className={cn('flex items-center justify-center rounded-xl border border-line bg-white px-4 text-slate-900')} style={{ height }}>
            <span className="truncate text-4xl italic" style={{ fontFamily: '"Segoe Script", "Brush Script MT", "Snell Roundhand", cursive' }}>{typed || ' '}</span>
          </div>
        </div>
      )}
    </div>
  )
}
