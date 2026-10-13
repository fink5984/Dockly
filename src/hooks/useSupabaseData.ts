/**
 * Generic hook for fetching data from Supabase services.
 */
import { useState, useEffect, useCallback, useRef } from 'react'

interface UseSupabaseDataResult<T> {
  data: T
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useSupabaseData<T>(
  fetcher: () => Promise<T>,
  defaultValue: T,
  deps: unknown[] = []
): UseSupabaseDataResult<T> {
  const [data, setData] = useState<T>(defaultValue)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [trigger, setTrigger] = useState(0)
  const hasFetchedRef = useRef(false)

  const refetch = useCallback(() => {
    setTrigger((prev) => prev + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!hasFetchedRef.current) {
      setLoading(true)
    }
    setError(null)

    fetcher()
      .then((result) => {
        if (!cancelled) {
          setData(result)
          setLoading(false)
          hasFetchedRef.current = true
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('useSupabaseData error:', err)
          setError(err?.message ?? 'Failed to fetch data')
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, ...deps])

  return { data, loading, error, refetch }
}
