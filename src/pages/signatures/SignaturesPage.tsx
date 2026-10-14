import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PenLine, Plus } from 'lucide-react'
import { useI18n } from '@/contexts/I18nContext'
import { useAuth } from '@/contexts/AuthContext'
import { useApi } from '@/hooks/useApi'
import { signaturesApi } from '@/services'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { SearchInput } from '@/components/ui/Field'
import { PageHeader, Avatar } from '@/components/ui/Misc'
import { Tabs } from '@/components/ui/Tabs'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { SignatureStatusBadge } from '@/components/ui/Badge'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/States'
import type { SignatureRequest } from '@/types'

const GROUPS: Record<string, SignatureRequest['status'][]> = {
  all: [], awaiting: ['pending', 'viewed'], signed: ['signed'], ended: ['declined', 'expired', 'cancelled'],
}

export default function SignaturesPage() {
  const { t, fmt } = useI18n()
  const { can } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState('all')
  const [q, setQ] = useState('')
  const { data, error, loading, refetch } = useApi('signatures', () => signaturesApi.list(), { topics: ['signatures'] })

  const rows = useMemo(() => (data || []).filter((s) =>
    (tab === 'all' || GROUPS[tab].includes(s.status)) && (!q || `${s.title} ${s.clientName}`.toLowerCase().includes(q.toLowerCase()))), [data, tab, q])
  const count = (g: string) => (data || []).filter((s) => g === 'all' || GROUPS[g].includes(s.status)).length

  const columns: Column<SignatureRequest>[] = [
    {
      id: 'title', header: t('signatures.col.document'),
      cell: (s) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{s.title}</p>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-fg-3"><Avatar name={s.clientName} size="xs" />{s.clientName}</p>
        </div>
      ),
    },
    { id: 'status', header: t('signatures.col.status'), cell: (s) => <SignatureStatusBadge status={s.status} /> },
    { id: 'sent', header: t('signatures.col.sent'), hideBelow: 'md', cell: (s) => <span className="text-fg-3">{fmt.date(s.createdAt)}</span> },
    {
      id: 'when', header: t('signatures.col.update'), hideBelow: 'lg',
      cell: (s) => <span className="text-fg-3">{s.signedAt ? t('signatures.signedOn', { date: fmt.relative(s.signedAt) }) : s.viewedAt ? t('signatures.viewedOn', { date: fmt.relative(s.viewedAt) }) : s.expiresAt ? t('signatures.expiresOn', { date: fmt.date(s.expiresAt) }) : '—'}</span>,
    },
  ]

  return (
    <>
      <PageHeader
        title={t('signatures.title')}
        description={t('signatures.subtitle')}
        actions={can('member') && <Button to="/app/signatures/new" variant="primary" icon={<Plus className="size-4" />}>{t('signatures.new')}</Button>}
      />
      <Card className="overflow-hidden">
        <div className="px-4 pt-2 sm:px-5">
          <Tabs label={t('signatures.filter')} value={tab} onChange={setTab} tabs={Object.keys(GROUPS).map((g) => ({ id: g, label: t(`signatures.tab.${g}`), count: count(g) }))} />
        </div>
        <div className="border-b border-line px-4 py-3 sm:px-5">
          <SearchInput value={q} onChange={setQ} placeholder={t('signatures.search')} aria-label={t('signatures.search')} className="sm:max-w-sm" clearLabel={t('common.clear')} />
        </div>
        {error ? <ErrorState onRetry={refetch} /> : loading ? <ListSkeleton /> : rows.length === 0 ? (
          <EmptyState icon={<PenLine />} title={data?.length ? t('signatures.noMatches') : t('signatures.emptyTitle')} description={data?.length ? undefined : t('signatures.emptyHint')}
            action={!data?.length && can('member') && <Button to="/app/signatures/new" variant="primary" icon={<Plus className="size-4" />}>{t('signatures.new')}</Button>} />
        ) : (
          <DataTable
            caption={t('signatures.title')}
            columns={columns}
            rows={rows}
            rowKey={(s) => s.id}
            onRowClick={(s) => navigate(`/app/signatures/${s.id}`)}
            mobileRow={(s) => (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><p className="truncate font-medium">{s.title}</p><p className="truncate text-xs text-fg-3">{s.clientName} · {fmt.date(s.createdAt)}</p></div>
                <SignatureStatusBadge status={s.status} />
              </div>
            )}
          />
        )}
      </Card>
    </>
  )
}
