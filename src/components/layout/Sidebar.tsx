import { NavLink, useLocation } from 'react-router-dom'
import { useI18n } from '@/contexts/I18nContext'
import { useAuth } from '@/contexts/AuthContext'
import { useApp } from '@/contexts/AppContext'
import { cn, getInitials } from '@/lib/utils'
import {
  LayoutDashboard, Users, ClipboardList,
  Settings, X, ChevronLeft, ChevronRight, PenLine, LogOut,
} from 'lucide-react'

const mainNav = [
  { key: 'dashboard', path: '/', icon: LayoutDashboard },
  { key: 'clients', path: '/clients', icon: Users },
  { key: 'requests', path: '/requests', icon: ClipboardList },
  { key: 'signatures', path: '/signatures', icon: PenLine },
]

const bottomNav = [
  { key: 'settings', path: '/settings', icon: Settings },
]

export function Sidebar() {
  const { t, direction } = useI18n()
  const { user, signOut } = useAuth()
  const { sidebarOpen, setSidebarOpen, mobileSidebarOpen, setMobileSidebarOpen } = useApp()
  const location = useLocation()

  const isRtl = direction === 'rtl'
  const expanded = sidebarOpen || mobileSidebarOpen

  return (
    <>
      {/* Mobile overlay */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed top-0 bottom-0 z-50 flex flex-col transition-all duration-300 ease-in-out',
          'border-[var(--border-primary)]',
          isRtl ? 'right-0 border-l' : 'left-0 border-r',
          sidebarOpen ? 'w-64' : 'w-[72px]',
          'lg:translate-x-0',
          mobileSidebarOpen
            ? 'translate-x-0 w-72'
            : isRtl ? 'translate-x-full lg:translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
        style={{
          background: 'var(--bg-primary)',
        }}
      >
        {/* Logo */}
        <div className="flex items-center justify-between h-[52px] px-4 border-b border-[var(--border-primary)]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center text-white font-bold text-sm shadow-md">
              D
            </div>
            {expanded && (
              <span className="text-lg font-bold text-[var(--text-primary)] tracking-tight">
                Dockly
              </span>
            )}
          </div>
          <button
            onClick={() => setMobileSidebarOpen(false)}
            className="lg:hidden p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            <X className="w-4 h-4 text-[var(--text-secondary)]" />
          </button>
        </div>

        {/* Section label */}
        {expanded && (
          <div className="px-5 pt-5 pb-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)]">
              {t('nav.menu') || 'Menu'}
            </p>
          </div>
        )}

        {/* Main Navigation */}
        <nav className="flex-1 overflow-y-auto py-2 px-3 space-y-0.5">
          {mainNav.map((item) => {
            const Icon = item.icon
            const isActive = item.path === '/'
              ? location.pathname === '/'
              : location.pathname.startsWith(item.path)

            return (
              <NavLink
                key={item.key}
                to={item.path}
                onClick={() => setMobileSidebarOpen(false)}
                className={cn(
                  'group flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200 relative',
                  isActive
                    ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-400'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]',
                  !expanded && 'justify-center px-0'
                )}
                title={!expanded ? t(`nav.${item.key}`) : undefined}
              >
                <Icon className={cn(
                  'w-[18px] h-[18px] shrink-0 transition-colors',
                  isActive ? 'text-primary-600 dark:text-primary-400' : 'text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]'
                )} />
                {expanded && (
                  <span>{t(`nav.${item.key}`)}</span>
                )}
              </NavLink>
            )
          })}
        </nav>

        {/* Bottom section */}
        <div className="px-3 pb-2 space-y-0.5">
          {/* Settings */}
          {bottomNav.map((item) => {
            const Icon = item.icon
            const isActive = location.pathname.startsWith(item.path)

            return (
              <NavLink
                key={item.key}
                to={item.path}
                onClick={() => setMobileSidebarOpen(false)}
                className={cn(
                  'group flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200 relative',
                  isActive
                    ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-400'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]',
                  !expanded && 'justify-center px-0'
                )}
                title={!expanded ? t(`nav.${item.key}`) : undefined}
              >
                <Icon className={cn(
                  'w-[18px] h-[18px] shrink-0 transition-colors',
                  isActive ? 'text-primary-600 dark:text-primary-400' : 'text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]'
                )} />
                {expanded && <span>{t(`nav.${item.key}`)}</span>}
              </NavLink>
            )
          })}

          {/* User profile card */}
          {expanded && user && (
            <div className="mt-2 p-3 rounded-xl bg-[var(--bg-tertiary)]/50 border border-[var(--border-secondary)]">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white text-xs font-bold shadow-sm">
                  {getInitials(user.name || user.email || '')}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-[var(--text-primary)] truncate">{user.name || user.email}</p>
                  <p className="text-[10px] text-[var(--text-tertiary)] truncate">{user.role === 'admin' ? t('settings.admin') : t('settings.user')}</p>
                </div>
                <button
                  onClick={() => signOut()}
                  className="p-1.5 rounded-lg hover:bg-[var(--bg-primary)] transition-colors text-[var(--text-tertiary)] hover:text-danger"
                  title={t('nav.logout')}
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Collapse toggle (desktop only) */}
        <div className="hidden lg:flex items-center justify-center py-2.5 border-t border-[var(--border-primary)]">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors text-[var(--text-tertiary)]"
          >
            {isRtl ? (
              sidebarOpen ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />
            ) : (
              sidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />
            )}
          </button>
        </div>
      </aside>
    </>
  )
}
