import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '@/contexts/I18nContext'
import { useTheme } from '@/contexts/ThemeContext'
import { useAuth } from '@/contexts/AuthContext'
import { useApp } from '@/contexts/AppContext'
import { useSupabaseData } from '@/hooks/useSupabaseData'
import { getSupportRequests } from '@/services/supportService'
import { cn, getInitials } from '@/lib/utils'
import {
  Search, Sun, Moon, Menu,
  Globe, LogOut, User, ChevronDown, Settings, Activity, MessageCircle,
} from 'lucide-react'

export function Topbar() {
  const { t, language, setLanguage, direction } = useI18n()
  const { theme, toggleTheme } = useTheme()
  const { user, signOut } = useAuth()
  const { setMobileSidebarOpen } = useApp()
  const navigate = useNavigate()
  const isRtl = direction === 'rtl'

  const wsId = user?.workspaceId || ''
  const { data: supportRequests } = useSupabaseData(() => getSupportRequests(wsId), [], [wsId])

  // Only conversations waiting for team response:
  // status is not resolved/closed AND the last message is from the client
  const awaitingTeam = supportRequests.filter(sr => {
    if (sr.status === 'resolved' || sr.status === 'closed') return false
    if (sr.messages.length === 0) return true // new request, no response yet
    const lastMsg = sr.messages[sr.messages.length - 1]
    return lastMsg.senderType === 'client'
  })
  const awaitingCount = awaitingTeam.length

  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [supportOpen, setSupportOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)

  const supportRef = useRef<HTMLDivElement>(null)
  const profileRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (supportRef.current && !supportRef.current.contains(e.target as Node)) setSupportOpen(false)
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <header
      className={cn(
        'sticky top-0 z-30 h-[52px] flex items-center justify-between gap-4 px-4 lg:px-6',
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
        {/* Support conversations awaiting team response */}
        <div ref={supportRef} className="relative">
          <button
            onClick={() => setSupportOpen(!supportOpen)}
            className="relative p-2.5 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
            title={t('dashboard.activeSupport')}
          >
            <MessageCircle className="w-4 h-4 text-[var(--text-secondary)]" />
            {awaitingCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 bg-amber-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                {awaitingCount > 9 ? '9+' : awaitingCount}
              </span>
            )}
          </button>

          {supportOpen && (
            <div className={cn(
              'absolute top-full mt-2 w-80 bg-[var(--bg-primary)] rounded-xl shadow-xl border border-[var(--border-primary)] overflow-hidden',
              isRtl ? 'left-0' : 'right-0'
            )}>
              <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-primary)]">
                <MessageCircle className="w-4 h-4 text-amber-500" />
                <h3 className="text-sm font-semibold">{t('dashboard.activeSupport')}</h3>
                {awaitingCount > 0 && (
                  <span className="min-w-[18px] h-[18px] bg-amber-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                    {awaitingCount}
                  </span>
                )}
              </div>
              <div className="max-h-80 overflow-y-auto">
                {awaitingTeam.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-[var(--text-tertiary)]">
                    <MessageCircle className="w-8 h-8 mb-2 opacity-20" />
                    <p className="text-sm">{t('dashboard.noData')}</p>
                  </div>
                ) : (
                  awaitingTeam.map(sr => {
                    const lastMsg = sr.messages.length > 0 ? sr.messages[sr.messages.length - 1] : null
                    return (
                      <button
                        key={sr.id}
                        onClick={() => {
                          navigate(`/requests/${sr.caseId}`)
                          setSupportOpen(false)
                        }}
                        className="w-full flex items-start gap-3 px-4 py-3 hover:bg-[var(--bg-secondary)] transition-colors border-b border-[var(--border-secondary)] text-start"
                      >
                        <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0 mt-0.5">
                          <MessageCircle className="w-3.5 h-3.5 text-amber-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium truncate">{sr.clientName}</p>
                            <span className="text-[10px] text-[var(--text-tertiary)] shrink-0 ms-2">
                              {sr.messages.length} {t('support.messages').toLowerCase()}
                            </span>
                          </div>
                          {lastMsg && (
                            <p className="text-xs text-[var(--text-tertiary)] truncate mt-0.5">
                              {lastMsg.content || lastMsg.body}
                            </p>
                          )}
                          {!lastMsg && sr.issueDescription && (
                            <p className="text-xs text-[var(--text-tertiary)] truncate mt-0.5">
                              {sr.issueDescription}
                            </p>
                          )}
                        </div>
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* Activity icon */}
        <button
          onClick={() => navigate('/activity')}
          className="p-2.5 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
          title={t('nav.activity')}
        >
          <Activity className="w-4 h-4 text-[var(--text-secondary)]" />
        </button>

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
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
              style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)' }}
            >
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
                  onClick={() => { navigate('/settings?tab=profile'); setProfileOpen(false) }}
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
              </div>
              <div className="border-t border-[var(--border-primary)]">
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
