/**
 * Small stale-while-revalidate data hook.
 *  - module-level cache keyed by `key` → instant renders when navigating back
 *  - revalidates on mount, on window focus, and when a subscribed live topic fires
 *  - de-duplicates concurrent fetches for the same key
 * Kept intentionally small instead of adding a data-fetching dependency.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { subscribeLive } from '@/lib/live'

interface Entry<T> {
  data?: T
  error?: unknown
  updatedAt: number
  promise?: Promise<T>
}

const cache = new Map<string, Entry<unknown>>()
const listeners = new Map<string, Set<() => void>>()

function emit(key: string) {
  listeners.get(key)?.forEach((l) => l())
}

function subscribeKey(key: string, l: () => void) {
  if (!listeners.has(key)) listeners.set(key, new Set())
  listeners.get(key)!.add(l)
  return () => { listeners.get(key)?.delete(l) }
}

async function load<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const entry = (cache.get(key) as Entry<T>) || { updatedAt: 0 }
  if (entry.promise) return entry.promise
  const promise = fetcher()
    .then((data) => {
      cache.set(key, { data, updatedAt: Date.now() })
      emit(key)
      return data
    })
    .catch((error) => {
      cache.set(key, { ...entry, error, promise: undefined, updatedAt: entry.updatedAt })
      emit(key)
      throw error
    })
  cache.set(key, { ...entry, promise })
  return promise
}

/** Invalidate every cached key starting with `prefix` (they refetch when next used). */
export function invalidate(prefix: string) {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      const e = cache.get(key)!
      cache.set(key, { ...e, updatedAt: 0 })
      emit(key)
    }
  }
}

/** Write data into the cache (optimistic updates / responses that return the new object). */
export function setCached<T>(key: string, data: T) {
  cache.set(key, { data, updatedAt: Date.now() })
  emit(key)
}

export function clearCache() {
  cache.clear()
}

export interface UseApiResult<T> {
  data: T | undefined
  error: unknown
  loading: boolean
  refreshing: boolean
  refetch: () => Promise<T | undefined>
  mutate: (data: T) => void
}

/**
 * @param key unique cache key, or null to skip fetching
 * @param fetcher function returning the data
 * @param options.topics live topics that should trigger a refetch
 */
export function useApi<T>(key: string | null, fetcher: () => Promise<T>, options: { topics?: string[] } = {}): UseApiResult<T> {
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const [refreshing, setRefreshing] = useState(false)

  const entry = useSyncExternalStore(
    useCallback((l) => (key ? subscribeKey(key, l) : () => {}), [key]),
    () => (key ? (cache.get(key) as Entry<T> | undefined) : undefined),
  )

  const refetch = useCallback(async () => {
    if (!key) return undefined
    setRefreshing(true)
    try {
      return await load(key, () => fetcherRef.current())
    } catch {
      return undefined
    } finally {
      setRefreshing(false)
    }
  }, [key])

  // Initial / stale load
  useEffect(() => {
    if (!key) return
    const e = cache.get(key)
    if (!e || e.updatedAt === 0 || Date.now() - e.updatedAt > 15_000) {
      load(key, () => fetcherRef.current()).catch(() => {})
    }
  }, [key, entry?.updatedAt])

  // Revalidate on focus
  useEffect(() => {
    if (!key) return
    const onFocus = () => {
      const e = cache.get(key)
      if (!e || Date.now() - e.updatedAt > 5_000) load(key, () => fetcherRef.current()).catch(() => {})
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [key])

  // Live topic subscriptions (debounced)
  const topics = (options.topics || []).join(',')
  useEffect(() => {
    if (!key || !topics) return
    const wanted = new Set(topics.split(','))
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsub = subscribeLive((evt) => {
      if (!wanted.has(evt.topic)) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { load(key, () => fetcherRef.current()).catch(() => {}) }, 250)
    })
    return () => { unsub(); if (timer) clearTimeout(timer) }
  }, [key, topics])

  const mutate = useCallback((data: T) => { if (key) setCached(key, data) }, [key])

  return {
    data: entry?.data,
    error: entry?.data === undefined ? entry?.error : undefined,
    loading: Boolean(key) && entry?.data === undefined && !entry?.error,
    refreshing,
    refetch,
    mutate,
  }
}
