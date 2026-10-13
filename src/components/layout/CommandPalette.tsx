import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Search, ClipboardList, Users, PenLine, Plus, LayoutDashboard, FolderOpen, Settings, CornerDownLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useApp } from '@/contexts/AppContext'
import { useI18n } from '@/contexts/I18nContext'
import { insightsApi } from '@/services'
import type { SearchResults } from '@/types'
import { Kbd, Spinner } from '@/components/ui/States'

interface Item { id: string; group: string; label: string; sub?: string; icon: React.ReactNode; to: string }

/** ⌘K / Ctrl+K global search and navigation. */
export function CommandPalette() {
  const { commandOpen, setCommandOpen } = useApp()
  const { t } = useI18n()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<SearchResults | null>(null)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCommandOpen(!commandOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [commandOpen, setCommandOpen])

  useEffect(() => {
    if (!commandOpen) { setQ(''); setResults(null); setActive(0); return }
    requestAnimationFrame(() => input.current?.focus())
  }, [commandOpen])

  useEffect(() => {
    if (q.trim().length < 2) { setResults(null); return }
    const ctrl = new AbortController()
    setLoading(true)
    const timer = setTimeout(() => {
      insightsApi.search(q.trim(), ctrl.signal)
        .then((r) => { setResults(r); setActive(0) })
        .catch(() => {})
        .finally(() => setLoading(false))
    }, 180)
    return () => { clearTimeout(timer); ctrl.abort() }
  }, [q])

  const items: Item[] = useMemo(() => {
    if (!results) {
      return [
        { id: 'a1', group: t('search.actions'), label: t('quickCreate.request'), icon: <Plus />, to: '/requests/new' },
        { id: 'a2', group: t('search.actions'), label: t('quickCreate.client'), icon: <Plus />, to: '/clients?new=1' },
        { id: 'a3', group: t('search.actions'), label: t('quickCreate.signature'), icon: <Plus />, to: '/signatures/new' },
        { id: 'n1', group: t('search.goTo'), label: t('nav.overview'), icon: <LayoutDashboard />, to: '/' },
        { id: 'n2', group: t('search.goTo'), label: t('nav.requests'), icon: <ClipboardList />, to: '/requests' },
        { id: 'n3', group: t('search.goTo'), label: t('nav.clients'), icon: <Users />, to: '/clients' },
        { id: 'n4', group: t('search.goTo'), label: t('nav.signatures'), icon: <PenLine />, to: '/signatures' },
        { id: 'n5', group: t('search.goTo'), label: t('nav.documents'), icon: <FolderOpen />, to: '/documents' },
        { id: 'n6', group: t('search.goTo'), label: t('nav.settings'), icon: <Settings />, to: '/settings' },
      ].filter((i) => !q || i.label.toLowerCase().includes(q.toLowerCase()))
    }
    return [
      ...results.clients.map((c) => ({ id: `c${c.id}`, group: t('nav.clients'), label: c.name, sub: c.email || c.phone, icon: <Users />, to: `/clients/${c.id}` })),
      ...results.requests.map((r) => ({ id: `r${r.id}`, group: t('nav.requests'), label: r.title, sub: r.clientName, icon: <ClipboardList />, to: `/requests/${r.id}` })),
      ...results.signatures.map((s) => ({ id: `s${s.id}`, group: t('nav.signatures'), label: s.title, sub: s.clientName, icon: <PenLine />, to: `/signatures/${s.id}` })),
    ]
  }, [results, q, t])

  if (!commandOpen) return null

  const go = (item?: Item) => {
    if (!item) return
    setCommandOpen(false)
    navigate(item.to)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); go(items[active]) }
    else if (e.key === 'Escape') { e.preventDefault(); setCommandOpen(false) }
  }

  let lastGroup = ''
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-start justify-center p-4 pt-[12vh]">
      <div className="absolute inset-0 bg-overlay animate-fade-in" onClick={() => setCommandOpen(false)} aria-hidden />
      <div role="dialog" aria-modal="true" aria-label={t('search.open')} className="relative w-full max-w-xl overflow-hidden rounded-xl border border-line bg-surface shadow-xl animate-pop-in" onKeyDown={onKeyDown}>
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="size-4 text-fg-4" aria-hidden />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('search.placeholder')}
            className="h-12 flex-1 bg-transparent text-md text-fg outline-none placeholder:text-fg-4"
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-activedescendant={items[active] ? `cmdk-${items[active].id}` : undefined}
          />
          {loading && <Spinner />}
          <Kbd>Esc</Kbd>
        </div>
        <ul id="cmdk-list" role="listbox" className="max-h-[50vh] overflow-y-auto scroll-thin p-2">
          {items.length === 0 && <li className="px-3 py-8 text-center text-sm text-fg-3">{q.trim().length < 2 ? t('search.typeMore') : t('search.noResults')}</li>}
          {items.map((item, i) => {
            const header = item.group !== lastGroup ? item.group : null
            lastGroup = item.group
            return (
              <li key={item.id} role="presentation">
                {header && <div className="px-2 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wide text-fg-4">{header}</div>}
                <div
                  id={`cmdk-${item.id}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => setActive(i)}
                  onClick={() => go(item)}
                  className={cn('flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-sm', i === active ? 'bg-surface-3 text-fg' : 'text-fg-2')}
                >
                  <span className="text-fg-4 [&>svg]:size-4">{item.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{item.label}{item.sub && <span className="ms-2 text-xs text-fg-4">{item.sub}</span>}</span>
                  {i === active && <CornerDownLeft className="size-3.5 text-fg-4 rtl-flip" aria-hidden />}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>,
    document.body,
  )
}
