import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/contexts/I18nContext'
import { Button } from './Button'

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

let openCount = 0

/** Focus trap + Escape + scroll lock + focus restore, shared by Dialog and Drawer. */
function useModalBehavior(open: boolean, onClose: () => void, panel: React.RefObject<HTMLElement | null>, initialFocus?: React.RefObject<HTMLElement | null>) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    openCount++
    document.body.style.overflow = 'hidden'
    const focusFirst = () => {
      const target = initialFocus?.current || panel.current?.querySelector<HTMLElement>('[data-autofocus]') || panel.current?.querySelector<HTMLElement>(FOCUSABLE) || panel.current
      target?.focus()
    }
    const raf = requestAnimationFrame(focusFirst)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab' || !panel.current) return
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null)
      if (items.length === 0) { e.preventDefault(); return }
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKey)
      openCount--
      if (openCount === 0) document.body.style.overflow = ''
      previouslyFocused?.focus?.()
    }
  }, [open, panel, initialFocus])
}

export interface DialogProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  initialFocus?: React.RefObject<HTMLElement | null>
  /** Prevent closing via backdrop (e.g. unsaved form) */
  dismissable?: boolean
  className?: string
  bodyClassName?: string
}

const sizes = { sm: 'sm:max-w-md', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' }

export function Dialog({ open, onClose, title, description, children, footer, size = 'md', initialFocus, dismissable = true, className, bodyClassName }: DialogProps) {
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descId = useId()
  const { t } = useI18n()
  useModalBehavior(open, onClose, panel, initialFocus)
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-overlay animate-fade-in" onClick={dismissable ? onClose : undefined} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-[92dvh] w-full flex-col overflow-hidden bg-surface shadow-xl outline-none',
          'rounded-t-2xl sm:rounded-xl border border-line animate-slide-up sm:animate-pop-in',
          sizes[size],
          className,
        )}
      >
        {(title || description) && (
          <div className="flex items-start gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0 flex-1">
              {title && <h2 id={titleId} className="text-lg font-semibold text-fg">{title}</h2>}
              {description && <p id={descId} className="mt-1 text-sm text-fg-3">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="-me-1.5 -mt-1 rounded-md p-1.5 text-fg-3 hover:bg-surface-3 hover:text-fg"
              aria-label={t('common.close')}
            >
              <X className="size-4" />
            </button>
          </div>
        )}
        <div className={cn('flex-1 overflow-y-auto scroll-thin px-5 py-4', bodyClassName)}>{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

interface ConfirmDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => Promise<void> | void
  title: ReactNode
  description?: ReactNode
  confirmLabel: string
  tone?: 'danger' | 'primary'
  children?: ReactNode
}

/** Confirmation for consequential actions. Shows progress and stays open on failure. */
export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel, tone = 'danger', children }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false)
  const { t } = useI18n()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const run = async () => {
    setBusy(true)
    try {
      await onConfirm()
      onClose()
    } catch {
      /* caller shows the error toast */
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open={open}
      onClose={busy ? () => {} : onClose}
      size="sm"
      initialFocus={cancelRef}
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={run} loading={busy}>{confirmLabel}</Button>
        </>
      }
    >
      <div className="flex gap-4">
        {tone === 'danger' && (
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger">
            <AlertTriangle className="size-5" />
          </div>
        )}
        <div className="min-w-0 pt-0.5">
          <h2 className="text-md font-semibold text-fg">{title}</h2>
          {description && <p className="mt-1.5 text-sm text-fg-3">{description}</p>}
          {children}
        </div>
      </div>
    </Dialog>
  )
}

interface DrawerProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: 'md' | 'lg' | 'xl'
}

/** Side sheet that opens from the inline end (right in LTR, left in RTL). */
export function Drawer({ open, onClose, title, description, children, footer, width = 'md' }: DrawerProps) {
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const { t } = useI18n()
  useModalBehavior(open, onClose, panel)
  if (!open) return null
  const w = width === 'xl' ? 'sm:max-w-3xl' : width === 'lg' ? 'sm:max-w-xl' : 'sm:max-w-md'
  return createPortal(
    <div className="fixed inset-0 z-[100]">
      <div className="absolute inset-0 bg-overlay animate-fade-in" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={cn('absolute inset-y-0 end-0 flex w-full flex-col bg-surface shadow-xl outline-none border-s border-line animate-fade-in', w)}
      >
        <div className="flex items-start gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            {title && <h2 id={titleId} className="text-lg font-semibold text-fg truncate">{title}</h2>}
            {description && <div className="mt-0.5 text-sm text-fg-3">{description}</div>}
          </div>
          <button type="button" onClick={onClose} className="-me-1.5 rounded-md p-1.5 text-fg-3 hover:bg-surface-3 hover:text-fg" aria-label={t('common.close')}>
            <X className="size-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto scroll-thin">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
