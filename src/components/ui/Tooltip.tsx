import { cloneElement, isValidElement, useId, useRef, useState, useEffect, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

interface TooltipProps {
  content: ReactNode
  children: ReactElement
  side?: 'top' | 'bottom' | 'start' | 'end'
  disabled?: boolean
  delay?: number
}

/**
 * Accessible tooltip: shows on hover and keyboard focus, hides on Escape,
 * linked with aria-describedby. Rendered in a portal so it never clips.
 */
export function Tooltip({ content, children, side = 'top', disabled, delay = 350 }: TooltipProps) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number; place: string } | null>(null)
  const anchor = useRef<HTMLElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = () => {
    if (disabled || !content) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const el = anchor.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const rtl = document.documentElement.dir === 'rtl'
      const logical = side === 'start' ? (rtl ? 'right' : 'left') : side === 'end' ? (rtl ? 'left' : 'right') : side
      const place = logical === 'top' && r.top < 48 ? 'bottom' : logical
      const x = place === 'left' ? r.left - 8 : place === 'right' ? r.right + 8 : r.left + r.width / 2
      const y = place === 'top' ? r.top - 8 : place === 'bottom' ? r.bottom + 8 : r.top + r.height / 2
      setPos({ x, y, place })
      setOpen(true)
    }, delay)
  }
  const hide = () => {
    if (timer.current) clearTimeout(timer.current)
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hide() }
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', hide, true)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('scroll', hide, true) }
  }, [open])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  if (!isValidElement(children)) return children
  const child = children as ReactElement<Record<string, unknown>>
  const trigger = cloneElement(child, {
    ref: (node: HTMLElement | null) => {
      anchor.current = node
      const r = child.props.ref
      if (typeof r === 'function') r(node)
      else if (r && typeof r === 'object') (r as { current: unknown }).current = node
    },
    onMouseEnter: (e: unknown) => { show(); (child.props.onMouseEnter as ((e: unknown) => void) | undefined)?.(e) },
    onMouseLeave: (e: unknown) => { hide(); (child.props.onMouseLeave as ((e: unknown) => void) | undefined)?.(e) },
    onFocus: (e: unknown) => { show(); (child.props.onFocus as ((e: unknown) => void) | undefined)?.(e) },
    onBlur: (e: unknown) => { hide(); (child.props.onBlur as ((e: unknown) => void) | undefined)?.(e) },
    onPointerDown: (e: unknown) => { hide(); (child.props.onPointerDown as ((e: unknown) => void) | undefined)?.(e) },
    'aria-describedby': open ? id : undefined,
  })

  const transform = pos?.place === 'top' ? 'translate(-50%, -100%)' : pos?.place === 'bottom' ? 'translate(-50%, 0)' : pos?.place === 'left' ? 'translate(-100%, -50%)' : 'translate(0, -50%)'

  return (
    <>
      {trigger}
      {open && pos && createPortal(
        <div
          id={id}
          role="tooltip"
          className={cn('pointer-events-none fixed z-[200] max-w-xs rounded-md bg-fg px-2 py-1 text-xs font-medium text-fg-inverse shadow-md animate-fade-in')}
          style={{ left: pos.x, top: pos.y, transform }}
        >
          {content}
        </div>,
        document.body,
      )}
    </>
  )
}
