import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiError } from '@/lib/api'

export type ToastTone = 'success' | 'error' | 'info' | 'warning'

export interface Toast {
  id: string
  tone: ToastTone
  title: string
  message?: string
  action?: { label: string; onClick: () => void }
  duration?: number
}

interface AppContextType {
  toasts: Toast[]
  toast: (t: Omit<Toast, 'id'>) => string
  dismissToast: (id: string) => void
  /** Show an error toast from any thrown value, preferring the server's safe message. */
  toastError: (err: unknown, fallbackTitle: string) => void
  sidebarCollapsed: boolean
  setSidebarCollapsed: (v: boolean) => void
  mobileNavOpen: boolean
  setMobileNavOpen: (v: boolean) => void
  commandOpen: boolean
  setCommandOpen: (v: boolean) => void
}

const AppContext = createContext<AppContextType | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const [sidebarCollapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('dockly-sidebar') === 'collapsed' } catch { return false }
  })
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)

  const dismissToast = useCallback((id: string) => {
    setToasts((ts) => ts.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) clearTimeout(timer)
    timers.current.delete(id)
  }, [])

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).slice(2)
    setToasts((ts) => [...ts.slice(-3), { ...t, id }])
    const duration = t.duration ?? (t.action ? 7000 : t.tone === 'error' ? 6000 : 4000)
    timers.current.set(id, setTimeout(() => dismissToast(id), duration))
    return id
  }, [dismissToast])

  const toastError = useCallback((err: unknown, fallbackTitle: string) => {
    if (err instanceof ApiError) {
      toast({ tone: 'error', title: fallbackTitle, message: err.status === 0 || err.status >= 500 ? undefined : err.message })
    } else {
      toast({ tone: 'error', title: fallbackTitle })
    }
  }, [toast])

  const setSidebarCollapsed = useCallback((v: boolean) => {
    setCollapsed(v)
    try { localStorage.setItem('dockly-sidebar', v ? 'collapsed' : 'expanded') } catch { /* ignore */ }
  }, [])

  const value = useMemo(() => ({
    toasts, toast, dismissToast, toastError, sidebarCollapsed, setSidebarCollapsed, mobileNavOpen, setMobileNavOpen, commandOpen, setCommandOpen,
  }), [toasts, toast, dismissToast, toastError, sidebarCollapsed, setSidebarCollapsed, mobileNavOpen, commandOpen])

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
