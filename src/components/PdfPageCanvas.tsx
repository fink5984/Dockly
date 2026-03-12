import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react'
import * as pdfjsLib from 'pdfjs-dist'

// Worker file is copied to public/ for reliable serving in both dev & prod
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

interface PdfPageCanvasProps {
  /** URL to the PDF file (blob URL, signed URL, etc.) */
  src: string
  /** 1-based page number to render */
  page: number
  /** CSS class for the wrapper div */
  className?: string
  /** Max height in CSS px – when set, scale so the page fits both width & height (contain) */
  maxHeight?: number
  /** Override the measured container width (CSS px). Useful when the container is smaller than the available space. */
  maxWidth?: number
  /** Callback with the rendered page dimensions (CSS px) */
  onRender?: (dims: { width: number; height: number }) => void
}

export interface PdfPageCanvasHandle {
  /** Width of the rendered canvas in CSS pixels */
  width: number
  /** Height of the rendered canvas in CSS pixels */
  height: number
}

/**
 * Renders a single page of a PDF to a <canvas> element.
 * The canvas is a regular DOM element so any overlays placed on top of it
 * scroll, resize, and position together with it — unlike <embed>/<iframe>.
 */
export const PdfPageCanvas = forwardRef<PdfPageCanvasHandle, PdfPageCanvasProps>(
  ({ src, page, className, maxHeight, maxWidth, onRender }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const [dims, setDims] = useState({ width: 0, height: 0 })
    const renderTaskRef = useRef<any>(null)
    const pdfDocRef = useRef<any>(null)
    const [containerWidth, setContainerWidth] = useState(0)

    useImperativeHandle(ref, () => ({ width: dims.width, height: dims.height }), [dims])

    // Track container width via ResizeObserver
    useEffect(() => {
      const container = containerRef.current
      if (!container) return
      setContainerWidth(container.getBoundingClientRect().width)
      const observer = new ResizeObserver(entries => {
        const w = entries[0]?.contentRect.width
        if (w && w > 0) setContainerWidth(w)
      })
      observer.observe(container)
      return () => observer.disconnect()
    }, [])

    // Render the PDF page whenever src, page, or container width changes
    useEffect(() => {
      if (!containerWidth || !src) return
      let cancelled = false

      const render = async () => {
        try {
          // Load the PDF document (cache across page changes)
          if (!pdfDocRef.current || pdfDocRef.current._src !== src) {
            if (pdfDocRef.current) pdfDocRef.current.destroy()
            const doc = await pdfjsLib.getDocument({ url: src, cMapPacked: true }).promise
            ;(doc as any)._src = src
            pdfDocRef.current = doc
          }

          if (cancelled) return
          const pdfDoc = pdfDocRef.current

          const pageNum = Math.max(1, Math.min(page, pdfDoc.numPages))
          const pdfPage = await pdfDoc.getPage(pageNum)
          if (cancelled) return

          const canvas = canvasRef.current
          if (!canvas) return

          // Scale the page so it fits the container (contain-fit if maxHeight is set)
          const defaultViewport = pdfPage.getViewport({ scale: 1 })
          const effectiveWidth = maxWidth && maxWidth > 0 ? Math.min(containerWidth, maxWidth) : containerWidth
          let scale = effectiveWidth / defaultViewport.width
          if (maxHeight && maxHeight > 0) {
            const heightScale = maxHeight / defaultViewport.height
            scale = Math.min(scale, heightScale)
          }
          // Use devicePixelRatio for sharp rendering
          const dpr = window.devicePixelRatio || 1
          const viewport = pdfPage.getViewport({ scale: scale * dpr })

          canvas.width = viewport.width
          canvas.height = viewport.height
          canvas.style.width = `${viewport.width / dpr}px`
          canvas.style.height = `${viewport.height / dpr}px`

          const ctx = canvas.getContext('2d')!
          // Cancel any previous render
          if (renderTaskRef.current) {
            try { renderTaskRef.current.cancel() } catch {}
          }

          const task = pdfPage.render({ canvasContext: ctx, viewport })
          renderTaskRef.current = task
          await task.promise

          if (!cancelled) {
            const w = viewport.width / dpr
            const h = viewport.height / dpr
            setDims({ width: w, height: h })
            onRender?.({ width: w, height: h })
          }
        } catch (err: any) {
          if (err?.name === 'RenderingCancelledException') return
          console.error('[PdfPageCanvas] render error:', err)
        }
      }

      render()

      return () => {
        cancelled = true
        if (renderTaskRef.current) {
          try { renderTaskRef.current.cancel() } catch {}
        }
      }
    }, [src, page, containerWidth, maxHeight, maxWidth]) // eslint-disable-line react-hooks/exhaustive-deps

    // Cleanup PDF doc on unmount
    useEffect(() => {
      return () => {
        if (pdfDocRef.current) {
          pdfDocRef.current.destroy()
          pdfDocRef.current = null
        }
      }
    }, [])

    return (
      <div ref={containerRef} className={className}>
        <canvas ref={canvasRef} className="block mx-auto" />
      </div>
    )
  }
)

PdfPageCanvas.displayName = 'PdfPageCanvas'

/** Returns the total number of pages in a PDF from a URL */
export async function getPdfPageCount(url: string): Promise<number> {
  const doc = await pdfjsLib.getDocument({ url, cMapPacked: true }).promise
  const count = doc.numPages
  doc.destroy()
  return count
}
