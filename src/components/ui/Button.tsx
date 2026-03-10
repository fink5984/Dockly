import { cn } from '@/lib/utils'
import { Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: ReactNode
  iconPosition?: 'start' | 'end'
  children?: ReactNode
}

export function Button({
  variant = 'primary', size = 'md', loading, icon, iconPosition = 'start', children, className, disabled, ...props
}: ButtonProps) {
  const variants = {
    primary: 'bg-primary-600 text-white hover:bg-primary-700 shadow-sm',
    secondary: 'bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--border-primary)]',
    ghost: 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]',
    danger: 'bg-danger text-white hover:bg-red-700',
    outline: 'border border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]',
  }

  const sizes = {
    sm: 'h-8 px-3 text-xs gap-1.5',
    md: 'h-10 px-4 text-sm gap-2',
    lg: 'h-12 px-6 text-sm gap-2',
  }

  return (
    <button
      className={cn(
        'inline-flex items-center justify-center font-medium rounded-lg transition-all duration-150',
        'focus:outline-none focus:ring-2 focus:ring-primary-500/30',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {iconPosition === 'start' && (loading ? <Loader2 className="w-4 h-4 animate-spin" /> : icon)}
      {children}
      {iconPosition === 'end' && (loading ? <Loader2 className="w-4 h-4 animate-spin" /> : icon)}
    </button>
  )
}
