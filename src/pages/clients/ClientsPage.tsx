import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { UserPlus, Users, Phone, Mail, AlertTriangle } from 'lucide-react'
import { useI18n } from '@/contexts/I18nContext'
import { useAuth } from '@/contexts/AuthContext'
import { useApp } from '@/contexts/AppContext'
import { useApi, invalidate } from '@/hooks/useApi'
import { clientsApi } from '@/services'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { SearchInput } from '@/components/ui/Field'
import { PageHeader, Avatar } from '@/components/ui/Misc'
import { Tabs } from '@/components/ui/Tabs'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Badge } from '@/components/ui/Badge'
import { Tooltip } from '@/components/ui/Tooltip'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/States'
import { ClientFormDialog } from './ClientForm'
import type { Client } from '@/types'

export default function ClientsPage() {
  const { t, fmt } = useI18n()
  const { can } = useAuth()
  const { toast } = useApp()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'active' | 'archived' | 'all'>('active')
  const [sort, setSort] = useState<{ id: string; dir: 'asc' | 'desc' }>({ id: 'activity', dir: 'desc' })
  const [formOpen, setFormOpen] = useState(params.get('new') === '1')
  const { data, error, loading, refetch } = useApi('clients:all', () => clientsApi.list(), { topics: ['clients', 'requests'] })

  useEffect(() => {
    if (params.get('new') === '1') { setFormOpen(true); params.delete('new'); setParams(params, { replace: true }) }
  }, [params, setParams])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = (data || []).filter((c) => (status === 'all' || (status === 'archived' ? c.status === 'archived' : c.status !== 'archived'))
      && (!q || `${c.name} ${c.email} ${c.phone} ${c.company || ''}`.toLowerCase().includes(q)))
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      if (sort.id === 'name') return a.name.localeCompare(b.name) * dir
      if (sort.id === 'open') return ((a.stats?.openRequests || 0) - (b.stats?.openRequests || 0)) * dir
      return (new Date(a.stats?.lastActivityAt || a.updatedAt).getTime() - new Date(b.stats?.lastActivityAt || b.updatedAt).getTime()) * dir
    })
  }, [data, search, status, sort])

  const counts = { active: (data || []).filter((c) => c.status !== 'archived').length, archived: (data || []).filter((c) => c.status === 'archived').length }

  const columns: Column<Client>[] = [
    {
      id: 'name', header: t('clients.col.client'), sortable: true,
      cell: (c) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={c.name} />
          <div className="min-w-0">
            <p className="truncate font-medium text-fg">{c.name}</p>
            {c.company && <p className="truncate text-xs text-fg-3">{c.company}</p>}
          </div>
        </div>
      ),
    },
    {
      id: 'contact', header: t('clients.col.contact'), hideBelow: 'md',
      cell: (c) => (
        <div className="space-y-0.5 text-xs text-fg-3" dir="ltr">
          {c.phone && <p className="flex items-center gap-1.5 rtl:justify-end"><Phone className="size-3" />{c.phone}{!c.phoneValid && <Tooltip content={t('clients.phoneInvalidHint')}><AlertTriangle className="size-3 text-warning" aria-label={t('clients.phoneInvalid')} /></Tooltip>}</p>}
          {c.email && <p className="flex items-center gap-1.5 rtl:justify-end"><Mail className="size-3" />{c.email}</p>}
          {!c.phone && !c.email && <span className="text-fg-4">—</span>}
        </div>
      ),
    },
    {
      id: 'open', header: t('clients.col.requests'), sortable: true,
      cell: (c) => c.stats?.openRequests ? <Badge tone="info">{t('clients.openCount', { count: c.stats.openRequests })}</Badge> : <span className="text-xs text-fg-4">{t('clients.requestsCount', { count: c.stats?.requests || 0 })}</span>,
    },
    { id: 'activity', header: t('clients.col.activity'), sortable: true, hideBelow: 'lg', cell: (c) => <span className="text-fg-3">{fmt.relative(c.stats?.lastActivityAt || c.updatedAt)}</span> },
  ]

  return (
    <>
      <PageHeader
        title={t('clients.title')}
        description={t('clients.subtitle')}
        actions={can('member') && <Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setFormOpen(true)}>{t('clients.new')}</Button>}
      />
      <Card className="overflow-hidden">
        <div className="px-4 pt-2 sm:px-5">
          <Tabs label={t('clients.filter')} value={status} onChange={(v) => setStatus(v as typeof status)} tabs={[
            { id: 'active', label: t('clients.tabActive'), count: counts.active },
            { id: 'archived', label: t('clients.tabArchived'), count: counts.archived },
            { id: 'all', label: t('common.all') },
          ]} />
        </div>
        <div className="border-b border-line px-4 py-3 sm:px-5">
          <SearchInput value={search} onChange={setSearch} placeholder={t('clients.search')} aria-label={t('clients.search')} className="sm:max-w-sm" clearLabel={t('common.clear')} />
        </div>
        {error ? <ErrorState onRetry={refetch} /> : loading ? <ListSkeleton /> : rows.length === 0 ? (
          search ? <EmptyState icon={<Users />} title={t('clients.noMatches')} action={<Button size="sm" onClick={() => setSearch('')}>{t('common.clearFilters')}</Button>} />
            : <EmptyState icon={<Users />} title={t('clients.emptyTitle')} description={t('clients.emptyHint')} action={can('member') && <Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setFormOpen(true)}>{t('clients.new')}</Button>} />
        ) : (
          <DataTable
            caption={t('clients.title')}
            columns={columns}
            rows={rows}
            rowKey={(c) => c.id}
            onRowClick={(c) => navigate(`/clients/${c.id}`)}
            sort={sort}
            onSortChange={setSort}
            mobileRow={(c) => (
              <div className="flex items-center gap-3">
                <Avatar name={c.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{c.name}</p>
                  <p className="truncate text-xs text-fg-3" dir="ltr">{c.phone || c.email}</p>
                </div>
                {c.stats?.openRequests ? <Badge tone="info">{c.stats.openRequests}</Badge> : null}
              </div>
            )}
          />
        )}
      </Card>
      <ClientFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={(c) => {
          invalidate('clients')
          toast({ tone: 'success', title: t('clients.created', { name: c.name }), action: { label: t('clients.createRequest'), onClick: () => navigate(`/requests/new?clientId=${c.id}`) } })
        }}
      />
    </>
  )
}
