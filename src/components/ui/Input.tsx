import { cn } from '@/lib/utils'
import { Search } from 'lucide-react'
import { useI18n } from '@/contexts/I18nContext'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  helperText?: string
}

export function Input({ label, error, helperText, className, ...props }: InputProps) {
  return (
    <div className="space-y-1.5">
      {label && <label className="block text-sm font-medium text-[var(--text-primary)]">{label}</label>}
      <input
        className={cn(
          'w-full h-10 px-3 rounded-lg border text-sm transition-colors',
          'bg-[var(--bg-primary)] border-[var(--border-primary)]',
          'focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500',
          'placeholder:text-[var(--text-tertiary)]',
          error && 'border-danger focus:ring-danger/30 focus:border-danger',
          className
        )}
        {...props}
      />
      {error && <p className="text-xs text-danger">{error}</p>}
      {helperText && !error && <p className="text-xs text-[var(--text-tertiary)]">{helperText}</p>}
    </div>
  )
}

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

export function SearchInput({ value, onChange, placeholder, className }: SearchInputProps) {
  const { direction } = useI18n()
  const isRtl = direction === 'rtl'

  return (
    <div className={cn('relative', className)}>
      <Search className={cn(
        'absolute top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]',
        isRtl ? 'right-3' : 'left-3'
      )} />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          'w-full h-9 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-sm',
          'focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500',
          'placeholder:text-[var(--text-tertiary)]',
          isRtl ? 'pr-9 pl-3' : 'pl-9 pr-3'
        )}
      />
    </div>
  )
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  options: { value: string; label: string }[]
}

export function Select({ label, options, className, ...props }: SelectProps) {
  return (
    <div className="space-y-1.5">
      {label && <label className="block text-sm font-medium text-[var(--text-primary)]">{label}</label>}
      <select
        className={cn(
          'w-full h-10 px-3 rounded-lg border text-sm transition-colors appearance-none',
          'bg-[var(--bg-primary)] border-[var(--border-primary)]',
          'focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500',
          className
        )}
        {...props}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  )
}

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
}

export function Textarea({ label, error, className, ...props }: TextareaProps) {
  return (
    <div className="space-y-1.5">
      {label && <label className="block text-sm font-medium text-[var(--text-primary)]">{label}</label>}
      <textarea
        className={cn(
          'w-full px-3 py-2 rounded-lg border text-sm transition-colors resize-none',
          'bg-[var(--bg-primary)] border-[var(--border-primary)]',
          'focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500',
          'placeholder:text-[var(--text-tertiary)]',
          error && 'border-danger',
          className
        )}
        {...props}
      />
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  )
}
