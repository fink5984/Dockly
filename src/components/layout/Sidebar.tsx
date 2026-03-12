import { NavLink, useLocation } from 'react-router-dom'
import { useI18n } from '@/contexts/I18nContext'
import { useApp } from '@/contexts/AppContext'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, Users, ClipboardList,
  Settings, X, ChevronLeft, ChevronRight, PenLine,
} from 'lucide-react'

const navItems = [
  { key: 'dashboard', path: '/', icon: LayoutDashboard },
  { key: 'clients', path: '/clients', icon: Users },
  { key: 'requests', path: '/requests', icon: ClipboardList },
  { key: 'signatures', path: '/signatures', icon: PenLine },
  { key: 'settings', path: '/settings', icon: Settings },
]

export function Sidebar() {
  const { t, direction } = useI18n()
  const { sidebarOpen, setSidebarOpen, mobileSidebarOpen, setMobileSidebarOpen } = useApp()
  const location = useLocation()

  const isRtl = direction === 'rtl'

  return (
    <>
      {/* Mobile overlay */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed top-0 bottom-0 z-50 flex flex-col transition-all duration-300 ease-in-out',
          'text-[var(--text-sidebar)]',
          isRtl ? 'right-0' : 'left-0',
          sidebarOpen ? 'w-64' : 'w-[72px]',
          'lg:translate-x-0',
          mobileSidebarOpen
            ? 'translate-x-0 w-72'
            : isRtl ? 'translate-x-full lg:translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
        style={{ background: 'linear-gradient(180deg, #0d1117 0%, #0f172a 100%)' }}
      >
        {/* Top gradient line */}
        <div className="h-[2px] w-full" style={{ background: 'linear-gradient(90deg, transparent, rgba(99,102,241,0.5), transparent)' }} />

        {/* Logo */}
        <div className="flex items-center justify-between h-16 px-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center text-white font-bold text-sm"
              style={{ boxShadow: '0 0 12px rgba(99,102,241,0.5)' }}
            >
              D
            </div>
            {(sidebarOpen || mobileSidebarOpen) && (
              <span className="text-lg font-semibold text-white tracking-tight">
                Dockly
              </span>
            )}
          </div>
          <button
            onClick={() => setMobileSidebarOpen(false)}
            className="lg:hidden p-1 rounded hover:bg-white/10"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {navItems.map((item) => {
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
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 relative',
                  isActive
                    ? 'bg-indigo-500/15 text-white shadow-sm'
                    : 'text-[var(--text-sidebar)] hover:bg-[var(--bg-sidebar-hover)] hover:text-white',
                  !sidebarOpen && !mobileSidebarOpen && 'justify-center px-0'
                )}
                title={!sidebarOpen ? t(`nav.${item.key}`) : undefined}
              >
                {isActive && (
                  <div className={cn(
                    'absolute top-1 bottom-1 w-[3px] rounded-full bg-indigo-500',
                    isRtl ? 'right-0' : 'left-0'
                  )} />
                )}
                <Icon className="w-5 h-5 shrink-0" />
                {(sidebarOpen || mobileSidebarOpen) && (
                  <span>{t(`nav.${item.key}`)}</span>
                )}
              </NavLink>
            )
          })}
        </nav>

        {/* Collapse toggle (desktop only) */}
        <div className="hidden lg:flex items-center justify-center py-3 border-t border-white/10">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
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
