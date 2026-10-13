import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Send, Bell, Link2, Copy, MoreHorizontal, Pencil, Files, LayoutTemplate, Download, Archive, RotateCcw, Trash2,
  Eye, CheckCircle2, XCircle, Upload, History, Plus, Phone, Mail, ExternalLink, MessageSquare, ShieldOff, ShieldCheck,
  RefreshCw, CalendarClock, StickyNote, ChevronDown, MessageCircle, User, AlertCircle,
} from 'lucide-react'
import { cn, portalUrl, copyText, isoToDateInput } from '@/lib/utils'
import { useI18n } from '@/contexts/I18nContext'
import { useAuth } from '@/contexts/AuthContext'
import { useApp } from '@/contexts/AppContext'
import { useApi, invalidate } from '@/hooks/useApi'
import { requestsApi, libraryApi, insightsApi, supportApi, workspaceApi } from '@/services'
import { ApiError } from '@/lib/api'
import { Card, CardHeader, CardBody, DetailRow } from '@/components/ui/Card'
import { Button, IconButton } from '@/components/ui/Button'
import { Input, Textarea, Select, Switch, Checkbox } from '@/components/ui/Field'
import { PageHeader, CopyButton, Avatar } from '@/components/ui/Misc'
import { Menu } from '@/components/ui/Menu'
import { Dialog, ConfirmDialog, Drawer } from '@/components/ui/Dialog'
import { Badge, DocStatusBadge, RequestStatusBadge } from '@/components/ui/Badge'
import { EmptyState, ErrorState, ProgressRing, Skeleton, Spinner } from '@/components/ui/States'
import { FileIcon, UploadZone, acceptFor, precheckFile } from '@/components/ui/Upload'
import { ActivityFeed } from '@/components/domain/ActivityFeed'
import { FilePreview } from '@/components/domain/FilePreview'
import type { DocRequest, RequestDocument, Language } from '@/types'

type Channel = 'whatsapp' | 'email'

function RejectDialog({ doc, open, onClose, onDone, request }: { doc: RequestDocument | null; open: boolean; onClose: () => void; onDone: (r: DocRequest) => void; request: DocRequest }) {
  const { t } = useI18n()
  const { toast, toastError } = useApp()
  const [reason, setReason] = useState('')
  const [notify, setNotify] = useState(true)
  const [busy, setBusy] = useState(false)
  const quick = ['blurry', 'pagesMissing', 'expired', 'wrongDocument'] as const
  useEffect(() => { if (open) { setReason(''); setNotify(true) } }, [open])
  if (!doc) return null
  const submit = async () => {
    setBusy(true)
    try {
      const res = await requestsApi.review(request.id, doc.id, { action: 'reject', reason: reason.trim(), notifyClient: notify, channel: request.clientPhone ? 'whatsapp' : 'email' })
      onDone(res.request)
      if (notify && res.notify && !res.notify.ok) toast({ tone: 'warning', title: t('requests.detail.rejectedNotNotified'), message: res.notify.error })
      else toast({ tone: 'success', title: t('requests.detail.rejected') })
      onClose()
    } catch (err) {
      toastError(err, t('requests.detail.reviewFailed'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('requests.detail.rejectTitle', { doc: doc.name })}
      description={t('requests.detail.rejectHint')}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="danger" loading={busy} disabled={reason.trim().length < 3} onClick={submit}>{t('requests.detail.requestReplacement')}</Button></>}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {quick.map((q) => (
            <button key={q} type="button" onClick={() => setReason(t(`requests.detail.reasons.${q}`))} className="rounded-full border border-line-2 px-3 py-1 text-xs text-fg-2 hover:border-brand-500 hover:text-brand-700">
              {t(`requests.detail.reasons.${q}`)}
            </button>
          ))}
        </div>
        <Textarea label={t('requests.detail.reasonLabel')} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} autoFocus hint={t('requests.detail.reasonHint')} />
        <Checkbox checked={notify} onChange={(e) => setNotify(e.target.checked)} label={t('requests.detail.notifyClient')} description={t('requests.detail.notifyClientHint')} />
      </div>
    </Dialog>
  )
}

function VersionsDrawer({ request, doc, onClose }: { request: DocRequest; doc: RequestDocument | null; onClose: () => void }) {
  const { t, fmt } = useI18n()
  const { data, loading } = useApi(doc ? `versions:${doc.id}` : null, () => requestsApi.versions(request.id, doc!.id), { topics: ['requests'] })
  const [preview, setPreview] = useState<{ id: string; name: string; mime: string } | null>(null)
  return (
    <Drawer open={Boolean(doc)} onClose={onClose} title={t('requests.detail.versions')} description={doc?.name}>
      <div className="p-5">
        {loading ? <Skeleton className="h-40" /> : !data?.length ? <EmptyState compact icon={<History />} title={t('requests.detail.noVersions')} /> : (
          <ol className="space-y-3">
            {data.map((v) => (
              <li key={v.id} className={cn('rounded-lg border p-3', v.isCurrent ? 'border-brand-300 bg-brand-soft' : 'border-line')}>
                <div className="flex items-start gap-3">
                  <FileIcon mime={v.mimeType} name={v.fileName} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{v.fileName}</p>
                    <p className="text-xs text-fg-3">{fmt.dateTime(v.createdAt)} · {fmt.bytes(v.size)} · {t(`requests.detail.via.${v.via}`)}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      {v.isCurrent && <Badge tone="brand">{t('requests.detail.current')}</Badge>}
                      <Badge tone={v.reviewStatus === 'approved' ? 'success' : v.reviewStatus === 'rejected' ? 'danger' : 'neutral'}>{t(`requests.detail.review.${v.reviewStatus}`)}</Badge>
                    </div>
                    {v.reviewReason && <p className="mt-1.5 text-xs text-fg-3">“{v.reviewReason}”{v.reviewer ? ` — ${v.reviewer}` : ''}</p>}
                    <p className="mt-1.5 truncate font-mono text-2xs text-fg-4" title={v.sha256}>SHA-256 {v.sha256?.slice(0, 16)}…</p>
                  </div>
                  <IconButton size="sm" label={t('common.view')} icon={<Eye className="size-4" />} onClick={() => setPreview({ id: v.id, name: v.fileName, mime: v.mimeType })} />
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
      {preview && doc && (
        <FilePreview
          open
          onClose={() => setPreview(null)}
          title={doc.name}
          fileName={preview.name}
          mimeType={preview.mime}
          getUrl={() => requestsApi.fileUrl(request.id, doc.id, { version: preview.id })}
          getDownloadUrl={() => requestsApi.fileUrl(request.id, doc.id, { version: preview.id, disposition: 'attachment' })}
        />
      )}
    </Drawer>
  )
}

function SupportDrawer({ request, open, onClose }: { request: DocRequest; open: boolean; onClose: () => void }) {
  const { t, fmt } = useI18n()
  const { toastError } = useApp()
  const { can } = useAuth()
  const { data, refetch } = useApi(open ? `support:${request.id}` : null, () => supportApi.list({ caseId: request.id }), { topics: ['support'] })
  const conv = data?.[0]
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [conv?.messages.length, open])
  useEffect(() => {
    if (open && conv && conv.messages.some((m) => m.senderType === 'client' && !m.isRead)) supportApi.markRead(conv.id).catch(() => {})
  }, [open, conv])
  const send = async () => {
    if (!text.trim()) return
    setBusy(true)
    try {
      let id = conv?.id
      if (!id) id = (await supportApi.start(request.id)).id
      await supportApi.reply(id, text.trim())
      setText('')
      refetch()
    } catch (err) {
      toastError(err, t('requests.support.sendFailed'))
    } finally {
      setBusy(false)
    }
  }
  const closeConv = async () => {
    if (!conv) return
    await supportApi.setStatus(conv.id, 'resolved', true).catch((err) => toastError(err, t('common.error')))
    refetch()
  }
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={t('requests.support.title')}
      description={request.clientName}
      width="lg"
      footer={can('member') ? (
        <form className="flex w-full items-end gap-2" onSubmit={(e) => { e.preventDefault(); send() }}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            rows={2}
            placeholder={t('requests.support.placeholder')}
            aria-label={t('requests.support.placeholder')}
            className="min-h-[44px] flex-1 resize-none rounded-md border border-line-2 bg-surface px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          />
          <Button type="submit" variant="primary" loading={busy} disabled={!text.trim()} icon={<Send className="size-4 rtl-flip" />}>{t('requests.support.send')}</Button>
        </form>
      ) : undefined}
    >
      <div className="flex min-h-full flex-col gap-3 bg-surface-2 p-5">
        {conv && conv.status !== 'resolved' && conv.status !== 'closed' && (
          <div className="flex items-center justify-between rounded-lg border border-line bg-surface px-3 py-2 text-sm">
            <span className="text-fg-3">{t(`requests.support.status.${conv.status}`)}</span>
            {can('member') && <Button size="xs" onClick={closeConv}>{t('requests.support.resolve')}</Button>}
          </div>
        )}
        {!conv || conv.messages.length === 0 ? (
          <EmptyState compact icon={<MessageSquare />} title={t('requests.support.empty')} description={t('requests.support.emptyHint')} />
        ) : conv.messages.map((m) => (
          <div key={m.id} className={cn('flex', m.senderType === 'staff' ? 'justify-end' : 'justify-start')}>
            <div className={cn('max-w-[80%] rounded-2xl px-3.5 py-2 text-sm shadow-xs', m.senderType === 'staff' ? 'rounded-ee-md bg-brand-600 text-brand-fg' : 'rounded-es-md border border-line bg-surface')}>
              <p className="whitespace-pre-wrap break-words">{m.content}</p>
              <p className={cn('mt-1 text-2xs', m.senderType === 'staff' ? 'text-brand-fg/70' : 'text-fg-4')}>{m.senderName} · {fmt.relative(m.timestamp)}</p>
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
    </Drawer>
  )
}

function EditDialog({ request, open, onClose, onSaved }: { request: DocRequest; open: boolean; onClose: () => void; onSaved: (r: DocRequest) => void }) {
  const { t } = useI18n()
  const { toastError } = useApp()
  const [f, setF] = useState({ title: '', instructions: '', deadline: '', language: '' as Language | '', notes: '' })
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) setF({ title: request.title, instructions: request.instructions, deadline: isoToDateInput(request.deadline), language: request.language || '', notes: request.notes || '' })
  }, [open, request])
  const save = async () => {
    setBusy(true)
    try {
      onSaved(await requestsApi.update(request.id, { title: f.title.trim(), instructions: f.instructions, deadline: f.deadline || null, language: f.language || null, notes: f.notes || null }))
      onClose()
    } catch (err) {
      toastError(err, t('requests.detail.saveFailed'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onClose={onClose} title={t('requests.detail.editTitle')} size="lg" footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={busy} onClick={save} disabled={!f.title.trim()}>{t('common.save')}</Button></>}>
      <div className="space-y-4">
        <Input label={t('requests.create.titleLabel')} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required />
        <Textarea label={t('requests.create.instructions')} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} rows={4} hint={t('requests.create.instructionsHint')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label={t('requests.create.deadline')} type="date" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} />
          <Select label={t('requests.create.language')} value={f.language} onChange={(e) => setF({ ...f, language: e.target.value as Language | '' })} options={[{ value: '', label: t('requests.create.languageDefault') }, { value: 'he', label: 'עברית' }, { value: 'en', label: 'English' }]} />
        </div>
        <Textarea label={t('requests.create.internalNotes')} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={2} hint={t('requests.create.internalNotesHint')} />
      </div>
    </Dialog>
  )
}

function AddDocumentDialog({ request, open, onClose, onDone }: { request: DocRequest; open: boolean; onClose: () => void; onDone: (r: DocRequest) => void }) {
  const { t } = useI18n()
  const { toastError } = useApp()
  const types = useApi(open ? 'document-types' : null, libraryApi.documentTypes, { topics: ['document-types'] })
  const [typeId, setTypeId] = useState('')
  const [required, setRequired] = useState(true)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const existing = new Set(request.requiredDocuments.map((d) => d.documentTypeId))
  const options = (types.data || []).filter((d) => d.status === 'active' && !existing.has(d.id))
  useEffect(() => { if (open) { setTypeId(''); setNote(''); setRequired(true) } }, [open])
  const add = async () => {
    setBusy(true)
    try {
      onDone(await requestsApi.addDocument(request.id, { documentTypeId: typeId, required, note }))
      onClose()
    } catch (err) {
      toastError(err, t('common.error'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onClose={onClose} title={t('requests.detail.addDocument')} footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={add} loading={busy} disabled={!typeId}>{t('common.add')}</Button></>}>
      <div className="space-y-4">
        <Select label={t('requests.detail.documentType')} value={typeId} onChange={(e) => setTypeId(e.target.value)} options={[{ value: '', label: options.length ? t('requests.detail.chooseType') : t('requests.create.noTypes') }, ...options.map((d) => ({ value: d.id, label: d.name }))]} />
        <Input label={t('requests.create.itemNote')} value={note} onChange={(e) => setNote(e.target.value)} optionalLabel={t('common.optional')} maxLength={500} />
        <Checkbox label={t('common.required')} checked={required} onChange={(e) => setRequired(e.target.checked)} />
        <p className="text-xs text-fg-3">{t('requests.detail.manageTypes')} <Link to="/templates?tab=types" className="font-medium text-brand-600 hover:underline">{t('nav.templates')}</Link></p>
      </div>
    </Dialog>
  )
}

function DocumentRow({ doc, request, onChanged, onPreview, onReject, onVersions }: {
  doc: RequestDocument; request: DocRequest; onChanged: (r: DocRequest) => void
  onPreview: () => void; onReject: () => void; onVersions: () => void
}) {
  const { t, fmt } = useI18n()
  const { can } = useAuth()
  const { toast, toastError } = useApp()
  const [busy, setBusy] = useState<string | null>(null)
  const [uploading, setUploading] = useState<number | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const canWrite = can('member') && request.status !== 'closed'

  const review = async (action: 'approve' | 'reopen') => {
    setBusy(action)
    try {
      const res = await requestsApi.review(request.id, doc.id, { action })
      onChanged(res.request)
      if (action === 'approve') {
        toast({
          tone: 'success', title: t('requests.detail.approved', { doc: doc.name }),
          action: { label: t('common.undo'), onClick: () => requestsApi.review(request.id, doc.id, { action: 'reopen' }).then((r) => onChanged(r.request)).catch(() => {}) },
        })
      }
    } catch (err) {
      toastError(err, t('requests.detail.reviewFailed'))
    } finally {
      setBusy(null)
    }
  }

  const upload = async (file: File) => {
    const pre = precheckFile(file, doc.allowedFormats, doc.maxSizeMB)
    if (pre) {
      toast({ tone: 'error', title: pre === 'too_large' ? t('upload.tooLarge', { size: doc.maxSizeMB }) : pre === 'wrong_type' ? t('upload.wrongType', { formats: doc.allowedFormats.join(', ') }) : t('upload.empty') })
      return
    }
    setUploading(0)
    try {
      const r = await requestsApi.uploadDocument(request.id, doc.id, file, (f) => setUploading(Math.round(f * 100))).promise
      onChanged(r)
      toast({ tone: 'success', title: t('requests.detail.uploaded', { doc: doc.name }) })
    } catch (err) {
      toastError(err, t('upload.failed'))
    } finally {
      setUploading(null)
    }
  }

  const toggleRequired = async () => {
    try { onChanged(await requestsApi.updateDocument(request.id, doc.id, { required: !doc.isRequired })) } catch (err) { toastError(err, t('common.error')) }
  }

  return (
    <li className="group flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {doc.hasFile ? (
          <button type="button" onClick={onPreview} className="shrink-0 rounded-lg focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]" aria-label={`${t('common.view')} ${doc.name}`}>
            <FileIcon mime={doc.fileType} name={doc.fileName} />
          </button>
        ) : (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-dashed border-line-2 text-fg-4"><Upload className="size-4" /></span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-fg">{doc.name}</p>
            {!doc.isRequired && <Badge>{t('common.optional')}</Badge>}
            <DocStatusBadge status={doc.status} />
          </div>
          {doc.hasFile ? (
            <p className="mt-0.5 truncate text-xs text-fg-3">
              <button type="button" onClick={onPreview} className="hover:text-fg-2 hover:underline">{doc.fileName}</button>
              {doc.fileSize ? ` · ${fmt.bytes(doc.fileSize)}` : ''}{doc.uploadedAt ? ` · ${fmt.relative(doc.uploadedAt)}` : ''}
              {doc.versionCount > 1 && <> · <button type="button" onClick={onVersions} className="hover:text-fg-2 hover:underline">{t('requests.detail.versionCount', { count: doc.versionCount })}</button></>}
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-fg-4">{doc.clientNote || t('requests.detail.notReceived')}</p>
          )}
          {doc.status === 'rejected' && doc.rejectionReason && (
            <p className="mt-1.5 flex items-start gap-1.5 rounded-md bg-danger-soft px-2 py-1 text-xs text-danger-fg"><AlertCircle className="mt-px size-3.5 shrink-0" />{doc.rejectionReason}</p>
          )}
          {uploading !== null && (
            <div className="mt-2 flex items-center gap-2 text-xs text-fg-3"><Spinner className="size-3" /> {t('upload.uploading')} {uploading}%</div>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 ps-12 sm:ps-0">
        {canWrite && doc.status === 'uploaded' && (
          <>
            <Button size="sm" variant="secondary" icon={<XCircle className="size-4 text-danger" />} onClick={onReject}>{t('requests.detail.reject')}</Button>
            <Button size="sm" variant="primary" icon={<CheckCircle2 className="size-4" />} loading={busy === 'approve'} onClick={() => review('approve')}>{t('requests.detail.approve')}</Button>
          </>
        )}
        {doc.hasFile && doc.status !== 'uploaded' && <Button size="sm" variant="ghost" icon={<Eye className="size-4" />} onClick={onPreview}>{t('common.view')}</Button>}
        <input ref={fileInput} type="file" className="sr-only" accept={acceptFor(doc.allowedFormats)} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f) }} tabIndex={-1} aria-hidden />
        <Menu
          label={`${t('common.more')} — ${doc.name}`}
          items={[
            ...(doc.hasFile ? [{ label: t('common.view'), icon: <Eye />, onSelect: onPreview }, { label: t('common.download'), icon: <Download />, onSelect: () => requestsApi.fileUrl(request.id, doc.id, { disposition: 'attachment' }).then((r) => { window.location.href = r.url }).catch((e) => toastError(e, t('common.error'))) }] : []),
            ...(doc.versionCount > 0 ? [{ label: t('requests.detail.versions'), icon: <History />, onSelect: onVersions }] : []),
            ...(canWrite ? [
              'separator' as const,
              ...(doc.status === 'approved' ? [{ label: t('requests.detail.reopenReview'), icon: <RotateCcw />, onSelect: () => review('reopen') }, { label: t('requests.detail.requestReplacement'), icon: <XCircle />, onSelect: onReject }] : []),
              ...(doc.status === 'rejected' ? [{ label: t('requests.detail.approveAnyway'), icon: <CheckCircle2 />, onSelect: () => review('approve') }] : []),
              { label: t('requests.detail.uploadForClient'), icon: <Upload />, onSelect: () => fileInput.current?.click() },
              { label: doc.isRequired ? t('requests.detail.makeOptional') : t('requests.detail.makeRequired'), icon: <Pencil />, onSelect: toggleRequired },
              'separator' as const,
              { label: t('requests.detail.removeDocument'), icon: <Trash2 />, tone: 'danger' as const, onSelect: () => setConfirmRemove(true) },
            ] : []),
          ]}
        />
      </div>
      <ConfirmDialog
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        onConfirm={async () => {
          try { onChanged(await requestsApi.removeDocument(request.id, doc.id)) } catch (err) { toastError(err, t('common.error')); throw err }
        }}
        title={t('requests.detail.removeTitle', { doc: doc.name })}
        description={doc.hasFile ? t('requests.detail.removeWithFiles') : t('requests.detail.removeHint')}
        confirmLabel={t('common.remove')}
      />
    </li>
  )
}

function NoteComposer({ requestId, onAdded }: { requestId: string; onAdded: () => void }) {
  const { t } = useI18n()
  const { toastError } = useApp()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const add = async () => {
    if (!text.trim()) return
    setBusy(true)
    try {
      await requestsApi.addNote(requestId, text.trim())
      setText('')
      onAdded()
    } catch (err) {
      toastError(err, t('common.error'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); add() }} className="mb-5">
      <label htmlFor="note" className="sr-only">{t('requests.detail.addNote')}</label>
      <textarea id="note" value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder={t('requests.detail.notePlaceholder')} className="w-full resize-y rounded-md border border-line-2 bg-surface px-3 py-2 text-sm placeholder:text-fg-4 focus:border-brand-500 focus:outline-none" maxLength={4000} />
      <div className="mt-2 flex items-center justify-between">
        <p className="text-xs text-fg-4">{t('requests.detail.noteVisibility')}</p>
        <Button size="sm" type="submit" loading={busy} disabled={!text.trim()} icon={<StickyNote className="size-3.5" />}>{t('requests.detail.addNote')}</Button>
      </div>
    </form>
  )
}

export default function RequestDetailPage() {
  const { id = '' } = useParams()
  const { t, fmt } = useI18n()
  const { can } = useAuth()
  const { toast, toastError } = useApp()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { data: r, error, loading, mutate, refetch } = useApi(`request:${id}`, () => requestsApi.get(id), { topics: ['requests'] })
  const activity = useApi(`activity:case:${id}`, () => insightsApi.activity({ caseId: id, limit: 100 }), { topics: ['activity'] })
  const comms = useApi(`comms:${id}`, () => requestsApi.communications(id), { topics: ['requests'] })
  const channels = useApi('integrations', workspaceApi.integrations)
  const support = useApi(`support:${id}`, () => supportApi.list({ caseId: id }), { topics: ['support'] })

  const [preview, setPreview] = useState<RequestDocument | null>(null)
  const [rejecting, setRejecting] = useState<RequestDocument | null>(null)
  const [versions, setVersions] = useState<RequestDocument | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [confirm, setConfirm] = useState<null | 'delete' | 'regenerate' | 'close'>(null)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [sending, setSending] = useState(false)
  const supportOpen = params.get('panel') === 'support'
  const setSupportOpen = (v: boolean) => { const n = new URLSearchParams(params); if (v) n.set('panel', 'support'); else n.delete('panel'); setParams(n, { replace: true }) }

  const changed = (next: DocRequest) => {
    mutate(next)
    invalidate('requests:list')
    invalidate('dashboard')
    activity.refetch()
  }

  if (error) {
    return error instanceof ApiError && error.status === 404
      ? <EmptyState icon={<AlertCircle />} title={t('requests.detail.notFound')} action={<Button to="/requests">{t('common.back')}</Button>} />
      : <Card><ErrorState onRetry={refetch} /></Card>
  }
  if (loading || !r) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-72" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]"><Skeleton className="h-96 rounded-xl" /><Skeleton className="h-96 rounded-xl" /></div>
      </div>
    )
  }

  const canWrite = can('member')
  const link = portalUrl(r.publicToken)
  const phoneOk = Boolean(r.clientPhone && r.clientPhone.replace(/\D/g, '').length >= 9)
  const emailOk = Boolean(channels.data?.email.configured && r.clientEmail)
  const defaultChannel: Channel = phoneOk ? 'whatsapp' : 'email'
  const firstSend = !r.sentAt
  const openSupport = support.data?.find((s) => s.status !== 'resolved' && s.status !== 'closed')
  const unreadSupport = openSupport?.messages.filter((m) => m.senderType === 'client' && !m.isRead).length || 0

  const send = async (channel: Channel) => {
    setSending(true)
    try {
      const res = await requestsApi.send(r.id, channel, firstSend ? 'initial' : 'reminder')
      toast(res.simulated ? { tone: 'info', title: t('requests.detail.simulated') } : { tone: 'success', title: firstSend ? t('requests.detail.sent') : t('requests.detail.reminderSent') })
      refetch()
      comms.refetch()
    } catch (err) {
      toastError(err, t('requests.detail.sendFailed'))
    } finally {
      setSending(false)
    }
  }

  const copyLink = async () => {
    if (await copyText(link)) {
      toast({ tone: 'success', title: t('common.linkCopied') })
      if (firstSend && canWrite) requestsApi.markSent(r.id).then(changed).catch(() => {})
    }
  }

  const docs = r.requiredDocuments
  const toReview = docs.filter((d) => d.status === 'uploaded')

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t('nav.requests'), to: '/requests' }, { label: r.title }]}
        title={r.title}
        meta={
          <>
            <RequestStatusBadge status={r.status} overdue={r.overdue} size="md" />
            <Link to={`/clients/${r.clientId}`} className="inline-flex items-center gap-1.5 hover:text-fg-2"><User className="size-3.5" />{r.clientName}</Link>
            {r.deadline && <span className={cn('inline-flex items-center gap-1.5', r.overdue && 'text-danger-fg')}><CalendarClock className="size-3.5" />{t('requests.detail.due', { date: fmt.date(r.deadline) })}</span>}
            <span>{r.sentAt ? t('requests.detail.sentOn', { date: fmt.date(r.sentAt) }) : t('requests.detail.notSent')}</span>
          </>
        }
        actions={
          <>
            <Button variant="secondary" icon={<MessageSquare className="size-4" />} onClick={() => setSupportOpen(true)}>
              {t('requests.support.title')}
              {unreadSupport > 0 && <span className="ms-1 rounded-full bg-danger px-1.5 text-2xs font-bold text-white tabular">{unreadSupport}</span>}
            </Button>
            {canWrite && r.status !== 'closed' && r.status !== 'completed' && (
              <div className="flex">
                <Button
                  variant="primary"
                  loading={sending}
                  disabled={!phoneOk && !emailOk}
                  className="rounded-e-none"
                  icon={firstSend ? <Send className="size-4 rtl-flip" /> : <Bell className="size-4" />}
                  onClick={() => send(defaultChannel)}
                >
                  {firstSend ? t('requests.detail.send') : t('requests.detail.remind')}
                </Button>
                <Menu
                  label={t('requests.detail.sendOptions')}
                  items={[
                    { label: t('requests.detail.viaWhatsapp'), icon: <MessageCircle />, onSelect: () => send('whatsapp'), disabled: !phoneOk },
                    { label: t('requests.detail.viaEmail'), icon: <Mail />, onSelect: () => send('email'), disabled: !emailOk, hint: channels.data?.email.configured ? undefined : t('requests.detail.notConfigured') },
                    { label: t('requests.detail.copyLinkInstead'), icon: <Link2 />, onSelect: copyLink },
                  ]}
                  trigger={(p) => (
                    <Button ref={p.ref as (el: HTMLButtonElement | null) => void} onClick={p.onClick} aria-haspopup="menu" aria-expanded={p['aria-expanded']} aria-controls={p['aria-controls']} aria-label={t('requests.detail.sendOptions')} variant="primary" className="rounded-s-none border-s border-brand-fg/20 px-2">
                      <ChevronDown className="size-4" />
                    </Button>
                  )}
                />
              </div>
            )}
            <Menu
              label={t('common.more')}
              trigger={(p) => <IconButton ref={p.ref as (el: HTMLButtonElement | null) => void} onClick={p.onClick} aria-haspopup="menu" aria-expanded={p['aria-expanded']} aria-controls={p['aria-controls']} label={t('common.more')} icon={<MoreHorizontal className="size-4" />} variant="secondary" tooltip={false} />}
              items={[
                ...(canWrite ? [{ label: t('requests.detail.edit'), icon: <Pencil />, onSelect: () => setEditOpen(true) }] : []),
                { label: t('requests.detail.downloadAll'), icon: <Download />, onSelect: () => { window.location.href = requestsApi.downloadAllUrl(r.id) }, disabled: !docs.some((d) => d.hasFile) },
                ...(canWrite ? [
                  { label: t('requests.detail.duplicate'), icon: <Files />, onSelect: () => requestsApi.duplicate(r.id).then((d) => { invalidate('requests:'); navigate(`/requests/${d.id}`); toast({ tone: 'success', title: t('requests.detail.duplicated') }) }).catch((e) => toastError(e, t('common.error'))) },
                  { label: t('requests.detail.saveTemplate'), icon: <LayoutTemplate />, onSelect: () => { setTemplateName(r.title); setTemplateOpen(true) } },
                  'separator' as const,
                  r.status === 'closed'
                    ? { label: t('requests.detail.reopen'), icon: <RotateCcw />, onSelect: () => requestsApi.update(r.id, { action: 'reopen' }).then(changed).catch((e) => toastError(e, t('common.error'))) }
                    : { label: t('requests.detail.close'), icon: <Archive />, onSelect: () => setConfirm('close') },
                ] : []),
                ...(can('admin') ? ['separator' as const, { label: t('requests.detail.delete'), icon: <Trash2 />, tone: 'danger' as const, onSelect: () => setConfirm('delete') }] : []),
              ]}
            />
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          {r.status === 'new' && canWrite && (
            <div className="flex flex-col gap-3 rounded-xl border border-brand-200 bg-brand-soft p-4 sm:flex-row sm:items-center">
              <Send className="hidden size-5 shrink-0 text-brand-600 sm:block rtl-flip" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-fg">{t('requests.detail.readyTitle')}</p>
                <p className="text-sm text-fg-3">{phoneOk || emailOk ? t('requests.detail.readyHint') : t('requests.detail.readyNoContact')}</p>
              </div>
              <Button variant="secondary" icon={<Copy className="size-4" />} onClick={copyLink}>{t('common.copyLink')}</Button>
            </div>
          )}

          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-4 border-b border-line px-5 py-4">
              <ProgressRing value={r.progress.percent} size={48} stroke={5} />
              <div className="min-w-0 flex-1">
                <h2 className="text-md font-semibold">{t('requests.detail.documents')}</h2>
                <p className="text-sm text-fg-3">
                  {t('requests.receivedOf', { done: r.progress.received, total: r.progress.required || r.progress.total })}
                  {toReview.length > 0 && <> · <span className="font-medium text-brand-600">{t('requests.toReview', { count: toReview.length })}</span></>}
                  {r.progress.rejected > 0 && <> · <span className="text-danger-fg">{t('requests.detail.awaitingReplacement', { count: r.progress.rejected })}</span></>}
                </p>
              </div>
              {canWrite && r.status !== 'closed' && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setAddOpen(true)}>{t('requests.detail.addDocument')}</Button>}
            </div>
            {docs.length === 0 ? <EmptyState compact title={t('requests.detail.noDocs')} /> : (
              <ul className="divide-y divide-line">
                {[...docs].sort((a, b) => (a.status === 'uploaded' ? -1 : 0) - (b.status === 'uploaded' ? -1 : 0) || a.sortOrder - b.sortOrder).map((d) => (
                  <DocumentRow key={d.id} doc={d} request={r} onChanged={changed} onPreview={() => setPreview(d)} onReject={() => setRejecting(d)} onVersions={() => setVersions(d)} />
                ))}
              </ul>
            )}
          </Card>

          {r.instructions && (
            <Card>
              <CardHeader title={t('requests.detail.instructions')} description={t('requests.detail.instructionsHint')} />
              <CardBody><p className="whitespace-pre-wrap text-sm text-fg-2">{r.instructions}</p></CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title={t('requests.detail.timeline')} />
            <CardBody>
              {canWrite && <NoteComposer requestId={r.id} onAdded={() => activity.refetch()} />}
              {activity.loading ? <Skeleton className="h-40" /> : <ActivityFeed items={activity.data || []} showClient={false} />}
            </CardBody>
          </Card>
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader title={t('requests.detail.client')} />
            <CardBody>
              <Link to={`/clients/${r.clientId}`} className="flex items-center gap-3 rounded-lg hover:opacity-80">
                <Avatar name={r.clientName} size="lg" />
                <div className="min-w-0">
                  <p className="truncate font-medium">{r.clientName}</p>
                  <p className="text-xs text-fg-3">{t('requests.detail.viewProfile')}</p>
                </div>
              </Link>
              <dl className="mt-3 divide-y divide-line border-t border-line">
                <DetailRow label={<span className="inline-flex items-center gap-1.5"><Phone className="size-3.5" />{t('clients.phone')}</span>}>
                  {r.clientPhone ? <a href={`tel:${r.clientPhone}`} dir="ltr" className="hover:underline">{r.clientPhone}</a> : <span className="text-fg-4">—</span>}
                </DetailRow>
                <DetailRow label={<span className="inline-flex items-center gap-1.5"><Mail className="size-3.5" />{t('clients.email')}</span>}>
                  {r.clientEmail ? <a href={`mailto:${r.clientEmail}`} dir="ltr" className="hover:underline">{r.clientEmail}</a> : <span className="text-fg-4">—</span>}
                </DetailRow>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title={t('requests.detail.clientLink')}
              description={r.portalEnabled ? t('requests.detail.clientLinkHint') : t('requests.detail.linkDisabled')}
              action={r.portalEnabled ? <Badge tone="success" dot>{t('requests.detail.active')}</Badge> : <Badge tone="danger" dot>{t('requests.detail.disabled')}</Badge>}
            />
            <CardBody className="space-y-3">
              <div className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-3 py-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-3" dir="ltr">{link}</span>
                <CopyButton value={link} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" icon={<ExternalLink className="size-3.5" />} onClick={() => window.open(link, '_blank', 'noopener')} disabled={!r.portalEnabled}>{t('requests.detail.openAsClient')}</Button>
                {canWrite && (
                  <Menu
                    label={t('requests.detail.linkOptions')}
                    items={[
                      r.portalEnabled
                        ? { label: t('requests.detail.disableLink'), icon: <ShieldOff />, onSelect: () => requestsApi.portalLink(r.id, 'disable').then(changed).catch((e) => toastError(e, t('common.error'))) }
                        : { label: t('requests.detail.enableLink'), icon: <ShieldCheck />, onSelect: () => requestsApi.portalLink(r.id, 'enable').then(changed).catch((e) => toastError(e, t('common.error'))) },
                      { label: t('requests.detail.regenerateLink'), icon: <RefreshCw />, onSelect: () => setConfirm('regenerate') },
                    ]}
                  />
                )}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t('requests.detail.settings')} />
            <CardBody className="space-y-4">
              <Switch
                checked={r.remindersEnabled}
                disabled={!canWrite}
                onChange={(v) => requestsApi.update(r.id, { remindersEnabled: v }).then(changed).catch((e) => toastError(e, t('common.error')))}
                label={t('requests.create.reminders')}
                description={r.lastReminderAt ? t('requests.detail.lastReminder', { date: fmt.relative(r.lastReminderAt), count: r.reminderCount }) : t('requests.detail.automationHint')}
              />
              <dl className="divide-y divide-line border-t border-line">
                <DetailRow label={t('requests.detail.created')}>{fmt.date(r.createdAt)}</DetailRow>
                <DetailRow label={t('requests.create.language')}>{r.language ? (r.language === 'he' ? 'עברית' : 'English') : t('requests.create.languageDefault')}</DetailRow>
                {r.completedAt && <DetailRow label={t('requests.detail.completed')}>{fmt.date(r.completedAt)}</DetailRow>}
              </dl>
              {r.notes && <div className="rounded-md bg-warning-soft px-3 py-2 text-sm text-fg-2"><p className="mb-0.5 text-xs font-medium text-warning-fg">{t('requests.create.internalNotes')}</p><p className="whitespace-pre-wrap">{r.notes}</p></div>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t('requests.detail.messages')} />
            <CardBody>
              {!comms.data ? <Skeleton className="h-20" /> : comms.data.deliveries.length === 0 ? (
                <p className="text-sm text-fg-3">{t('requests.detail.noMessages')}</p>
              ) : (
                <ul className="space-y-3">
                  {comms.data.deliveries.slice(0, 8).map((d) => (
                    <li key={d.id} className="flex items-start gap-2.5 text-sm">
                      {d.channel === 'whatsapp' ? <MessageCircle className="mt-0.5 size-4 shrink-0 text-fg-3" /> : <Mail className="mt-0.5 size-4 shrink-0 text-fg-3" />}
                      <div className="min-w-0 flex-1">
                        <p className="text-fg-2">{t(`requests.detail.kind.${d.kind}`)}{d.triggeredBy === 'automation' && <span className="text-fg-4"> · {t('requests.detail.automatic')}</span>}</p>
                        <p className="text-xs text-fg-4">{fmt.relative(d.createdAt)}</p>
                        {d.status === 'failed' && d.error && <p className="mt-0.5 text-xs text-danger-fg">{d.error}</p>}
                      </div>
                      <Badge tone={d.status === 'failed' ? 'danger' : d.status === 'read' || d.status === 'delivered' ? 'success' : d.status === 'skipped' ? 'warning' : 'neutral'}>{t(`status.delivery.${d.status}`)}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </aside>
      </div>

      <FilePreview
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={preview?.name || ''}
        fileName={preview?.fileName}
        mimeType={preview?.fileType}
        getUrl={() => requestsApi.fileUrl(r.id, preview!.id)}
        getDownloadUrl={() => requestsApi.fileUrl(r.id, preview!.id, { disposition: 'attachment' })}
        footer={preview && canWrite && preview.status === 'uploaded' ? (
          <div className="flex gap-2">
            <Button size="sm" icon={<XCircle className="size-4 text-danger" />} onClick={() => { setRejecting(preview); setPreview(null) }}>{t('requests.detail.reject')}</Button>
            <Button size="sm" variant="primary" icon={<CheckCircle2 className="size-4" />} onClick={async () => {
              try {
                const res = await requestsApi.review(r.id, preview.id, { action: 'approve' })
                changed(res.request)
                toast({ tone: 'success', title: t('requests.detail.approved', { doc: preview.name }) })
                const nextDoc = res.request.requiredDocuments.find((d) => d.status === 'uploaded')
                setPreview(nextDoc || null)
              } catch (err) { toastError(err, t('requests.detail.reviewFailed')) }
            }}>{t('requests.detail.approveNext')}</Button>
          </div>
        ) : undefined}
      />
      <RejectDialog open={Boolean(rejecting)} doc={rejecting} request={r} onClose={() => setRejecting(null)} onDone={changed} />
      <VersionsDrawer request={r} doc={versions} onClose={() => setVersions(null)} />
      <SupportDrawer request={r} open={supportOpen} onClose={() => setSupportOpen(false)} />
      <EditDialog request={r} open={editOpen} onClose={() => setEditOpen(false)} onSaved={changed} />
      <AddDocumentDialog request={r} open={addOpen} onClose={() => setAddOpen(false)} onDone={changed} />
      <Dialog
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        title={t('requests.detail.saveTemplate')}
        size="sm"
        footer={<><Button onClick={() => setTemplateOpen(false)}>{t('common.cancel')}</Button><Button variant="primary" disabled={!templateName.trim()} onClick={async () => {
          try { await requestsApi.saveAsTemplate(r.id, templateName.trim()); invalidate('templates'); toast({ tone: 'success', title: t('requests.detail.templateSaved') }); setTemplateOpen(false) } catch (e) { toastError(e, t('common.error')) }
        }}>{t('common.save')}</Button></>}
      >
        <Input label={t('templates.name')} value={templateName} onChange={(e) => setTemplateName(e.target.value)} autoFocus />
      </Dialog>
      <ConfirmDialog
        open={confirm === 'delete'}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          try { await requestsApi.remove(r.id); invalidate('requests:'); invalidate('dashboard'); toast({ tone: 'success', title: t('requests.detail.deleted') }); navigate('/requests') } catch (e) { toastError(e, t('common.error')); throw e }
        }}
        title={t('requests.detail.deleteTitle')}
        description={t('requests.detail.deleteHint', { count: docs.filter((d) => d.hasFile).length })}
        confirmLabel={t('common.delete')}
      />
      <ConfirmDialog
        open={confirm === 'regenerate'}
        tone="primary"
        onClose={() => setConfirm(null)}
        onConfirm={async () => { try { changed(await requestsApi.portalLink(r.id, 'regenerate')); toast({ tone: 'success', title: t('requests.detail.regenerated') }) } catch (e) { toastError(e, t('common.error')); throw e } }}
        title={t('requests.detail.regenerateTitle')}
        description={t('requests.detail.regenerateHint')}
        confirmLabel={t('requests.detail.regenerateLink')}
      />
      <ConfirmDialog
        open={confirm === 'close'}
        tone="primary"
        onClose={() => setConfirm(null)}
        onConfirm={async () => { try { changed(await requestsApi.update(r.id, { action: 'close' })) } catch (e) { toastError(e, t('common.error')); throw e } }}
        title={t('requests.detail.closeTitle')}
        description={t('requests.detail.closeHint')}
        confirmLabel={t('requests.detail.close')}
      />
    </>
  )
}
