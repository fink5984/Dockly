import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, ClipboardList, Download, CalendarClock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/contexts/I18nContext'
import { useAuth } from '@/contexts/AuthContext'
import { useApi } from '@/hooks/useApi'
import { requestsApi } from '@/services'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { SearchInput, Select } from '@/components/ui/Field'
import { PageHeader, Avatar } from '@/components/ui/Misc'
import { Tabs } from '@/components/ui/Tabs'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { RequestStatusBadge } from '@/components/ui/Badge'
import { EmptyState, ErrorState, ListSkeleton, ProgressBar } from '@/components/ui/States'
import type { DocRequest } from '@/types'

const TABS = ['all', 'open', 'needs-review', 'overdue', 'completed', 'closed'] as const

function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value)
  useEffect(() => { const id = setTimeout(() => setV(value), ms); return () => clearTimeout(id) }, [value, ms])
  return v
}

export function RequestProgress({ r, className }: { r: DocRequest; className?: string }) {
  const { t } = useI18n()
  const p = r.progress
  return (
    <div className={cn('min-w-[120px]', className)}>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-fg-3 tabular">{t('requests.receivedOf', { done: p.received, total: p.required || p.total })}</span>
        {p.awaitingReview > 0 && <span className="font-medium text-brand-600">{t('requests.toReview', { count: p.awaitingReview })}</span>}
      </div>
      <ProgressBar value={p.percent} label={t('common.progress')} />
    </div>
  )
}

export function exportCsv(rows: DocRequest[], t: (k: string, v?: Record<string, string | number>) => string) {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const header = [t('requests.col.title'), t('requests.col.client'), t('requests.col.status'), t('requests.col.progress'), t('requests.col.deadline'), t('requests.col.created')]
  const lines = rows.map((r) => [r.title, r.clientName, t(`status.request.${r.status}`), `${r.progress.percent}%`, r.deadline?.slice(0, 10) || '', r.createdAt.slice(0, 10)].map(esc).join(','))
  const blob = new Blob(['﻿' + [header.map(esc).join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `dockly-requests-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export default function RequestsPage() {
  const { t, fmt } = useI18n()
  const { can } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const status = (params.get('status') || 'all') as string
  const sort = params.get('sort') || 'created'
  const page = Number(params.get('page') || 1)
  const [search, setSearch] = useState(params.get('q') || '')
  const q = useDebounced(search)

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === '' || v === 'all') next.delete(k); else next.set(k, v) }
    if (!('page' in patch)) next.delete('page')
    setParams(next, { replace: true })
  }
  useEffect(() => { if ((params.get('q') || '') !== q) update({ q }) }, [q]) // eslint-disable-line react-hooks/exhaustive-deps

  const key = `requests:list:${status}:${sort}:${page}:${q}`
  const { data, error, loading, refetch } = useApi(key, () => requestsApi.list({
    status: status === 'all' ? undefined : status, sort, page, pageSize: 25, search: q || undefined,
  }), { topics: ['requests'] })

  const counts = data?.counts || {}
  const totalAll = Object.values(counts).reduce((a, b) => a + (b || 0), 0)
  const openCount = (counts.new || 0) + (counts['waiting-for-client'] || 0) + (counts['partial-submission'] || 0)

  const columns: Column<DocRequest>[] = [
    {
      id: 'title', header: t('requests.col.request'), sortable: true,
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-fg">{r.title}</p>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-fg-3"><Avatar name={r.clientName} size="xs" />{r.clientName}</p>
        </div>
      ),
    },
    { id: 'status', header: t('requests.col.status'), cell: (r) => <RequestStatusBadge status={r.status} overdue={r.overdue} /> },
    { id: 'progress', header: t('requests.col.progress'), cell: (r) => <RequestProgress r={r} />, hideBelow: 'lg' },
    {
      id: 'deadline', header: t('requests.col.deadline'), sortable: true, hideBelow: 'md',
      cell: (r) => r.deadline ? <span className={cn('tabular', r.overdue ? 'font-medium text-danger-fg' : 'text-fg-2')}>{fmt.date(r.deadline)}</span> : <span className="text-fg-4">—</span>,
    },
    { id: 'updated', header: t('requests.col.activity'), sortable: true, hideBelow: 'xl', cell: (r) => <span className="text-fg-3">{fmt.relative(r.lastActivityDate || r.updatedAt)}</span> },
  ]

  return (
    <>
      <PageHeader
        title={t('requests.title')}
        description={t('requests.subtitle')}
        actions={
          <>
            <Button icon={<Download className="size-4" />} onClick={() => data && exportCsv(data.items, t)} disabled={!data?.items.length}>{t('requests.export')}</Button>
            {can('member') && <Button to="/requests/new" variant="primary" icon={<Plus className="size-4" />}>{t('requests.new')}</Button>}
          </>
        }
      />
      <Card className="overflow-hidden">
        <div className="px-4 pt-2 sm:px-5">
          <Tabs
            label={t('requests.filterLabel')}
            value={status}
            onChange={(id) => update({ status: id })}
            tabs={TABS.map((s) => ({
              id: s,
              label: t(`requests.tab.${s}`),
              count: s === 'all' ? totalAll : s === 'open' ? openCount : s === 'completed' ? counts.completed : s === 'closed' ? counts.closed : undefined,
            }))}
          />
        </div>
        <div className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:px-5">
          <SearchInput value={search} onChange={setSearch} placeholder={t('requests.searchPlaceholder')} className="sm:max-w-xs flex-1" aria-label={t('requests.searchPlaceholder')} clearLabel={t('common.clear')} />
          <Select
            selectSize="sm"
            wrapperClassName="sm:ms-auto sm:w-52"
            aria-label={t('requests.sortLabel')}
            value={sort}
            onChange={(e) => update({ sort: e.target.value })}
            options={['created', 'updated', 'deadline', 'client', 'title'].map((s) => ({ value: s, label: t(`requests.sort.${s}`) }))}
          />
        </div>
        {error ? <ErrorState onRetry={refetch} /> : loading || !data ? <ListSkeleton rows={6} /> : data.items.length === 0 ? (
          q || status !== 'all' ? (
            <EmptyState icon={<ClipboardList />} title={t('requests.noMatches')} description={t('requests.noMatchesHint')} action={<Button size="sm" onClick={() => { setSearch(''); setParams({}, { replace: true }) }}>{t('common.clearFilters')}</Button>} />
          ) : (
            <EmptyState
              icon={<ClipboardList />}
              title={t('requests.emptyTitle')}
              description={t('requests.emptyHint')}
              action={can('member') && <Button to="/requests/new" variant="primary" icon={<Plus className="size-4" />}>{t('requests.new')}</Button>}
            />
          )
        ) : (
          <>
            <DataTable
              caption={t('requests.title')}
              columns={columns}
              rows={data.items}
              rowKey={(r) => r.id}
              onRowClick={(r) => navigate(`/requests/${r.id}`)}
              sort={{ id: sort === 'client' ? 'title' : sort === 'created' ? '' : sort, dir: 'asc' }}
              onSortChange={(s) => update({ sort: s.id === 'title' ? 'title' : s.id })}
              mobileRow={(r) => (
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-fg">{r.title}</p>
                      <p className="truncate text-xs text-fg-3">{r.clientName}</p>
                    </div>
                    <RequestStatusBadge status={r.status} overdue={r.overdue} />
                  </div>
                  <RequestProgress r={r} />
                  {r.deadline && <p className="flex items-center gap-1 text-xs text-fg-3"><CalendarClock className="size-3.5" />{fmt.date(r.deadline)}</p>}
                </div>
              )}
            />
            {data.total > data.pageSize && (
              <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm">
                <span className="text-fg-3">{t('common.showing', { count: data.items.length, total: data.total })}</span>
                <div className="flex gap-2">
                  <Button size="sm" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>{t('common.previous')}</Button>
                  <Button size="sm" disabled={page * data.pageSize >= data.total} onClick={() => update({ page: String(page + 1) })}>{t('common.next')}</Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </>
  )
}
