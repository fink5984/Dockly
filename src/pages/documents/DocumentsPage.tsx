import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FolderOpen, HardDrive, Eye } from 'lucide-react'
import { useI18n } from '@/contexts/I18nContext'
import { useApi } from '@/hooks/useApi'
import { insightsApi, clientsApi, requestsApi, signaturesApi } from '@/services'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { SearchInput, Select, Input } from '@/components/ui/Field'
import { PageHeader } from '@/components/ui/Misc'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Badge, SignatureStatusBadge, DocStatusBadge } from '@/components/ui/Badge'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/States'
import { FileIcon } from '@/components/ui/Upload'
import { FilePreview } from '@/components/domain/FilePreview'
import type { DocStatus, LibraryItem, SignatureStatus } from '@/types'

export default function DocumentsPage() {
  const { t, fmt } = useI18n()
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [filters, setFilters] = useState({ source: '', clientId: '', type: '', from: '', to: '' })
  const [preview, setPreview] = useState<LibraryItem | null>(null)
  useEffect(() => { const id = setTimeout(() => setQ(search), 250); return () => clearTimeout(id) }, [search])
  const key = `documents:${q}:${JSON.stringify(filters)}`
  const { data, error, loading, refetch } = useApi(key, () => insightsApi.documents({ search: q || undefined, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) }), { topics: ['requests', 'signatures'] })
  const clients = useApi('clients:all', () => clientsApi.list(), { topics: ['clients'] })
  const set = (k: keyof typeof filters) => (v: string) => setFilters((f) => ({ ...f, [k]: v }))
  const active = Object.values(filters).some(Boolean) || q

  const columns: Column<LibraryItem>[] = [
    {
      id: 'file', header: t('documents.col.file'),
      cell: (d) => (
        <div className="flex min-w-0 items-center gap-3">
          <FileIcon mime={d.mimeType} name={d.fileName} />
          <div className="min-w-0">
            <p className="truncate font-medium">{d.label}</p>
            <p className="truncate text-xs text-fg-3"><bdi>{d.fileName}</bdi> · {fmt.bytes(d.size)}{d.versions > 1 ? ` · ${t('requests.detail.versionCount', { count: d.versions })}` : ''}</p>
          </div>
        </div>
      ),
    },
    { id: 'client', header: t('documents.col.client'), hideBelow: 'md', cell: (d) => <Link to={`/app/clients/${d.clientId}`} className="text-fg-2 hover:underline">{d.clientName}</Link> },
    {
      id: 'source', header: t('documents.col.source'), hideBelow: 'lg',
      cell: (d) => <Link to={d.source === 'requests' ? `/app/requests/${d.parentId}` : `/app/signatures/${d.parentId}`} className="flex items-center gap-1.5 text-fg-3 hover:text-fg-2"><Badge>{t(`documents.source.${d.source}`)}</Badge><span className="truncate">{d.parentTitle}</span></Link>,
    },
    { id: 'status', header: t('documents.col.status'), cell: (d) => (d.source === 'signatures' ? <SignatureStatusBadge status={d.status as SignatureStatus} /> : <DocStatusBadge status={d.status as DocStatus} />) },
    { id: 'date', header: t('documents.col.date'), hideBelow: 'md', cell: (d) => <span className="text-fg-3">{fmt.date(d.at)}</span> },
    { id: 'actions', header: <span className="sr-only">{t('common.view')}</span>, align: 'end', cell: (d) => <Button size="sm" variant="ghost" icon={<Eye className="size-4" />} onClick={() => setPreview(d)}>{t('common.view')}</Button> },
  ]

  return (
    <>
      <PageHeader
        title={t('documents.title')}
        description={t('documents.subtitle')}
        meta={data && <span className="inline-flex items-center gap-1.5"><HardDrive className="size-3.5" />{t('documents.usage', { size: fmt.bytes(data.usage.bytes), count: data.usage.versions })}</span>}
      />
      <Card className="overflow-hidden">
        <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-6 sm:px-5">
          <SearchInput value={search} onChange={setSearch} placeholder={t('documents.search')} aria-label={t('documents.search')} className="lg:col-span-2" clearLabel={t('common.clear')} />
          <Select selectSize="sm" aria-label={t('documents.col.client')} value={filters.clientId} onChange={(e) => set('clientId')(e.target.value)} options={[{ value: '', label: t('documents.allClients') }, ...(clients.data || []).map((c) => ({ value: c.id, label: c.name }))]} />
          <Select selectSize="sm" aria-label={t('documents.col.source')} value={filters.source} onChange={(e) => set('source')(e.target.value)} options={[{ value: '', label: t('documents.allSources') }, { value: 'requests', label: t('documents.source.requests') }, { value: 'signatures', label: t('documents.source.signatures') }]} />
          <Select selectSize="sm" aria-label={t('documents.type')} value={filters.type} onChange={(e) => set('type')(e.target.value)} options={[{ value: '', label: t('documents.allTypes') }, { value: 'pdf', label: 'PDF' }, { value: 'image', label: t('documents.images') }]} />
          <div className="flex items-center gap-2">
            <Input inputSize="sm" type="date" aria-label={t('documents.from')} value={filters.from} onChange={(e) => set('from')(e.target.value)} />
            <Input inputSize="sm" type="date" aria-label={t('documents.to')} value={filters.to} onChange={(e) => set('to')(e.target.value)} />
          </div>
        </div>
        {error ? <ErrorState onRetry={refetch} /> : loading ? <ListSkeleton /> : !data?.items.length ? (
          <EmptyState icon={<FolderOpen />} title={active ? t('documents.noMatches') : t('documents.emptyTitle')} description={active ? undefined : t('documents.emptyHint')}
            action={active ? <Button size="sm" onClick={() => { setSearch(''); setFilters({ source: '', clientId: '', type: '', from: '', to: '' }) }}>{t('common.clearFilters')}</Button> : undefined} />
        ) : (
          <DataTable
            caption={t('documents.title')}
            columns={columns}
            rows={data.items}
            rowKey={(d) => `${d.source}:${d.id}`}
            onRowClick={setPreview}
            mobileRow={(d) => (
              <div className="flex items-center gap-3">
                <FileIcon mime={d.mimeType} name={d.fileName} />
                <div className="min-w-0 flex-1"><p className="truncate font-medium">{d.label}</p><p className="truncate text-xs text-fg-3">{d.clientName} · {fmt.date(d.at)}</p></div>
              </div>
            )}
          />
        )}
      </Card>
      {preview && (
        <FilePreview
          open
          onClose={() => setPreview(null)}
          title={preview.label}
          fileName={preview.fileName}
          mimeType={preview.mimeType}
          getUrl={() => (preview.source === 'requests' ? requestsApi.fileUrl(preview.parentId, preview.id) : signaturesApi.fileUrl(preview.id, { variant: preview.status === 'signed' ? 'signed' : 'original' }))}
          getDownloadUrl={() => (preview.source === 'requests' ? requestsApi.fileUrl(preview.parentId, preview.id, { disposition: 'attachment' }) : signaturesApi.fileUrl(preview.id, { variant: preview.status === 'signed' ? 'signed' : 'original', disposition: 'attachment' }))}
        />
      )}
    </>
  )
}
