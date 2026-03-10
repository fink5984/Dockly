/**
 * Hook for fetching data from Supabase with realtime subscriptions.
 * Automatically refetches when related tables change.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'

interface UseRealtimeDataOptions {
  /** Tables to subscribe to for realtime updates */
  tables?: string[]
  /** Polling interval in ms (default: 5000 for reliable updates) */
  pollInterval?: number
}

interface UseRealtimeDataResult<T> {
  data: T
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useRealtimeData<T>(
  fetcher: () => Promise<T>,
  defaultValue: T,
  deps: unknown[] = [],
  options: UseRealtimeDataOptions = {}
): UseRealtimeDataResult<T> {
  const { tables = [], pollInterval = 5000 } = options
  const [data, setData] = useState<T>(defaultValue)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [trigger, setTrigger] = useState(0)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const lastFetchRef = useRef<number>(0)

  const refetch = useCallback(() => {
    // Debounce: don't refetch more than once per second
    const now = Date.now()
    if (now - lastFetchRef.current < 1000) return
    lastFetchRef.current = now
    setTrigger((prev) => prev + 1)
  }, [])

  // Fetch data
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
          console.error('useRealtimeData error:', err)
          setError(err?.message ?? 'Failed to fetch data')
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, ...deps])

  // Realtime subscription
  useEffect(() => {
    if (tables.length === 0) return

    const channelName = `realtime-${tables.join('-')}-${Date.now()}`
    
    // Build channel with subscriptions to all specified tables
    let channel = supabase.channel(channelName)
    
    tables.forEach((table) => {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        () => {
          refetch()
        }
      )
    })

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log(`[Realtime] Subscribed to: ${tables.join(', ')}`)
      }
    })

    channelRef.current = channel

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [tables.join(','), refetch])

  // Polling fallback - always runs to ensure updates
  useEffect(() => {
    if (pollInterval <= 0) return

    const interval = setInterval(refetch, pollInterval)
    return () => clearInterval(interval)
  }, [pollInterval, refetch])

  return { data, loading, error, refetch }
}
