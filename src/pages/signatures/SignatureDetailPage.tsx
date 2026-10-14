import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Download, FileCheck2, Bell, Ban, Archive, Copy, ExternalLink, ShieldCheck, ShieldAlert, AlertCircle, Mail, User, FileText, Eye } from 'lucide-react'
import { signUrl, copyText } from '@/lib/utils'
import { useI18n } from '@/contexts/I18nContext'
import { useAuth } from '@/contexts/AuthContext'
import { useApp } from '@/contexts/AppContext'
import { useApi, invalidate } from '@/hooks/useApi'
import { signaturesApi, workspaceApi } from '@/services'
import { ApiError } from '@/lib/api'
import { Card, CardHeader, CardBody, DetailRow } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader, CopyButton } from '@/components/ui/Misc'
import { Menu } from '@/components/ui/Menu'
import { ConfirmDialog } from '@/components/ui/Dialog'
import { SignatureStatusBadge } from '@/components/ui/Badge'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States'
import { FileIcon } from '@/components/ui/Upload'
import { FilePreview } from '@/components/domain/FilePreview'

export default function SignatureDetailPage() {
  const { id = '' } = useParams()
  const { t, fmt, language } = useI18n()
  const { can } = useAuth()
  const { toast, toastError } = useApp()
  const navigate = useNavigate()
  const { data: s, error, loading, refetch, mutate } = useApi(`signature:${id}`, () => signaturesApi.get(id), { topics: ['signatures'] })
  const events = useApi(`signature-events:${id}`, () => signaturesApi.events(id), { topics: ['signatures'] })
  const channels = useApi('integrations', workspaceApi.integrations)
  const [preview, setPreview] = useState<{ doc: string; name: string; variant: 'original' | 'signed' } | null>(null)
  const [confirm, setConfirm] = useState<null | 'cancel' | 'archive'>(null)

  if (error) {
    return error instanceof ApiError && error.status === 404
      ? <EmptyState icon={<AlertCircle />} title={t('signatures.notFound')} action={<Button to="/app/signatures">{t('common.back')}</Button>} />
      : <Card><ErrorState onRetry={refetch} /></Card>
  }
  if (loading || !s) return <div className="space-y-6"><Skeleton className="h-10 w-72" /><Skeleton className="h-80 rounded-xl" /></div>

  const link = signUrl(s.publicToken)
  const awaiting = s.status === 'pending' || s.status === 'viewed'
  const signed = s.status === 'signed'
  const download = async (doc: string, variant: 'original' | 'signed') => {
    try {
      const { url } = await signaturesApi.fileUrl(s.id, { doc, variant, disposition: 'attachment' })
      window.location.href = url
    } catch (err) { toastError(err, t('common.error')) }
  }
  const remind = async (channel: 'email' | 'whatsapp') => {
    try {
      await signaturesApi.send(s.id, channel, s.lastReminderAt || s.viewedAt ? 'reminder' : 'request')
      toast({ tone: 'success', title: t('signatures.detail.reminderSent') })
      refetch()
      events.refetch()
    } catch (err) { toastError(err, t('requests.detail.sendFailed')) }
  }
  const allDocs = [{ id: 'main', fileName: s.documentFileName, hasSigned: s.hasSignedDocument }, ...s.documents]

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t('nav.signatures'), to: '/app/signatures' }, { label: s.title }]}
        title={s.title}
        meta={
          <>
            <SignatureStatusBadge status={s.status} size="md" />
            <Link to={`/app/clients/${s.clientId}`} className="inline-flex items-center gap-1.5 hover:text-fg-2"><User className="size-3.5" />{s.clientName}</Link>
            <span>{t('signatures.detail.created', { date: fmt.date(s.createdAt) })}</span>
            {s.expiresAt && awaiting && <span>{t('signatures.expiresOn', { date: fmt.date(s.expiresAt) })}</span>}
          </>
        }
        actions={
          <>
            {signed && <Button icon={<FileCheck2 className="size-4" />} onClick={() => { window.location.href = signaturesApi.certificateUrl(s.id, language) }}>{t('signatures.detail.certificate')}</Button>}
            {signed && <Button variant="primary" icon={<Download className="size-4" />} onClick={() => download('main', 'signed')}>{t('signatures.detail.downloadSigned')}</Button>}
            {awaiting && can('member') && (
              <Button variant="primary" icon={<Bell className="size-4" />} onClick={() => remind('email')} disabled={!channels.data?.email.configured}>
                {t('signatures.detail.remind')}
              </Button>
            )}
            {can('member') && (
              <Menu items={[
                ...(awaiting ? [{ label: t('signatures.detail.cancel'), icon: <Ban />, onSelect: () => setConfirm('cancel') }] : []),
                ...(can('admin') ? [{ label: t('signatures.detail.archive'), icon: <Archive />, tone: 'danger' as const, onSelect: () => setConfirm('archive') }] : []),
              ]} />
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          {s.status === 'declined' && (
            <div role="status" className="flex gap-3 rounded-xl border border-danger/30 bg-danger-soft p-4">
              <AlertCircle className="size-5 shrink-0 text-danger" />
              <div><p className="text-sm font-semibold">{t('signatures.detail.declinedTitle')}</p>{s.declineReason && <p className="mt-1 text-sm text-fg-2">“{s.declineReason}”</p>}</div>
            </div>
          )}
          <Card>
            <CardHeader title={t('signatures.create.documents')} />
            <ul className="divide-y divide-line border-t border-line">
              {allDocs.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <FileIcon mime="application/pdf" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium"><bdi>{d.fileName}</bdi></p>
                    <p className="text-xs text-fg-3">{d.hasSigned ? t('signatures.detail.signedAvailable') : t('signatures.detail.originalOnly')}</p>
                  </div>
                  <Button size="sm" variant="ghost" icon={<Eye className="size-4" />} onClick={() => setPreview({ doc: d.id, name: d.fileName, variant: d.hasSigned ? 'signed' : 'original' })}>{t('common.view')}</Button>
                  <Menu items={[
                    { label: t('signatures.detail.downloadOriginal'), icon: <FileText />, onSelect: () => download(d.id, 'original') },
                    ...(d.hasSigned ? [{ label: t('signatures.detail.downloadSigned'), icon: <Download />, onSelect: () => download(d.id, 'signed') }] : []),
                  ]} />
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader
              title={t('signatures.detail.auditTrail')}
              description={t('signatures.detail.auditHint')}
              action={events.data && (events.data.intact
                ? <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success-fg"><ShieldCheck className="size-4" />{t('signatures.detail.intact')}</span>
                : <span className="inline-flex items-center gap-1.5 text-xs font-medium text-danger-fg"><ShieldAlert className="size-4" />{t('signatures.detail.broken')}</span>)}
            />
            <CardBody>
              {!events.data ? <Skeleton className="h-32" /> : (
                <ol className="space-y-4">
                  {events.data.events.map((e) => (
                    <li key={e.id} className="flex gap-3">
                      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-500" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-fg">{t(`signatures.event.${e.event}`)}{e.actorName ? <span className="text-fg-3"> — {e.actorName}</span> : null}</p>
                        <p className="text-xs text-fg-4">{fmt.dateTime(e.createdAt)}{e.ip ? ` · ${e.ip}` : ''}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
        </div>

        <aside className="space-y-6">
          {awaiting && (
            <Card>
              <CardHeader title={t('signatures.detail.signingLink')} description={t('signatures.detail.signingLinkHint')} />
              <CardBody className="space-y-3">
                <div className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-3" dir="ltr">{link}</span>
                  <CopyButton value={link} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" icon={<Copy className="size-3.5" />} onClick={async () => { if (await copyText(link)) toast({ tone: 'success', title: t('common.linkCopied') }) }}>{t('common.copyLink')}</Button>
                  <Button size="sm" icon={<ExternalLink className="size-3.5" />} onClick={() => window.open(link, '_blank', 'noopener')}>{t('requests.detail.openAsClient')}</Button>
                  {channels.data?.email.configured && <Button size="sm" icon={<Mail className="size-3.5" />} onClick={() => remind('email')}>{t('signatures.detail.emailIt')}</Button>}
                </div>
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title={t('signatures.detail.details')} />
            <CardBody>
              <dl className="divide-y divide-line">
                <DetailRow label={t('signatures.create.client')}>{s.clientName}</DetailRow>
                {s.signerName && <DetailRow label={t('signatures.detail.signer')}>{s.signerName}</DetailRow>}
                {s.viewedAt && <DetailRow label={t('signatures.detail.viewed')}>{fmt.dateTime(s.viewedAt)}</DetailRow>}
                {s.signedAt && <DetailRow label={t('signatures.detail.signed')}>{fmt.dateTime(s.signedAt)}</DetailRow>}
                <DetailRow label={t('signatures.create.fields')}>{s.fields.length}</DetailRow>
                {s.reminderCount > 0 && <DetailRow label={t('signatures.detail.reminders')}>{s.reminderCount}</DetailRow>}
              </dl>
              {(s.originalSha256 || s.signedSha256) && (
                <div className="mt-4 space-y-2 border-t border-line pt-4">
                  {s.originalSha256 && <div><p className="text-xs text-fg-3">{t('signatures.detail.originalHash')}</p><p className="break-all font-mono text-2xs text-fg-2" dir="ltr">{s.originalSha256}</p></div>}
                  {s.signedSha256 && <div><p className="text-xs text-fg-3">{t('signatures.detail.signedHash')}</p><p className="break-all font-mono text-2xs text-fg-2" dir="ltr">{s.signedSha256}</p></div>}
                </div>
              )}
            </CardBody>
          </Card>
          <p className="px-1 text-xs text-fg-4">{t('signatures.create.legalNote')}</p>
        </aside>
      </div>

      {preview && (
        <FilePreview open onClose={() => setPreview(null)} title={preview.name} fileName={preview.name} mimeType="application/pdf"
          getUrl={() => signaturesApi.fileUrl(s.id, { doc: preview.doc, variant: preview.variant })}
          getDownloadUrl={() => signaturesApi.fileUrl(s.id, { doc: preview.doc, variant: preview.variant, disposition: 'attachment' })} />
      )}
      <ConfirmDialog open={confirm === 'cancel'} onClose={() => setConfirm(null)} title={t('signatures.detail.cancelTitle')} description={t('signatures.detail.cancelHint')} confirmLabel={t('signatures.detail.cancel')}
        onConfirm={async () => { try { mutate(await signaturesApi.cancel(s.id)); invalidate('signatures'); events.refetch() } catch (e) { toastError(e, t('common.error')); throw e } }} />
      <ConfirmDialog open={confirm === 'archive'} onClose={() => setConfirm(null)} title={t('signatures.detail.archiveTitle')} description={t('signatures.detail.archiveHint')} confirmLabel={t('signatures.detail.archive')}
        onConfirm={async () => { try { await signaturesApi.archive(s.id); invalidate('signatures'); navigate('/app/signatures') } catch (e) { toastError(e, t('common.error')); throw e } }} />
    </>
  )
}
