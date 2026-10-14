import { useEffect, useMemo, useRef, useState } from 'react'
import { useBlocker, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertCircle, FileText, Link2, Mail, MessageCircle, Send, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/contexts/I18nContext'
import { useApp } from '@/contexts/AppContext'
import { useApi, invalidate } from '@/hooks/useApi'
import { clientsApi, signaturesApi, workspaceApi, type UploadedSignatureDoc } from '@/services'
import { Card } from '@/components/ui/Card'
import { Button, IconButton } from '@/components/ui/Button'
import { Input, Textarea, Select } from '@/components/ui/Field'
import { PageHeader, Stepper } from '@/components/ui/Misc'
import { ConfirmDialog } from '@/components/ui/Dialog'
import { Spinner, ProgressBar, Skeleton } from '@/components/ui/States'
import { UploadZone, FileIcon } from '@/components/ui/Upload'
import { FieldEditor, REF_WIDTH, type EditorField } from '@/components/domain/FieldEditor'
import { usePdf } from '@/components/domain/PdfPage'
import type { Language } from '@/types'

interface DocState { localId: string; name: string; progress: number; uploaded?: UploadedSignatureDoc; error?: string; abort?: () => void }

function EditorForDoc({ doc, docIndex, fields, onChange }: { doc: UploadedSignatureDoc; docIndex: number; fields: EditorField[]; onChange: (f: EditorField[]) => void }) {
  const { t } = useI18n()
  const { doc: pdf, error } = usePdf(doc.key, () => signaturesApi.uploadUrl(doc.key).then((r) => r.url))
  if (error) return <p className="p-6 text-sm text-danger-fg">{t('signatures.create.pdfLoadFailed')}</p>
  if (!pdf) return <Skeleton className="h-[60vh] rounded-xl" />
  return <FieldEditor doc={pdf} docIndex={docIndex} fields={fields} onChange={onChange} />
}

export default function SignatureCreatePage() {
  const { t } = useI18n()
  const { toast, toastError } = useApp()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const clients = useApi('clients:all', () => clientsApi.list(), { topics: ['clients'] })
  const channels = useApi('integrations', workspaceApi.integrations)
  const [step, setStep] = useState(0)
  const [form, setForm] = useState({ clientId: params.get('clientId') || '', title: '', description: '', expiresIn: '14', language: '' as Language | '' })
  const [docs, setDocs] = useState<DocState[]>([])
  const [activeDoc, setActiveDoc] = useState(0)
  const [fields, setFields] = useState<EditorField[]>([])
  const [channel, setChannel] = useState<'email' | 'whatsapp' | 'link'>('link')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const doneRef = useRef(false)
  const [error, setError] = useState('')

  const client = clients.data?.find((c) => c.id === form.clientId)
  const ready = docs.filter((d) => d.uploaded)
  const uploading = docs.some((d) => !d.uploaded && !d.error)
  const dirty = !done && (Boolean(form.title) || docs.length > 0 || fields.length > 0)
  const emailOk = Boolean(channels.data?.email.configured && client?.email)

  useEffect(() => { if (emailOk) setChannel('email') }, [emailOk])

  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !doneRef.current && currentLocation.pathname !== nextLocation.pathname)
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const addFiles = (files: File[]) => {
    for (const file of files) {
      const localId = crypto.randomUUID()
      if (file.size > 25 * 1024 * 1024) {
        setDocs((d) => [...d, { localId, name: file.name, progress: 0, error: t('upload.tooLarge', { size: 25 }) }])
        continue
      }
      const h = signaturesApi.upload(file, (f) => setDocs((d) => d.map((x) => (x.localId === localId ? { ...x, progress: f } : x))))
      setDocs((d) => [...d, { localId, name: file.name, progress: 0, abort: h.abort }])
      h.promise
        .then((u) => setDocs((d) => d.map((x) => (x.localId === localId ? { ...x, uploaded: u, progress: 1 } : x))))
        .catch((err) => setDocs((d) => d.map((x) => (x.localId === localId ? { ...x, error: err.message || t('upload.failed') } : x))))
    }
  }

  const removeDoc = (localId: string) => {
    const idx = ready.findIndex((d) => d.localId === localId)
    setDocs((d) => { d.find((x) => x.localId === localId)?.abort?.(); return d.filter((x) => x.localId !== localId) })
    if (idx >= 0) setFields((fs) => fs.filter((f) => f.docIndex !== idx).map((f) => (f.docIndex > idx ? { ...f, docIndex: f.docIndex - 1 } : f)))
    setActiveDoc(0)
  }

  const steps = useMemo(() => [
    { id: 'details', label: t('signatures.create.stepDetails') },
    { id: 'docs', label: t('signatures.create.stepDocuments') },
    { id: 'fields', label: t('signatures.create.stepFields') },
    { id: 'send', label: t('signatures.create.stepSend') },
  ], [t])

  const next = () => {
    setError('')
    if (step === 0 && (!form.clientId || !form.title.trim())) return setError(t('signatures.create.errDetails'))
    if (step === 1 && (ready.length === 0 || uploading)) return setError(uploading ? t('signatures.create.errUploading') : t('signatures.create.errDocs'))
    if (step === 2 && !fields.some((f) => f.type === 'signature' || f.type === 'initials')) return setError(t('signatures.create.errFields'))
    setStep((s) => s + 1)
  }

  const submit = async () => {
    setBusy(true)
    try {
      const expires = form.expiresIn ? new Date(Date.now() + Number(form.expiresIn) * 86400000).toISOString() : null
      const res = await signaturesApi.create({
        clientId: form.clientId, title: form.title.trim(), description: form.description || null,
        document: ready[0].uploaded!, extraDocuments: ready.slice(1).map((d) => d.uploaded!), canvasWidth: REF_WIDTH,
        fields: fields.map((f) => ({ type: f.type, label: f.label, page: f.page, x: f.x, y: f.y, width: f.width, height: f.height, required: f.required, docIndex: f.docIndex })),
        expiresAt: expires, language: form.language || null,
        send: channel === 'link' ? null : { channel },
      })
      doneRef.current = true
      setDone(true)
      invalidate('signatures')
      invalidate('dashboard')
      if (res.send && !res.send.ok) toast({ tone: 'warning', title: t('signatures.create.createdNotSent'), message: res.send.error })
      else toast({ tone: 'success', title: channel === 'link' ? t('signatures.create.createdLink') : t('signatures.create.createdSent') })
      navigate(`/app/signatures/${res.request.id}`, { replace: true })
    } catch (err) {
      toastError(err, t('signatures.create.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={cn('mx-auto', step === 2 ? 'max-w-[1400px]' : 'max-w-3xl')}>
      <PageHeader title={t('signatures.create.title')} breadcrumbs={[{ label: t('nav.signatures'), to: '/app/signatures' }, { label: t('signatures.create.title') }]} />
      <div className="mb-6"><Stepper steps={steps} current={step} onStepClick={setStep} /></div>

      {step === 2 ? (
        <div className="space-y-3">
          {ready.length > 1 && (
            <div role="tablist" className="flex gap-2 overflow-x-auto">
              {ready.map((d, i) => (
                <button key={d.localId} role="tab" aria-selected={activeDoc === i} type="button" onClick={() => setActiveDoc(i)} className={cn('flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm', activeDoc === i ? 'border-brand-500 bg-brand-soft' : 'border-line bg-surface')}>
                  <FileText className="size-4" /><bdi>{d.uploaded!.fileName}</bdi>
                  <span className="rounded-full bg-surface-3 px-1.5 text-2xs tabular">{fields.filter((f) => f.docIndex === i).length}</span>
                </button>
              ))}
            </div>
          )}
          {ready[activeDoc] && <EditorForDoc key={ready[activeDoc].localId} doc={ready[activeDoc].uploaded!} docIndex={activeDoc} fields={fields} onChange={setFields} />}
        </div>
      ) : (
        <Card className="p-5 sm:p-6">
          {step === 0 && (
            <div className="space-y-4">
              <Select label={t('signatures.create.client')} value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} required
                options={[{ value: '', label: clients.data ? t('signatures.create.chooseClient') : t('common.loading') }, ...(clients.data || []).filter((c) => c.status !== 'archived').map((c) => ({ value: c.id, label: c.name }))]}
                hint={<>{t('signatures.create.noClient')} <a href="/app/clients?new=1" className="font-medium text-brand-600 hover:underline">{t('clients.new')}</a></>} />
              <Input label={t('signatures.create.docTitle')} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required placeholder={t('signatures.create.docTitlePlaceholder')} />
              <Textarea label={t('signatures.create.message')} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} optionalLabel={t('common.optional')} hint={t('signatures.create.messageHint')} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Select label={t('signatures.create.expires')} value={form.expiresIn} onChange={(e) => setForm({ ...form, expiresIn: e.target.value })}
                  options={[{ value: '7', label: t('signatures.create.days', { count: 7 }) }, { value: '14', label: t('signatures.create.days', { count: 14 }) }, { value: '30', label: t('signatures.create.days', { count: 30 }) }, { value: '', label: t('signatures.create.noExpiry') }]} />
                <Select label={t('requests.create.language')} value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value as Language | '' })} options={[{ value: '', label: t('requests.create.languageDefault') }, { value: 'he', label: 'עברית' }, { value: 'en', label: 'English' }]} />
              </div>
            </div>
          )}
          {step === 1 && (
            <div className="space-y-4">
              <UploadZone onFiles={addFiles} multiple accept=".pdf,.jpg,.jpeg,.png" hint={t('signatures.create.docsHint')} />
              {docs.length > 0 && (
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {docs.map((d, i) => (
                    <li key={d.localId} className="flex items-center gap-3 px-4 py-3">
                      <FileIcon mime="application/pdf" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{d.uploaded?.fileName || d.name}{i === 0 && d.uploaded && <span className="ms-2 text-xs font-normal text-fg-4">{t('signatures.create.primary')}</span>}</p>
                        {d.error ? <p className="text-xs text-danger-fg">{d.error}</p>
                          : d.uploaded ? <p className="text-xs text-fg-3">{t('signatures.editor.pages', { count: d.uploaded.pages })}</p>
                            : <div className="mt-1.5 flex items-center gap-2"><ProgressBar value={d.progress * 100} className="max-w-[200px]" /><Spinner className="size-3" /></div>}
                      </div>
                      <IconButton size="sm" label={d.uploaded || d.error ? t('common.remove') : t('upload.cancel')} icon={d.uploaded ? <Trash2 className="size-4" /> : <X className="size-4" />} onClick={() => removeDoc(d.localId)} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {step === 3 && (
            <div className="space-y-5">
              <dl className="grid gap-4 sm:grid-cols-3">
                <div><dt className="text-xs text-fg-3">{t('signatures.create.client')}</dt><dd className="font-medium">{client?.name}</dd></div>
                <div><dt className="text-xs text-fg-3">{t('signatures.create.documents')}</dt><dd className="font-medium">{ready.length}</dd></div>
                <div><dt className="text-xs text-fg-3">{t('signatures.create.fields')}</dt><dd className="font-medium">{t('signatures.create.fieldSummary', { count: fields.length, required: fields.filter((f) => f.required).length })}</dd></div>
              </dl>
              <fieldset>
                <legend className="mb-2 text-sm font-semibold">{t('requests.create.howToSend')}</legend>
                <div className="grid gap-2 sm:grid-cols-3">
                  {([
                    { id: 'email', icon: Mail, ok: emailOk, hint: !channels.data?.email.configured ? t('requests.create.emailOff') : client?.email || t('requests.create.noEmail') },
                    { id: 'whatsapp', icon: MessageCircle, ok: false, hint: t('signatures.create.waTemplateHint') },
                    { id: 'link', icon: Link2, ok: true, hint: t('signatures.create.linkHint') },
                  ] as const).map((o) => (
                    <label key={o.id} className={cn('flex cursor-pointer flex-col gap-1 rounded-lg border p-3', channel === o.id ? 'border-brand-500 bg-brand-soft' : 'border-line', !o.ok && 'cursor-not-allowed opacity-50')}>
                      <input type="radio" className="sr-only" name="sch" checked={channel === o.id} disabled={!o.ok} onChange={() => setChannel(o.id)} />
                      <span className="flex items-center gap-2 text-sm font-medium"><o.icon className="size-4" />{t(`signatures.create.channel.${o.id}`)}</span>
                      <span className="text-xs text-fg-3">{o.hint}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <p className="rounded-lg bg-surface-2 p-3 text-xs text-fg-3">{t('signatures.create.legalNote')}</p>
            </div>
          )}
          {error && <p role="alert" className="mt-4 flex items-center gap-1.5 text-sm text-danger-fg"><AlertCircle className="size-4" />{error}</p>}
          <div className="mt-6 flex justify-between gap-3 border-t border-line pt-5">
            <Button variant="ghost" onClick={() => (step === 0 ? navigate('/app/signatures') : setStep(step - 1))}>{step === 0 ? t('common.cancel') : t('common.back')}</Button>
            {step < 3 ? <Button variant="primary" onClick={next}>{t('common.next')}</Button> : (
              <Button variant="primary" loading={busy} onClick={submit} icon={<Send className="size-4 rtl-flip" />}>{channel === 'link' ? t('signatures.create.create') : t('signatures.create.createAndSend')}</Button>
            )}
          </div>
        </Card>
      )}
      {step === 2 && (
        <div className="mt-4 flex items-center justify-between gap-3">
          <Button variant="ghost" onClick={() => setStep(1)}>{t('common.back')}</Button>
          {error && <p role="alert" className="flex items-center gap-1.5 text-sm text-danger-fg"><AlertCircle className="size-4" />{error}</p>}
          <Button variant="primary" onClick={next}>{t('common.next')}</Button>
        </div>
      )}
      <ConfirmDialog open={blocker.state === 'blocked'} onClose={() => blocker.reset?.()} onConfirm={() => blocker.proceed?.()} title={t('common.unsavedChanges')} confirmLabel={t('requests.create.discard')} />
    </div>
  )
}
