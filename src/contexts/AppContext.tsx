import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import type { Notification } from '@/types'
import { supabase } from '@/lib/supabase'
import { mapNotification } from '@/lib/mappers'
import { useAuth } from './AuthContext'

interface ToastType {
  id: string
  type: 'success' | 'error' | 'info' | 'warning'
  title: string
  message?: string
}

interface AppContextType {
  notifications: Notification[]
  unreadCount: number
  markAsRead: (id: string) => void
  markAllRead: () => void
  toasts: ToastType[]
  addToast: (toast: Omit<ToastType, 'id'>) => void
  removeToast: (id: string) => void
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  mobileSidebarOpen: boolean
  setMobileSidebarOpen: (open: boolean) => void
}

const AppContext = createContext<AppContextType | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [toasts, setToasts] = useState<ToastType[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  // Fetch notifications from Supabase when user is available
  useEffect(() => {
    if (!user) {
      setNotifications([])
      return
    }

    const fetchNotifications = async () => {
      try {
        const { data, error } = await supabase
          .from('notifications')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(50)

        if (!error && data) {
          setNotifications(data.map(mapNotification))
        }
      } catch {
        // Silently fail — notifications are non-critical
      }
    }

    fetchNotifications()

    // Real-time subscription for new notifications
    const channel = supabase
      .channel('notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const newNotif = mapNotification(payload.new as any)
          setNotifications((prev) => [newNotif, ...prev])
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user])

  const unreadCount = notifications.filter((n) => !n.read).length

  const markAsRead = useCallback(async (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    )
    // Update in DB
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', id)
  }, [])

  const markAllRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
    if (user) {
      await supabase
        .from('notifications')
        .update({ read: true })
        .eq('user_id', user.id)
        .eq('read', false)
    }
  }, [user])

  const addToast = (toast: Omit<ToastType, 'id'>) => {
    const id = Math.random().toString(36).substring(7)
    setToasts((prev) => [...prev, { ...toast, id }])
    setTimeout(() => removeToast(id), 4000)
  }

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  return (
    <AppContext.Provider
      value={{
        notifications, unreadCount, markAsRead, markAllRead,
        toasts, addToast, removeToast,
        sidebarOpen, setSidebarOpen,
        mobileSidebarOpen, setMobileSidebarOpen,
      }}
    >
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const context = useContext(AppContext)
  if (!context) throw new Error('useApp must be used within AppProvider')
  return context
}
