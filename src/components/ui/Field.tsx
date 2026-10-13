import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { ChevronDown, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'

const control =
  'w-full rounded-md border border-line-2 bg-surface text-fg shadow-xs placeholder:text-fg-4 ' +
  'transition-[border-color,box-shadow] duration-150 ' +
  'hover:border-fg-4/60 focus:outline-none focus:border-brand-500 focus:shadow-[var(--shadow-focus)] ' +
  'disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-fg-3 ' +
  'aria-[invalid=true]:border-danger aria-[invalid=true]:focus:shadow-[0_0_0_3px_rgb(217_45_32/0.18)]'

interface FieldProps {
  label?: ReactNode
  hint?: ReactNode
  error?: string
  required?: boolean
  optionalLabel?: string
  className?: string
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode
  labelAction?: ReactNode
}

/** Label + control + hint/error, wired with ids for screen readers. */
export function Field({ label, hint, error, required, optionalLabel, className, children, labelAction }: FieldProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errId = error ? `${id}-err` : undefined
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={id} className="block text-sm font-medium text-fg-2">
            {label}
            {required && <span className="text-danger ms-0.5" aria-hidden>*</span>}
            {!required && optionalLabel && <span className="ms-1.5 text-xs font-normal text-fg-4">{optionalLabel}</span>}
          </label>
          {labelAction}
        </div>
      )}
      {children({ id, describedBy: [errId, hintId].filter(Boolean).join(' ') || undefined, invalid: Boolean(error) })}
      {error ? (
        <p id={errId} className="text-xs text-danger-fg" role="alert">{error}</p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-fg-3">{hint}</p>
      ) : null}
    </div>
  )
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode
  hint?: ReactNode
  error?: string
  optionalLabel?: string
  leading?: ReactNode
  trailing?: ReactNode
  wrapperClassName?: string
  inputSize?: 'sm' | 'md' | 'lg'
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, optionalLabel, leading, trailing, className, wrapperClassName, required, inputSize = 'md', ...props },
  ref,
) {
  const h = inputSize === 'sm' ? 'h-8 text-sm' : inputSize === 'lg' ? 'h-11 text-md' : 'h-9 text-sm'
  return (
    <Field label={label} hint={hint} error={error} required={required} optionalLabel={optionalLabel} className={wrapperClassName}>
      {({ id, describedBy, invalid }) => (
        <div className="relative">
          {leading && <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-fg-4">{leading}</span>}
          <input
            ref={ref}
            id={props.id || id}
            required={required}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className={cn(control, h, 'px-3', leading && 'ps-9', trailing && 'pe-9', className)}
            {...props}
          />
          {trailing && <span className="absolute inset-y-0 end-2 flex items-center">{trailing}</span>}
        </div>
      )}
    </Field>
  )
})

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode
  hint?: ReactNode
  error?: string
  optionalLabel?: string
  wrapperClassName?: string
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, optionalLabel, className, wrapperClassName, required, rows = 3, ...props },
  ref,
) {
  return (
    <Field label={label} hint={hint} error={error} required={required} optionalLabel={optionalLabel} className={wrapperClassName}>
      {({ id, describedBy, invalid }) => (
        <textarea
          ref={ref}
          id={props.id || id}
          rows={rows}
          required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cn(control, 'px-3 py-2 text-sm leading-relaxed resize-y min-h-[72px]', className)}
          {...props}
        />
      )}
    </Field>
  )
})

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: ReactNode
  hint?: ReactNode
  error?: string
  options: { value: string; label: string; disabled?: boolean }[]
  wrapperClassName?: string
  selectSize?: 'sm' | 'md'
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, options, className, wrapperClassName, required, selectSize = 'md', ...props },
  ref,
) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={wrapperClassName}>
      {({ id, describedBy, invalid }) => (
        <div className="relative">
          <select
            ref={ref}
            id={props.id || id}
            required={required}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className={cn(control, selectSize === 'sm' ? 'h-8' : 'h-9', 'appearance-none ps-3 pe-9 text-sm', className)}
            {...props}
          >
            {options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute end-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-4" aria-hidden />
        </div>
      )}
    </Field>
  )
})

interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  value: string
  onChange: (v: string) => void
  onClear?: () => void
  clearLabel?: string
}

export function SearchInput({ value, onChange, onClear, clearLabel = 'Clear', className, ...props }: SearchInputProps) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-4" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(control, 'h-9 ps-8 pe-8 text-sm [&::-webkit-search-cancel-button]:hidden')}
        {...props}
      />
      {value && (
        <button
          type="button"
          onClick={() => { onChange(''); onClear?.() }}
          className="absolute end-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-fg-4 hover:bg-surface-3 hover:text-fg-2"
          aria-label={clearLabel}
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode
  description?: ReactNode
}

export function Checkbox({ label, description, className, ...props }: CheckboxProps) {
  const id = useId()
  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <input
        id={props.id || id}
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-line-2 accent-brand-600 focus-visible:shadow-[var(--shadow-focus)]"
        {...props}
      />
      <label htmlFor={props.id || id} className="cursor-pointer select-none">
        <span className="block text-sm text-fg">{label}</span>
        {description && <span className="block text-xs text-fg-3 mt-0.5">{description}</span>}
      </label>
    </div>
  )
}

interface SwitchProps {
  checked: boolean
  onChange: (v: boolean) => void
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
  className?: string
}

export function Switch({ checked, onChange, label, description, disabled, className }: SwitchProps) {
  const id = useId()
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm font-medium text-fg cursor-pointer">{label}</label>
        {description && <p className="text-xs text-fg-3 mt-0.5">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-150',
          'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] disabled:opacity-50',
          checked ? 'bg-brand-600' : 'bg-line-2',
        )}
      >
        <span
          className={cn(
            'inline-block size-4 rounded-full bg-white shadow-sm transition-transform duration-150',
            checked ? 'translate-x-[18px] rtl:-translate-x-[18px]' : 'translate-x-0.5 rtl:-translate-x-0.5',
          )}
        />
      </button>
    </div>
  )
}

interface SegmentedProps<T extends string> {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode; icon?: ReactNode }[]
  label?: string
  size?: 'sm' | 'md'
  className?: string
}

/** Compact single-choice control (radio group semantics). */
export function Segmented<T extends string>({ value, onChange, options, label, size = 'md', className }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex rounded-md border border-line-2 bg-surface-3 p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-[5px] font-medium transition-colors',
            size === 'sm' ? 'h-6 px-2 text-xs' : 'h-7 px-2.5 text-sm',
            value === o.value ? 'bg-surface text-fg shadow-xs' : 'text-fg-3 hover:text-fg-2',
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}
