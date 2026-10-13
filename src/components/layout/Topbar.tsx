import { useNavigate } from 'react-router-dom'
import { Menu as MenuIcon, Search, Plus, Bell, Sun, Moon, Monitor, Languages, LogOut, User, ClipboardList, UserPlus, PenLine, CheckCheck, Settings } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { useI18n } from '@/contexts/I18nContext'
import { useAuth } from '@/contexts/AuthContext'
import { useApp } from '@/contexts/AppContext'
import { useTheme } from '@/contexts/ThemeContext'
import { useApi, invalidate } from '@/hooks/useApi'
import { notificationsApi } from '@/services'
import { Menu } from '@/components/ui/Menu'
import { Button, IconButton } from '@/components/ui/Button'
import { Avatar } from '@/components/ui/Misc'
import { Kbd } from '@/components/ui/States'

function NotificationsButton() {
  const { t, fmt } = useI18n()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const { data = [] } = useApi('notifications', notificationsApi.list, { topics: ['notifications'] })
  const unread = data.filter((n) => !n.read).length
  const [pos, setPos] = useState({ top: 0, left: 0 })

  useEffect(() => {
    if (!open) return
    const r = btn.current!.getBoundingClientRect()
    const w = Math.min(380, window.innerWidth - 16)
    const rtl = document.documentElement.dir === 'rtl'
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(rtl ? r.left : r.right - w, window.innerWidth - w - 8)) })
    const onDown = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus() } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const markAll = async () => {
    await notificationsApi.readAll().catch(() => {})
    invalidate('notifications')
  }

  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={unread ? t('notifications.labelUnread', { count: unread }) : t('notifications.label')}
        aria-expanded={open}
        className="relative inline-flex size-9 items-center justify-center rounded-md text-fg-2 hover:bg-surface-3 hover:text-fg focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
      >
        <Bell className="size-[18px]" />
        {unread > 0 && (
          <span className="absolute end-1.5 top-1.5 flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-4 text-white tabular">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && createPortal(
        <div ref={panel} role="dialog" aria-label={t('notifications.label')} className="fixed z-[150] w-[380px] max-w-[calc(100vw-16px)] overflow-hidden rounded-xl border border-line bg-surface shadow-lg animate-pop-in" style={pos}>
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold">{t('notifications.label')}</h2>
            {unread > 0 && (
              <button type="button" onClick={markAll} className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
                <CheckCheck className="size-3.5" /> {t('notifications.markAll')}
              </button>
            )}
          </div>
          <ul className="max-h-[420px] overflow-y-auto scroll-thin divide-y divide-line">
            {data.length === 0 && <li className="px-4 py-10 text-center text-sm text-fg-3">{t('notifications.empty')}</li>}
            {data.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={async () => {
                    setOpen(false)
                    if (!n.read) { notificationsApi.read(n.id).then(() => invalidate('notifications')).catch(() => {}) }
                    if (n.actionUrl) navigate(n.actionUrl)
                  }}
                  className="flex w-full gap-3 px-4 py-3 text-start hover:bg-surface-2"
                >
                  <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-brand-600')} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block text-sm', n.read ? 'text-fg-2' : 'font-medium text-fg')}>{n.title}</span>
                    {n.message && <span className="mt-0.5 block truncate text-xs text-fg-3">{n.message}</span>}
                    <span className="mt-1 block text-2xs text-fg-4">{fmt.relative(n.timestamp)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      )}
    </>
  )
}

export function Topbar() {
  const { t, language, setLanguage } = useI18n()
  const { user, signOut, can } = useAuth()
  const { setMobileNavOpen, setCommandOpen } = useApp()
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-surface/90 px-3 backdrop-blur supports-[backdrop-filter]:bg-surface/75 sm:px-5">
      <IconButton className="lg:hidden" label={t('nav.openMenu')} icon={<MenuIcon className="size-5" />} onClick={() => setMobileNavOpen(true)} tooltip={false} />

      <button
        type="button"
        onClick={() => setCommandOpen(true)}
        className="group flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-line-2 bg-surface-2 px-3 text-sm text-fg-4 transition-colors hover:border-fg-4/50 sm:max-w-sm focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
        aria-label={t('search.open')}
      >
        <Search className="size-4 shrink-0" />
        <span className="truncate">{t('search.placeholder')}</span>
        <span className="ms-auto hidden items-center gap-0.5 sm:flex"><Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd><Kbd>K</Kbd></span>
      </button>

      <div className="ms-auto flex items-center gap-1">
        {can('member') && (
          <Menu
            label={t('quickCreate.label')}
            items={[
              { label: t('quickCreate.request'), icon: <ClipboardList />, onSelect: () => navigate('/requests/new') },
              { label: t('quickCreate.client'), icon: <UserPlus />, onSelect: () => navigate('/clients?new=1') },
              { label: t('quickCreate.signature'), icon: <PenLine />, onSelect: () => navigate('/signatures/new') },
            ]}
            trigger={(p) => (
              <Button ref={p.ref as (el: HTMLButtonElement | null) => void} onClick={p.onClick} aria-haspopup="menu" aria-expanded={p['aria-expanded']} aria-controls={p['aria-controls']} variant="primary" size="sm" icon={<Plus className="size-4" />}>
                <span className="hidden sm:inline">{t('quickCreate.label')}</span>
              </Button>
            )}
          />
        )}
        <NotificationsButton />
        <Menu
          label={t('nav.account')}
          items={[
            { heading: user?.email || '' },
            { label: t('nav.profile'), icon: <User />, onSelect: () => navigate('/settings/profile') },
            { label: t('nav.settings'), icon: <Settings />, onSelect: () => navigate('/settings') },
            'separator',
            { heading: t('theme.label') },
            { label: t('theme.light'), icon: <Sun />, onSelect: () => setTheme('light'), hint: theme === 'light' ? '✓' : undefined },
            { label: t('theme.dark'), icon: <Moon />, onSelect: () => setTheme('dark'), hint: theme === 'dark' ? '✓' : undefined },
            { label: t('theme.system'), icon: <Monitor />, onSelect: () => setTheme('system'), hint: theme === 'system' ? '✓' : undefined },
            'separator',
            { label: language === 'he' ? 'English' : 'עברית', icon: <Languages />, onSelect: () => setLanguage(language === 'he' ? 'en' : 'he') },
            'separator',
            { label: t('auth.signOut'), icon: <LogOut />, onSelect: () => { signOut().then(() => navigate('/auth/signin')) }, tone: 'danger' },
          ]}
          trigger={(p) => (
            <button
              ref={p.ref}
              type="button"
              onClick={p.onClick}
              aria-haspopup="menu"
              aria-expanded={p['aria-expanded']}
              aria-controls={p['aria-controls']}
              aria-label={t('nav.account')}
              className="ms-1 rounded-full focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
            >
              <Avatar name={user?.name || user?.email || '?'} />
            </button>
          )}
        />
      </div>
    </header>
  )
}
