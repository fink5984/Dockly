import { useId, type CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { BRAND } from '@shared/brand.mjs'
import { LOGO_VIEWBOX, MARK_GLOW, MARK_GRADIENTS, MARK_SHAPES, MARK_VIEWBOX, WORDMARK_PATH, WORDMARK_VIEWBOX } from './logoData'

/**
 * Surface the logo sits on. `auto` follows the app theme (navy wordmark in
 * light mode, near-white in dark); the others pin it for fixed-color panels.
 */
export type LogoTone = 'auto' | 'onLight' | 'onDark'

interface BrandProps {
  className?: string
  tone?: LogoTone
  /** Set when visible text next to the logo already names the product. */
  decorative?: boolean
}

const TONES: Record<LogoTone, CSSProperties | undefined> = {
  auto: undefined,
  onLight: { '--dk-brand-ink': BRAND.colors.ink, '--dk-mark-deep': BRAND.colors.deep } as CSSProperties,
  onDark: { '--dk-brand-ink': '#ffffff', '--dk-mark-deep': '#4338d0' } as CSSProperties,
}

const ratio = (viewBox: string) => { const [, , w, h] = viewBox.split(' ').map(Number); return `${w} / ${h}` }

function a11y(decorative?: boolean) {
  return decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': BRAND.name }
}

/** The ribbon "S": gradient defs + shapes, ids scoped per instance. */
function MarkShapes() {
  const id = 'sd' + useId().replace(/[^\w-]/g, '')
  const grad = (key: keyof typeof MARK_GRADIENTS) => {
    const g = MARK_GRADIENTS[key]
    return (
      <linearGradient key={key} id={`${id}-${key}`} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} gradientUnits="userSpaceOnUse">
        {g.stops.map(([offset, color]) => <stop key={offset} offset={offset} style={{ stopColor: color }} />)}
      </linearGradient>
    )
  }
  return (
    <>
      <defs>
        {grad('top')}{grad('bottom')}{grad('band')}{grad('face')}
        <radialGradient id={`${id}-glow`} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform={MARK_GLOW.transform}>
          <stop offset="0" stopColor={MARK_GLOW.color} stopOpacity={MARK_GLOW.opacity} />
          <stop offset="1" stopColor={MARK_GLOW.color} stopOpacity="0" />
        </radialGradient>
      </defs>
      <path fill={`url(#${id}-top)`} d={MARK_SHAPES.top} />
      <path fill={`url(#${id}-bottom)`} d={MARK_SHAPES.bottom} />
      <path fill={`url(#${id}-band)`} d={MARK_SHAPES.band} />
      <path fill={`url(#${id}-face)`} d={MARK_SHAPES.face} />
      <path fill={`url(#${id}-glow)`} d={MARK_SHAPES.band} />
    </>
  )
}

/** Full horizontal logo (mark + wordmark). Size it by height: `h-8`, `h-10`… */
export function Logo({ className, tone = 'auto', decorative }: BrandProps) {
  return (
    <svg
      viewBox={LOGO_VIEWBOX}
      className={cn('h-8 w-auto shrink-0', className)}
      style={{ aspectRatio: ratio(LOGO_VIEWBOX), ...TONES[tone] }}
      {...a11y(decorative)}
    >
      <MarkShapes />
      <path d={WORDMARK_PATH} className="fill-brand-ink" />
    </svg>
  )
}

/** Icon-only mark for compact spots: collapsed sidebar, loaders, badges. Size with `size-*`. */
export function LogoMark({ className, tone = 'auto', decorative }: BrandProps) {
  return (
    <svg viewBox={MARK_VIEWBOX} className={cn('size-8 shrink-0', className)} style={TONES[tone]} {...a11y(decorative)}>
      <MarkShapes />
    </svg>
  )
}

/** Wordmark only, in the current text color (for tight inline credits like "Powered by"). */
export function Wordmark({ className, decorative }: Omit<BrandProps, 'tone'>) {
  return (
    <svg viewBox={WORDMARK_VIEWBOX} className={cn('h-4 w-auto shrink-0', className)} style={{ aspectRatio: ratio(WORDMARK_VIEWBOX) }} {...a11y(decorative)}>
      <path d={WORDMARK_PATH} fill="currentColor" />
    </svg>
  )
}
