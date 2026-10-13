import { cn } from '@/lib/utils'

/** Dockly mark: a document with a check, in the brand color. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-8', className)} role="img" aria-label="Dockly">
      <rect width="32" height="32" rx="8" className="fill-brand-600" />
      <path d="M10 8.5h8.2l3.8 3.8V22a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 9 22V10a1.5 1.5 0 0 1 1-1.5Z" fill="white" fillOpacity=".95" />
      <path d="M18 8.6V12a.5.5 0 0 0 .5.5h3.4" fill="none" stroke="currentColor" className="text-brand-300" strokeWidth="1.2" />
      <path d="m12.6 17 2.3 2.3 4.6-4.6" fill="none" stroke="currentColor" className="text-brand-600" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
