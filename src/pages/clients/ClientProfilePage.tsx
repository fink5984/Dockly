import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Plus, PenLine, Pencil, Archive, ArchiveRestore, Trash2, Phone, Mail, Building2, ClipboardList, FileText, MessageCircle, AlertCircle, ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { useI18n } from '@/contexts/I18nContext'
import { useAuth } from '@/contexts/AuthContext'
import { useApp } from '@/contexts/AppContext'
import { useApi, invalidate } from '@/hooks/useApi'
import { clientsApi, insightsApi, requestsApi } from '@/services'
import { ApiError } from '@/lib/api'
import { Card, CardHeader, CardBody, DetailRow } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader, Avatar } from '@/components/ui/Misc'
import { Menu } from '@/components/ui/Menu'
import { Tabs, TabPanel } from '@/components/ui/Tabs'
import { ConfirmDialog } from '@/components/ui/Dialog'
import { Badge, RequestStatusBadge, SignatureStatusBadge } from '@/components/ui/Badge'
import { EmptyState, ErrorState, ProgressBar, Skeleton } from '@/components/ui/States'
import { FileIcon } from '@/components/ui/Upload'
import { ActivityFeed } from '@/components/domain/ActivityFeed'
import { FilePreview } from '@/components/domain/FilePreview'
import { ClientFormDialog } from './ClientForm'

export default function ClientProfilePage() {
  const { id = '' } = useParams()
  const { t, fmt } = useI18n()
  const { can } = useAuth()
  const { toast, toastError } = useApp()
  const navigate = useNavigate()
  const { data, error, loading, refetch, mutate } = useApi(`client:${id}`, () => clientsApi.overview(id), { topics: ['clients', 'requests', 'signatures'] })
  const activity = useApi(`activity:client:${id}`, () => insightsApi.activity({ clientId: id, limit: 50 }), { topics: ['activity'] })
  const [tab, setTab] = useState('requests')
  const [editOpen, setEditOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [preview, setPreview] = useState<{ requestId: string; id: string; name: string; fileName: string; fileType: string } | null>(null)

  if (error) {
    return error instanceof ApiError && error.status === 404
      ? <EmptyState icon={<AlertCircle />} title={t('clients.notFound')} action={<Button to="/clients">{t('common.back')}</Button>} />
      : <Card><ErrorState onRetry={refetch} /></Card>
  }
  if (loading || !data) return <div className="space-y-6"><Skeleton className="h-20" /><Skeleton className="h-96 rounded-xl" /></div>

  const c = data.client
  const archived = c.status === 'archived'
  const setStatus = async (status: 'active' | 'archived') => {
    try {
      const updated = await clientsApi.update(c.id, { status })
      mutate({ ...data, client: updated })
      invalidate('clients')
      toast({ tone: 'success', title: status === 'archived' ? t('clients.archived') : t('clients.restored') })
    } catch (err) { toastError(err, t('common.error')) }
  }
  const open = data.requests.filter((r) => r.status !== 'completed' && r.status !== 'closed').length

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t('nav.clients'), to: '/clients' }, { label: c.name }]}
        title={<span className="flex items-center gap-3"><Avatar name={c.name} size="lg" /><span>{c.name}</span>{archived && <Badge>{t('clients.tabArchived')}</Badge>}</span>}
        actions={can('member') && (
          <>
            <Button icon={<PenLine className="size-4" />} to={`/signatures/new?clientId=${c.id}`}>{t('clients.requestSignature')}</Button>
            <Button variant="primary" icon={<Plus className="size-4" />} to={`/requests/new?clientId=${c.id}`}>{t('clients.createRequest')}</Button>
            <Menu items={[
              { label: t('common.edit'), icon: <Pencil />, onSelect: () => setEditOpen(true) },
              archived ? { label: t('clients.restore'), icon: <ArchiveRestore />, onSelect: () => setStatus('active') } : { label: t('clients.archive'), icon: <Archive />, onSelect: () => setStatus('archived') },
              ...(can('admin') ? ['separator' as const, { label: t('common.delete'), icon: <Trash2 />, tone: 'danger' as const, onSelect: () => setConfirmDelete(true) }] : []),
            ]} />
          </>
        )}
      />

      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="space-y-6">
          <Card>
            <CardHeader title={t('clients.details')} />
            <CardBody>
              <dl className="divide-y divide-line">
                <DetailRow label={<span className="inline-flex items-center gap-1.5"><Phone className="size-3.5" />{t('clients.phone')}</span>}>
                  {c.phone ? <a href={`tel:${c.phone}`} dir="ltr" className="hover:underline">{c.phone}</a> : '—'}
                  {c.phone && !c.phoneValid && <p className="text-xs font-normal text-warning-fg">{t('clients.phoneInvalid')}</p>}
                </DetailRow>
                <DetailRow label={<span className="inline-flex items-center gap-1.5"><Mail className="size-3.5" />{t('clients.email')}</span>}>
                  {c.email ? <a href={`mailto:${c.email}`} dir="ltr" className="hover:underline">{c.email}</a> : '—'}
                </DetailRow>
                {c.company && <DetailRow label={<span className="inline-flex items-center gap-1.5"><Building2 className="size-3.5" />{t('clients.company')}</span>}>{c.company}</DetailRow>}
                <DetailRow label={t('clients.since')}>{fmt.date(c.createdAt)}</DetailRow>
              </dl>
              {c.notes && <p className="mt-3 whitespace-pre-wrap rounded-md bg-surface-2 p-3 text-sm text-fg-2">{c.notes}</p>}
            </CardBody>
          </Card>
          <Card>
            <CardBody className="grid grid-cols-3 gap-2 pt-5 text-center">
              <div><p className="text-xl font-semibold tabular">{data.requests.length}</p><p className="text-xs text-fg-3">{t('clients.statRequests')}</p></div>
              <div><p className="text-xl font-semibold tabular">{open}</p><p className="text-xs text-fg-3">{t('clients.statOpen')}</p></div>
              <div><p className="text-xl font-semibold tabular">{data.documents.length}</p><p className="text-xs text-fg-3">{t('clients.statFiles')}</p></div>
            </CardBody>
          </Card>
        </aside>

        <Card className="min-w-0 overflow-hidden">
          <div className="px-4 pt-2 sm:px-5">
            <Tabs label={t('clients.sections')} value={tab} onChange={setTab} tabs={[
              { id: 'requests', label: t('nav.requests'), count: data.requests.length },
              { id: 'documents', label: t('nav.documents'), count: data.documents.length },
              { id: 'signatures', label: t('nav.signatures'), count: data.signatures.length },
              { id: 'messages', label: t('clients.messages'), count: data.messages.length },
              { id: 'timeline', label: t('clients.timeline') },
            ]} />
          </div>
          <TabPanel id="requests" active={tab === 'requests'}>
            {data.requests.length === 0 ? <EmptyState compact icon={<ClipboardList />} title={t('clients.noRequests')} action={can('member') && <Button size="sm" variant="primary" to={`/requests/new?clientId=${c.id}`}>{t('clients.createRequest')}</Button>} /> : (
              <ul className="divide-y divide-line">
                {data.requests.map((r) => (
                  <li key={r.id}>
                    <Link to={`/requests/${r.id}`} className="flex flex-col gap-2 px-5 py-3.5 hover:bg-surface-2 sm:flex-row sm:items-center sm:gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{r.title}</p>
                        <p className="text-xs text-fg-3">{fmt.date(r.createdAt)}{r.deadline ? ` · ${t('requests.detail.due', { date: fmt.date(r.deadline) })}` : ''}</p>
                      </div>
                      <div className="w-40"><ProgressBar value={r.progress.percent} label={t('common.progress')} /></div>
                      <RequestStatusBadge status={r.status} overdue={Boolean(r.deadline && new Date(r.deadline) < new Date() && r.status !== 'completed' && r.status !== 'closed')} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </TabPanel>
          <TabPanel id="documents" active={tab === 'documents'}>
            {data.documents.length === 0 ? <EmptyState compact icon={<FileText />} title={t('clients.noDocuments')} /> : (
              <ul className="divide-y divide-line">
                {data.documents.map((d) => (
                  <li key={d.id}>
                    <button type="button" onClick={() => setPreview({ requestId: d.requestId, id: d.id, name: d.name, fileName: d.fileName, fileType: d.fileType })} className="flex w-full items-center gap-3 px-5 py-3 text-start hover:bg-surface-2">
                      <FileIcon mime={d.fileType} name={d.fileName} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{d.name}</span>
                        <span className="block truncate text-xs text-fg-3"><bdi>{d.fileName}</bdi> · {fmt.bytes(d.fileSize)} · {fmt.date(d.uploadedAt)}</span>
                      </span>
                      <Badge tone={d.status === 'approved' ? 'success' : d.status === 'rejected' ? 'danger' : 'info'}>{t(`status.doc.${['received', 'under-review'].includes(d.status) ? 'uploaded' : d.status === 'approved' || d.status === 'rejected' ? d.status : 'uploaded'}`)}</Badge>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </TabPanel>
          <TabPanel id="signatures" active={tab === 'signatures'}>
            {data.signatures.length === 0 ? <EmptyState compact icon={<PenLine />} title={t('clients.noSignatures')} action={can('member') && <Button size="sm" to={`/signatures/new?clientId=${c.id}`}>{t('clients.requestSignature')}</Button>} /> : (
              <ul className="divide-y divide-line">
                {data.signatures.map((s) => (
                  <li key={s.id}>
                    <Link to={`/signatures/${s.id}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-surface-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{s.title}</span>
                        <span className="text-xs text-fg-3">{s.signedAt ? t('signatures.signedOn', { date: fmt.date(s.signedAt) }) : fmt.date(s.createdAt)}</span>
                      </span>
                      <SignatureStatusBadge status={s.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </TabPanel>
          <TabPanel id="messages" active={tab === 'messages'}>
            {data.messages.length === 0 ? <EmptyState compact icon={<MessageCircle />} title={t('clients.noMessages')} /> : (
              <ul className="divide-y divide-line">
                {data.messages.map((m) => (
                  <li key={m.id} className="flex items-start gap-3 px-5 py-3">
                    {m.direction === 'inbound' ? <ArrowDownLeft className="mt-0.5 size-4 shrink-0 text-success" /> : <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-brand-600" />}
                    <div className="min-w-0 flex-1">
                      <p className="whitespace-pre-wrap break-words text-sm text-fg-2">{m.content}</p>
                      <p className="mt-0.5 text-xs text-fg-4">{fmt.dateTime(m.createdAt)} · {t(`clients.direction.${m.direction}`)}</p>
                    </div>
                    {m.direction === 'outbound' && <Badge tone={m.status === 'failed' ? 'danger' : m.status === 'read' || m.status === 'delivered' ? 'success' : 'neutral'}>{t(`status.delivery.${m.status === 'pending' ? 'skipped' : m.status}`)}</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </TabPanel>
          <TabPanel id="timeline" active={tab === 'timeline'} className="p-5">
            {activity.data?.length ? <ActivityFeed items={activity.data} showClient={false} /> : <EmptyState compact title={t('activity.empty')} />}
          </TabPanel>
        </Card>
      </div>

      <ClientFormDialog open={editOpen} onClose={() => setEditOpen(false)} client={c} onSaved={(u) => { mutate({ ...data, client: u }); invalidate('clients') }} />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          try {
            await clientsApi.remove(c.id)
            invalidate('clients')
            toast({ tone: 'success', title: t('clients.deleted') })
            navigate('/clients')
          } catch (err) {
            if (err instanceof ApiError && err.code === 'client_has_records') toast({ tone: 'warning', title: t('clients.cannotDelete'), message: t('clients.cannotDeleteHint') })
            else toastError(err, t('common.error'))
            throw err
          }
        }}
        title={t('clients.deleteTitle', { name: c.name })}
        description={t('clients.deleteHint')}
        confirmLabel={t('common.delete')}
      />
      {preview && (
        <FilePreview open onClose={() => setPreview(null)} title={preview.name} fileName={preview.fileName} mimeType={preview.fileType}
          getUrl={() => requestsApi.fileUrl(preview.requestId, preview.id)}
          getDownloadUrl={() => requestsApi.fileUrl(preview.requestId, preview.id, { disposition: 'attachment' })} />
      )}
    </>
  )
}
