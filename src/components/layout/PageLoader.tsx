import { Skeleton } from '@/components/ui/States'

export function PageLoader() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
      <Skeleton className="h-72 rounded-xl" />
    </div>
  )
}

export function FullPageLoader() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas">
      <span className="size-6 animate-spin rounded-full border-2 border-line-2 border-t-brand-600" role="status" aria-label="Loading" />
    </div>
  )
}
