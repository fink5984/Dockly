import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, AlertCircle, Clock, Link2Off, UploadCloud, Camera, RotateCw, X, FileText, CalendarClock, ShieldCheck, Eye } from 'lucide-react'
import { cn } from '@/lib/utils'
import { I18nProvider, useI18n, detectLanguage } from '@/contexts/I18nContext'
import { portalApi, type PortalData, type PortalDocument } from '@/services/public'
import { ApiError } from '@/lib/api'
import { acceptFor, precheckFile } from '@/components/ui/Upload'
import { ProgressBar, ProgressRing, Skeleton } from '@/components/ui/States'
import { Badge } from '@/components/ui/Badge'
import { PublicShell, PublicMessage, publicLanguageChoice } from './PublicShell'

type UploadState = { progress: number; error?: string; abort?: () => void; retry?: () => void }

/** Combine several JPG/PNG photos (e.g. pages of one document) into one PDF, on the device. */
async function imagesToPdf(files: File[], name: string): Promise<File> {
  const { PDFDocument } = await import('pdf-lib')
  const pdf = await PDFDocument.create()
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer())
    const img = /png$/i.test(f.type) || /\.png$/i.test(f.name) ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes)
    const W = 595.28
    const H = 841.89
    const r = Math.min((W - 36) / img.width, (H - 36) / img.height)
    const page = pdf.addPage([W, H])
    page.drawImage(img, { x: (W - img.width * r) / 2, y: (H - img.height * r) / 2, width: img.width * r, height: img.height * r })
  }
  const out = await pdf.save()
  return new File([out as BlobPart], `${name.replace(/[\\/:*?"<>|]/g, '_')}.pdf`, { type: 'application/pdf' })
}

function DocumentCard({ doc, token, onUploaded, closed }: { doc: PortalDocument; token: string; onUploaded: (d: PortalDocument) => void; closed: boolean }) {
  const { t, fmt } = useI18n()
  const [state, setState] = useState<UploadState | null>(null)
  const [replacing, setReplacing] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const camInput = useRef<HTMLInputElement>(null)
  const canCombine = doc.allowedFormats.includes('pdf')
  const imagesAllowed = doc.allowedFormats.some((f) => ['jpg', 'jpeg', 'png', 'heic'].includes(f))

  const start = useCallback(async (files: File[]) => {
    let file = files[0]
    if (files.length > 1) {
      const allImages = files.every((f) => /^image\/(jpeg|png)$/.test(f.type))
      if (!allImages || !canCombine) { setState({ progress: 0, error: t('portal.oneFile') }); return }
      setState({ progress: 0 })
      try { file = await imagesToPdf(files, doc.name) } catch { setState({ progress: 0, error: t('portal.combineFailed') }); return }
    }
    const pre = precheckFile(file, doc.allowedFormats, doc.maxSizeMB)
    if (pre) {
      setState({ progress: 0, error: pre === 'too_large' ? t('upload.tooLarge', { size: doc.maxSizeMB }) : pre === 'wrong_type' ? t('upload.wrongType', { formats: doc.allowedFormats.join(', ').toUpperCase() }) : t('upload.empty') })
      return
    }
    const h = portalApi.upload(token, doc.id, file, (p) => setState((s) => ({ ...(s || {}), progress: p })))
    const retry = () => start(files)
    setState({ progress: 0, abort: h.abort })
    try {
      const res = await h.promise
      setState(null)
      setReplacing(false)
      onUploaded(res.document)
    } catch (err) {
      const e = err as ApiError
      if (e.code === 'aborted') { setState(null); return }
      const msg = e.code === 'network_error' || e.code === 'timeout' ? t('portal.networkError')
        : e.code === 'file_too_large' ? t('upload.tooLarge', { size: doc.maxSizeMB })
          : e.code === 'file_type_not_allowed' || e.code === 'unsupported_file_type' ? t('upload.wrongType', { formats: doc.allowedFormats.join(', ').toUpperCase() })
            : e.code === 'already_approved' ? t('portal.alreadyApproved')
              : e.code === 'link_disabled' || e.code === 'link_expired' ? t('portal.linkInactive')
                : e.code === 'rate_limited' ? t('portal.slowDown') : t('upload.failed')
      setState({ progress: 0, error: msg, retry })
    }
  }, [doc, token, onUploaded, t, canCombine])

  const received = doc.status === 'uploaded' || doc.status === 'approved'
  const showPicker = !closed && doc.canUpload && (!received || replacing)
  const busy = state && !state.error

  return (
    <li className={cn('rounded-2xl border bg-surface p-4 shadow-xs sm:p-5', doc.status === 'rejected' ? 'border-danger/40' : received ? 'border-success/30' : 'border-line')}>
      <div className="flex items-start gap-3">
        <span className={cn('mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full',
          doc.status === 'approved' ? 'bg-success text-white' : received ? 'bg-success-soft text-success' : doc.status === 'rejected' ? 'bg-danger-soft text-danger' : 'bg-surface-3 text-fg-3')}>
          {received ? <CheckCircle2 className="size-5" /> : doc.status === 'rejected' ? <AlertCircle className="size-5" /> : <FileText className="size-[18px]" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-md font-semibold text-fg">{doc.name}</h3>
            {!doc.required && <Badge>{t('common.optional')}</Badge>}
          </div>
          {(doc.clientNote || doc.helperText || doc.description) && (
            <p className="mt-1 text-sm text-fg-3">{[doc.clientNote, doc.helperText || doc.description].filter(Boolean).join(' · ')}</p>
          )}
          {doc.status === 'rejected' && (
            <div className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-fg">
              <p className="font-medium">{t('portal.needsReplacement')}</p>
              {doc.rejectionReason && <p className="mt-0.5">{doc.rejectionReason}</p>}
            </div>
          )}
          {received && !replacing && (
            <p className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-success-fg">
              <span className="font-medium">{doc.status === 'approved' ? t('portal.approved') : t('portal.received')}</span>
              {doc.fileName && <span className="text-fg-3">· {doc.fileName}{doc.uploadedAt ? ` · ${fmt.relative(doc.uploadedAt)}` : ''}</span>}
            </p>
          )}
          {received && !replacing && (
            <div className="mt-2 flex flex-wrap gap-3 text-sm">
              <button type="button" onClick={() => portalApi.fileUrl(token, doc.id).then((r) => window.open(r.url, '_blank', 'noopener')).catch(() => {})} className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline">
                <Eye className="size-4" />{t('portal.viewFile')}
              </button>
              {doc.canUpload && !closed && (
                <button type="button" onClick={() => setReplacing(true)} className="font-medium text-fg-3 hover:text-fg-2 hover:underline">{t('portal.replace')}</button>
              )}
            </div>
          )}

          {busy && (
            <div className="mt-3 flex items-center gap-3" aria-live="polite">
              <ProgressBar value={state!.progress * 100} label={t('upload.uploading')} className="flex-1" size="md" />
              <span className="w-10 text-end text-xs tabular text-fg-3">{Math.round(state!.progress * 100)}%</span>
              {state!.abort && <button type="button" onClick={() => state!.abort?.()} className="rounded p-1 text-fg-4 hover:bg-surface-3" aria-label={t('upload.cancel')}><X className="size-4" /></button>}
            </div>
          )}
          {state?.error && (
            <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-fg">
              <AlertCircle className="size-4 shrink-0" /><span className="flex-1">{state.error}</span>
              {state.retry && <button type="button" onClick={state.retry} className="inline-flex items-center gap-1 font-semibold hover:underline"><RotateCw className="size-3.5" />{t('upload.retry')}</button>}
            </div>
          )}

          {showPicker && !busy && (
            <div className="mt-3 flex flex-wrap gap-2">
              <input ref={fileInput} type="file" className="sr-only" accept={acceptFor(doc.allowedFormats)} multiple={canCombine && imagesAllowed} onChange={(e) => { const f = Array.from(e.target.files || []); e.target.value = ''; if (f.length) start(f) }} tabIndex={-1} aria-hidden />
              <input ref={camInput} type="file" className="sr-only" accept="image/*" capture="environment" onChange={(e) => { const f = Array.from(e.target.files || []); e.target.value = ''; if (f.length) start(f) }} tabIndex={-1} aria-hidden />
              <button type="button" onClick={() => fileInput.current?.click()} className="inline-flex h-11 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-brand-fg shadow-xs hover:bg-brand-700 focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]">
                <UploadCloud className="size-[18px]" />{doc.status === 'rejected' || replacing ? t('portal.uploadReplacement') : t('portal.upload')}
              </button>
              {imagesAllowed && (
                <button type="button" onClick={() => camInput.current?.click()} className="inline-flex h-11 items-center gap-2 rounded-lg border border-line-2 bg-surface px-4 text-sm font-medium text-fg-2 hover:bg-surface-2 sm:hidden">
                  <Camera className="size-[18px]" />{t('upload.takePhoto')}
                </button>
              )}
              {replacing && <button type="button" onClick={() => setReplacing(false)} className="h-11 px-2 text-sm text-fg-3 hover:text-fg-2">{t('common.cancel')}</button>}
              <p className="w-full text-xs text-fg-4">
                {t('upload.formats', { formats: doc.allowedFormats.join(', ').toUpperCase(), size: doc.maxSizeMB })}
                {canCombine && imagesAllowed ? ` · ${t('portal.multiPhotoHint')}` : ''}
              </p>
            </div>
          )}
        </div>
      </div>
    </li>
  )
}

function Portal({ token }: { token: string }) {
  const { t, fmt, setLanguage } = useI18n()
  const [data, setData] = useState<PortalData | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'invalid' | 'expired' | 'disabled' | 'error'>('loading')
  const langSet = useRef(false)

  const load = useCallback(() => {
    portalApi.get(token).then((d) => {
      setData(d)
      setState('ready')
      if (!langSet.current) {
        langSet.current = true
        if (!publicLanguageChoice()) setLanguage(d.request.language)
      }
    }).catch((err) => {
      const e = err as ApiError
      setState(e.code === 'link_expired' ? 'expired' : e.code === 'link_disabled' ? 'disabled' : e.status === 404 ? 'invalid' : 'error')
    })
  }, [token, setLanguage])

  useEffect(() => { load() }, [load])
  // Refresh when the client returns to the tab (e.g. after a review on the business side).
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [load])

  if (state === 'loading') return <PublicShell><div className="space-y-4"><Skeleton className="h-28 rounded-2xl" /><Skeleton className="h-24 rounded-2xl" /><Skeleton className="h-24 rounded-2xl" /></div></PublicShell>
  if (state !== 'ready' || !data) {
    const map = {
      invalid: { icon: <Link2Off />, title: t('portal.invalidTitle'), body: t('portal.invalidBody') },
      expired: { icon: <Clock />, title: t('portal.expiredTitle'), body: t('portal.expiredBody') },
      disabled: { icon: <Link2Off />, title: t('portal.disabledTitle'), body: t('portal.disabledBody') },
      error: { icon: <AlertCircle />, title: t('common.loadFailed'), body: t('common.loadFailedHint') },
    } as const
    const m = map[state as keyof typeof map]
    return (
      <PublicShell>
        <PublicMessage icon={m.icon} title={m.title} body={m.body}>
          {state === 'error' && <button type="button" onClick={() => { setState('loading'); load() }} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-brand-fg">{t('common.retry')}</button>}
        </PublicMessage>
      </PublicShell>
    )
  }

  const { workspace, request, documents } = data
  const onUploaded = (d: PortalDocument) => {
    setData((cur) => cur && { ...cur, documents: cur.documents.map((x) => (x.id === d.id ? d : x)) })
    load()
  }
  const required = documents.filter((d) => d.required)
  const outstanding = required.filter((d) => d.status === 'missing' || d.status === 'rejected')
  const received = documents.filter((d) => d.status === 'uploaded' || d.status === 'approved')
  const allDone = outstanding.length === 0 && required.length > 0
  const ordered = [...documents].sort((a, b) => {
    const rank = (d: PortalDocument) => (d.status === 'rejected' ? 0 : d.status === 'missing' ? (d.required ? 1 : 2) : 3)
    return rank(a) - rank(b)
  })
  const firstName = request.clientName.split(' ')[0]

  return (
    <PublicShell workspace={workspace}>
      <section className="mb-6 rounded-2xl border border-line bg-surface p-5 shadow-xs sm:p-6">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold leading-snug sm:text-2xl">{t('portal.greeting', { name: firstName })}</h1>
            <p className="mt-1.5 text-sm text-fg-3">{t('portal.intro', { business: workspace.name, title: request.title })}</p>
            {request.deadline && !allDone && (
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-3 py-1 text-xs font-medium text-warning-fg"><CalendarClock className="size-3.5" />{t('portal.deadline', { date: fmt.date(request.deadline) })}</p>
            )}
          </div>
          <ProgressRing value={data.progress.percent} size={64} stroke={6} className="shrink-0" />
        </div>
        {(workspace.portalMessage || request.instructions) && (
          <div className="mt-5 space-y-2 border-t border-line pt-4 text-sm text-fg-2">
            {request.instructions && <p className="whitespace-pre-wrap">{request.instructions}</p>}
            {workspace.portalMessage && <p className="whitespace-pre-wrap text-fg-3">{workspace.portalMessage}</p>}
          </div>
        )}
      </section>

      {request.closed && (
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-line bg-surface-2 p-4 text-sm text-fg-2"><AlertCircle className="mt-0.5 size-4 shrink-0" />{t('portal.closed')}</div>
      )}
      {allDone && (
        <div role="status" className="mb-6 flex items-start gap-3 rounded-2xl border border-success/30 bg-success-soft p-5">
          <ShieldCheck className="size-6 shrink-0 text-success" />
          <div>
            <p className="font-semibold text-fg">{t('portal.doneTitle')}</p>
            <p className="mt-0.5 text-sm text-fg-2">{t('portal.doneBody', { business: workspace.name })}</p>
          </div>
        </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-md font-semibold">{t('portal.yourDocuments')}</h2>
        <span className="text-sm text-fg-3 tabular">{t('portal.counter', { done: received.length, total: documents.length })}</span>
      </div>
      <ul className="space-y-3">
        {ordered.map((d) => <DocumentCard key={d.id} doc={d} token={token} onUploaded={onUploaded} closed={request.closed} />)}
      </ul>
    </PublicShell>
  )
}

export default function ClientPortalPage() {
  const { token = '' } = useParams()
  return (
    <I18nProvider initial={publicLanguageChoice() || detectLanguage()} persist={false}>
      <Portal token={token} />
    </I18nProvider>
  )
}
