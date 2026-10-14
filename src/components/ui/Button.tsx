import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip } from './Tooltip'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle' | 'link'
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'

const base =
  'relative inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium select-none ' +
  'transition-[background-color,border-color,color,box-shadow,opacity] duration-150 ' +
  'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] ' +
  'disabled:pointer-events-none disabled:opacity-50'

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-brand-fg shadow-xs hover:bg-brand-700 active:bg-brand-800',
  secondary: 'bg-surface text-fg-2 border border-line-2 shadow-xs hover:bg-surface-2 hover:text-fg active:bg-surface-3',
  ghost: 'text-fg-2 hover:bg-surface-3 hover:text-fg active:bg-line',
  subtle: 'bg-brand-soft text-brand-700 hover:bg-brand-100 active:bg-brand-200',
  danger: 'bg-danger text-white shadow-xs hover:brightness-95 active:brightness-90 dark:text-fg-inverse',
  link: 'text-brand-600 hover:text-brand-700 underline-offset-4 hover:underline px-0 h-auto',
}

const sizes: Record<ButtonSize, string> = {
  xs: 'h-7 px-2 text-xs rounded-full gap-1',
  sm: 'h-8 px-3 text-sm rounded-full gap-1.5',
  md: 'h-9 px-3.5 text-sm rounded-full',
  lg: 'h-11 px-5 text-md rounded-full',
}

const iconSizes: Record<ButtonSize, string> = { xs: 'size-7', sm: 'size-8', md: 'size-9', lg: 'size-11' }

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: ReactNode
  iconEnd?: ReactNode
  /** Render as a router link */
  to?: LinkProps['to']
  fullWidth?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, iconEnd, to, fullWidth, className, children, disabled, type = 'button', ...props },
  ref,
) {
  const classes = cn(base, variants[variant], variant !== 'link' && sizes[size], fullWidth && 'w-full', className)
  const content = (
    <>
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children && <span className={cn(loading && !icon && 'opacity-90')}>{children}</span>}
      {iconEnd}
    </>
  )
  if (to && !disabled) {
    return <Link to={to} className={classes} aria-disabled={loading || undefined}>{content}</Link>
  }
  return (
    <button ref={ref} type={type} className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {content}
    </button>
  )
})

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Accessible name; also shown as tooltip */
  label: string
  icon: ReactNode
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  tooltip?: boolean
  to?: LinkProps['to']
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = 'ghost', size = 'md', loading, tooltip = true, to, className, type = 'button', disabled, ...props },
  ref,
) {
  const classes = cn(base, variants[variant], 'rounded-full p-0', iconSizes[size], className)
  const inner = loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon
  const el = to && !disabled
    ? <Link to={to} className={classes} aria-label={label}>{inner}</Link>
    : (
      <button ref={ref} type={type} aria-label={label} className={classes} disabled={disabled || loading} {...props}>
        {inner}
      </button>
    )
  return tooltip ? <Tooltip content={label}>{el}</Tooltip> : el
})
