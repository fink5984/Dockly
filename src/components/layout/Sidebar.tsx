import { useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, ClipboardList, Users, PenLine, FolderOpen, Activity, LayoutTemplate,
  Zap, Plug, Settings, PanelLeftClose, PanelLeftOpen, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/contexts/I18nContext'
import { useAuth } from '@/contexts/AuthContext'
import { useApp } from '@/contexts/AppContext'
import { Tooltip } from '@/components/ui/Tooltip'
import { Logo } from './Logo'

interface NavItem { key: string; to: string; icon: typeof LayoutDashboard; end?: boolean }

const groups: { key: string; items: NavItem[] }[] = [
  {
    key: 'work',
    items: [
      { key: 'overview', to: '/', icon: LayoutDashboard, end: true },
      { key: 'requests', to: '/requests', icon: ClipboardList },
      { key: 'clients', to: '/clients', icon: Users },
      { key: 'signatures', to: '/signatures', icon: PenLine },
      { key: 'documents', to: '/documents', icon: FolderOpen },
    ],
  },
  {
    key: 'workspace',
    items: [
      { key: 'activity', to: '/activity', icon: Activity },
      { key: 'templates', to: '/templates', icon: LayoutTemplate },
      { key: 'automation', to: '/settings/automation', icon: Zap },
      { key: 'integrations', to: '/settings/integrations', icon: Plug },
      { key: 'settings', to: '/settings', icon: Settings, end: true },
    ],
  },
]

function NavList({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { t } = useI18n()
  const { pathname } = useLocation()
  const isActive = (item: NavItem) => {
    if (item.end) return item.to === '/' ? pathname === '/' : pathname === item.to || (item.to === '/settings' && /^\/settings\/(profile|workspace|branding|team|security)/.test(pathname))
    return pathname === item.to || pathname.startsWith(item.to + '/')
  }
  return (
    <nav aria-label={t('nav.main')} className="flex-1 overflow-y-auto scroll-thin px-3 py-3">
      {groups.map((g) => (
        <div key={g.key} className="mb-5 last:mb-0">
          {!collapsed && <p className="mb-1 px-2.5 text-2xs font-semibold uppercase tracking-wider text-fg-4">{t(`nav.group.${g.key}`)}</p>}
          {collapsed && <div className="mx-auto mb-2 h-px w-6 bg-line first:hidden" />}
          <ul className="space-y-0.5">
            {g.items.map((item) => {
              const active = isActive(item)
              const Icon = item.icon
              const link = (
                <NavLink
                  to={item.to}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'group relative flex h-9 items-center gap-3 rounded-md text-sm font-medium transition-colors',
                    'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
                    collapsed ? 'justify-center px-0' : 'px-2.5',
                    active ? 'bg-brand-soft text-brand-700' : 'text-fg-2 hover:bg-surface-3 hover:text-fg',
                  )}
                >
                  {active && <span className="absolute inset-y-2 start-0 w-[3px] rounded-full bg-brand-600" aria-hidden />}
                  <Icon className={cn('size-[18px] shrink-0', active ? 'text-brand-600' : 'text-fg-3 group-hover:text-fg-2')} />
                  {!collapsed && <span className="truncate">{t(`nav.${item.key}`)}</span>}
                </NavLink>
              )
              return <li key={item.key}>{collapsed ? <Tooltip content={t(`nav.${item.key}`)} side="end">{link}</Tooltip> : link}</li>
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}

function WorkspaceHeader({ collapsed }: { collapsed: boolean }) {
  const { workspace } = useAuth()
  return (
    <div className={cn('flex h-14 shrink-0 items-center gap-2.5 border-b border-line', collapsed ? 'justify-center px-2' : 'px-4')}>
      {workspace?.logo ? (
        <img src={workspace.logo} alt="" className="size-7 rounded-md object-contain bg-surface border border-line" />
      ) : <Logo className="size-7" />}
      {!collapsed && (
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-fg">{workspace?.name || 'Dockly'}</p>
          <p className="truncate text-2xs text-fg-4">Dockly</p>
        </div>
      )}
    </div>
  )
}

export function Sidebar() {
  const { t } = useI18n()
  const { sidebarCollapsed, setSidebarCollapsed, mobileNavOpen, setMobileNavOpen } = useApp()
  const { pathname } = useLocation()

  useEffect(() => { setMobileNavOpen(false) }, [pathname, setMobileNavOpen])
  useEffect(() => {
    if (!mobileNavOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobileNavOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [mobileNavOpen, setMobileNavOpen])

  return (
    <>
      {/* Desktop */}
      <aside
        className={cn(
          'fixed inset-y-0 start-0 z-40 hidden flex-col border-e border-line bg-surface transition-[width] duration-200 lg:flex',
          sidebarCollapsed ? 'w-[68px]' : 'w-60',
        )}
      >
        <WorkspaceHeader collapsed={sidebarCollapsed} />
        <NavList collapsed={sidebarCollapsed} />
        <div className={cn('border-t border-line p-2', sidebarCollapsed && 'flex justify-center')}>
          <Tooltip content={sidebarCollapsed ? t('nav.expand') : t('nav.collapse')} side="end">
            <button
              type="button"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              aria-label={sidebarCollapsed ? t('nav.expand') : t('nav.collapse')}
              className="flex h-8 items-center gap-2 rounded-md px-2 text-sm text-fg-3 hover:bg-surface-3 hover:text-fg-2"
            >
              {sidebarCollapsed ? <PanelLeftOpen className="size-4 rtl-flip" /> : <PanelLeftClose className="size-4 rtl-flip" />}
              {!sidebarCollapsed && <span>{t('nav.collapse')}</span>}
            </button>
          </Tooltip>
        </div>
      </aside>

      {/* Mobile */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-[90] lg:hidden">
          <div className="absolute inset-0 bg-overlay animate-fade-in" onClick={() => setMobileNavOpen(false)} aria-hidden />
          <aside role="dialog" aria-modal="true" aria-label={t('nav.main')} className="absolute inset-y-0 start-0 flex w-72 max-w-[85vw] flex-col bg-surface shadow-xl animate-fade-in">
            <div className="flex items-center justify-between pe-2">
              <div className="min-w-0 flex-1"><WorkspaceHeader collapsed={false} /></div>
              <button type="button" onClick={() => setMobileNavOpen(false)} className="rounded-md p-2 text-fg-3 hover:bg-surface-3" aria-label={t('common.close')}>
                <X className="size-5" />
              </button>
            </div>
            <NavList collapsed={false} onNavigate={() => setMobileNavOpen(false)} />
          </aside>
        </div>
      )}
    </>
  )
}
