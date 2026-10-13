import { useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'

// Worker is served from /public so it works identically in dev and prod.
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

const docs = new Map<string, Promise<PDFDocumentProxy>>()

/** Load (once) and cache a PDF by a stable key; URLs are short-lived so the key is separate. */
export function loadPdf(key: string, getUrl: () => Promise<string>): Promise<PDFDocumentProxy> {
  if (!docs.has(key)) {
    const p = getUrl().then((url) => pdfjs.getDocument({ url, isEvalSupported: false, enableXfa: false }).promise)
    p.catch(() => docs.delete(key))
    docs.set(key, p)
  }
  return docs.get(key)!
}

export function usePdf(key: string | null, getUrl: () => Promise<string>) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState(false)
  const getUrlRef = useRef(getUrl)
  getUrlRef.current = getUrl
  useEffect(() => {
    if (!key) return
    let alive = true
    setError(false)
    loadPdf(key, () => getUrlRef.current()).then((d) => alive && setDoc(d)).catch(() => alive && setError(true))
    return () => { alive = false }
  }, [key])
  return { doc, error, pages: doc?.numPages ?? 0 }
}

/**
 * Renders one page at the given CSS width. The page's height follows its
 * aspect ratio (including /Rotate), so overlays positioned in "width units"
 * stay aligned at any zoom.
 */
export function PdfPage({ doc, pageNumber, width, className, onRendered }: {
  doc: PDFDocumentProxy; pageNumber: number; width: number; className?: string; onRendered?: (size: { width: number; height: number }) => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [height, setHeight] = useState(width * 1.414)
  useEffect(() => {
    let cancelled = false
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null
    doc.getPage(pageNumber).then((page) => {
      if (cancelled || !canvas.current) return
      const base = page.getViewport({ scale: 1 })
      const scale = width / base.width
      const viewport = page.getViewport({ scale })
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const c = canvas.current
      c.width = Math.floor(viewport.width * dpr)
      c.height = Math.floor(viewport.height * dpr)
      c.style.width = `${viewport.width}px`
      c.style.height = `${viewport.height}px`
      setHeight(viewport.height)
      onRendered?.({ width: viewport.width, height: viewport.height })
      const ctx = c.getContext('2d')!
      task = page.render({ canvasContext: ctx, canvas: c, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined }) as unknown as { cancel: () => void; promise: Promise<unknown> }
      task.promise.catch(() => {})
    })
    return () => { cancelled = true; task?.cancel() }
  }, [doc, pageNumber, width]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={className} style={{ width, height }}>
      <canvas ref={canvas} className="block bg-white" aria-hidden />
    </div>
  )
}
