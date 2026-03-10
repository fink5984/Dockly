/**
 * Generic hook for fetching data from Supabase services.
 */
import { useState, useEffect, useCallback } from 'react'

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

  const refetch = useCallback(() => {
    setTrigger((prev) => prev + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetcher()
      .then((result) => {
        if (!cancelled) {
          setData(result)
          setLoading(false)
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
