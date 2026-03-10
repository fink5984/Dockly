import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '@/contexts/I18nContext'
import { useTheme } from '@/contexts/ThemeContext'
import { useAuth } from '@/contexts/AuthContext'
import { useApp } from '@/contexts/AppContext'
import { cn, getInitials } from '@/lib/utils'
import {
  Search, UserPlus, FolderPlus, Bell, Sun, Moon, Menu,
  Globe, LogOut, User, ChevronDown, Send, Settings,
} from 'lucide-react'

export function Topbar() {
  const { t, language, setLanguage, direction } = useI18n()
  const { theme, toggleTheme } = useTheme()
  const { user, signOut } = useAuth()
  const { unreadCount, notifications, markAsRead, markAllRead, setMobileSidebarOpen } = useApp()
  const navigate = useNavigate()
  const isRtl = direction === 'rtl'

  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [notifOpen, setNotifOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)

  const notifRef = useRef<HTMLDivElement>(null)
  const profileRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false)
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <header
      className={cn(
        'sticky top-0 z-30 h-16 flex items-center justify-between gap-4 px-4 lg:px-6',
        'bg-[var(--bg-primary)] border-b border-[var(--border-primary)]',
        'backdrop-blur-sm bg-opacity-95'
      )}
    >
      {/* Left section */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setMobileSidebarOpen(true)}
          className="lg:hidden p-2 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Search */}
        <div className={cn(
          'relative transition-all duration-200',
          searchOpen ? 'w-64 md:w-80' : 'w-10'
        )}>
          {searchOpen ? (
            <div className="relative">
              <Search className={cn('absolute top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]', isRtl ? 'right-3' : 'left-3')} />
              <input
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onBlur={() => !searchQuery && setSearchOpen(false)}
                placeholder={t('common.search') + '...'}
                className={cn(
                  'w-full h-10 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)]',
                  'text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500',
                  isRtl ? 'pr-10 pl-3' : 'pl-10 pr-3'
                )}
              />
            </div>
          ) : (
            <button
              onClick={() => setSearchOpen(true)}
              className="p-2.5 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
            >
              <Search className="w-4 h-4 text-[var(--text-secondary)]" />
            </button>
          )}
        </div>
      </div>

      {/* Right section */}
      <div className="flex items-center gap-1.5">
        {/* Quick actions - desktop */}
        <div className="hidden md:flex items-center gap-1.5">
          <button
            onClick={() => navigate('/clients?action=add')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] transition-colors"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>{t('clients.addClient')}</span>
          </button>
          <button
            onClick={() => navigate('/cases/create')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-primary-600 text-white hover:bg-primary-700 transition-colors"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            <span>{t('cases.createCase')}</span>
          </button>
          <button
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] transition-colors"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{t('cases.sendReminder')}</span>
          </button>
        </div>

        <div className="w-px h-6 bg-[var(--border-primary)] mx-1 hidden md:block" />

        {/* Notifications */}
        <div ref={notifRef} className="relative">
          <button
            onClick={() => setNotifOpen(!notifOpen)}
            className="relative p-2.5 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            <Bell className="w-4 h-4 text-[var(--text-secondary)]" />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-danger text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {unreadCount}
              </span>
            )}
          </button>

          {notifOpen && (
            <div className={cn(
              'absolute top-full mt-2 w-80 bg-[var(--bg-primary)] rounded-xl shadow-xl border border-[var(--border-primary)] overflow-hidden',
              isRtl ? 'left-0' : 'right-0'
            )}>
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-primary)]">
                <h3 className="text-sm font-semibold">{t('common.notifications')}</h3>
                <button onClick={markAllRead} className="text-xs text-primary-600 hover:underline">
                  {t('clients.markComplete')}
                </button>
              </div>
              <div className="max-h-80 overflow-y-auto">
                {notifications.map((notif) => (
                  <button
                    key={notif.id}
                    onClick={() => {
                      markAsRead(notif.id)
                      if (notif.actionUrl) navigate(notif.actionUrl)
                      setNotifOpen(false)
                    }}
                    className={cn(
                      'w-full text-left px-4 py-3 hover:bg-[var(--bg-secondary)] transition-colors border-b border-[var(--border-secondary)]',
                      !notif.read && 'bg-primary-50/50 dark:bg-primary-900/10'
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className={cn(
                        'w-2 h-2 rounded-full mt-1.5 shrink-0',
                        notif.type === 'error' ? 'bg-danger' :
                        notif.type === 'warning' ? 'bg-warning' :
                        notif.type === 'success' ? 'bg-success' : 'bg-info'
                      )} />
                      <div>
                        <p className="text-sm font-medium">{notif.title}</p>
                        <p className="text-xs text-[var(--text-tertiary)] mt-0.5">{notif.message}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Language toggle */}
        <button
          onClick={() => setLanguage(language === 'en' ? 'he' : 'en')}
          className="p-2.5 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
          title={t('common.language')}
        >
          <Globe className="w-4 h-4 text-[var(--text-secondary)]" />
        </button>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="p-2.5 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
          title={theme === 'dark' ? t('common.lightMode') : t('common.darkMode')}
        >
          {theme === 'dark' ? (
            <Sun className="w-4 h-4 text-[var(--text-secondary)]" />
          ) : (
            <Moon className="w-4 h-4 text-[var(--text-secondary)]" />
          )}
        </button>

        {/* Profile */}
        <div ref={profileRef} className="relative">
          <button
            onClick={() => setProfileOpen(!profileOpen)}
            className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-bold">
              {user ? getInitials(user.name) : 'U'}
            </div>
            <ChevronDown className="w-3 h-3 text-[var(--text-tertiary)] hidden md:block" />
          </button>

          {profileOpen && (
            <div className={cn(
              'absolute top-full mt-2 w-56 bg-[var(--bg-primary)] rounded-xl shadow-xl border border-[var(--border-primary)] overflow-hidden',
              isRtl ? 'left-0' : 'right-0'
            )}>
              <div className="px-4 py-3 border-b border-[var(--border-primary)]">
                <p className="text-sm font-medium">{user?.name}</p>
                <p className="text-xs text-[var(--text-tertiary)]">{user?.email}</p>
              </div>
              <div className="py-1">
                <button
                  onClick={() => { navigate('/settings'); setProfileOpen(false) }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm hover:bg-[var(--bg-secondary)] transition-colors"
                >
                  <User className="w-4 h-4" /> {t('common.profile')}
                </button>
                <button
                  onClick={() => { navigate('/settings'); setProfileOpen(false) }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm hover:bg-[var(--bg-secondary)] transition-colors"
                >
                  <Settings className="w-4 h-4" /> {t('nav.settings')}
                </button>
                <button
                  onClick={() => { signOut(); setProfileOpen(false) }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-danger hover:bg-[var(--bg-secondary)] transition-colors"
                >
                  <LogOut className="w-4 h-4" /> {t('auth.signOut')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
