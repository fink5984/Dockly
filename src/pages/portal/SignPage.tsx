import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { PenLine, CheckCircle2, Clock, Ban, Link2Off, AlertCircle, ChevronDown, Download, FileText, Calendar, Type, Hash, User, CheckSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import { I18nProvider, useI18n, detectLanguage } from '@/contexts/I18nContext'
import { signerApi, type SignerData } from '@/services/public'
import { ApiError } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Input, Checkbox, Textarea } from '@/components/ui/Field'
import { Skeleton, Spinner } from '@/components/ui/States'
import { PdfPage, usePdf } from '@/components/domain/PdfPage'
import { SignaturePad } from '@/components/domain/SignaturePad'
import { fieldTone } from '@/components/domain/FieldEditor'
import { PublicShell, PublicMessage, publicLanguageChoice } from './PublicShell'
import type { SignatureFieldType } from '@/types'

type Field = SignerData['fields'][number]
const ICONS: Record<SignatureFieldType, typeof PenLine> = { signature: PenLine, initials: Hash, name: User, date: Calendar, text: Type, checkbox: CheckSquare }

function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function DocumentPages({ token, docId, data, values, docIndex, onField, activeField }: {
  token: string; docId: string; data: SignerData; values: Record<string, string>; docIndex: number; onField: (f: Field) => void; activeField: string | null
}) {
  const { t } = useI18n()
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const { doc, error } = usePdf(`sign:${token}:${docId}`, () => signerApi.fileUrl(token, docId).then((r) => r.url))
  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    const measure = () => setWidth(Math.min(900, el.clientWidth))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const scale = width / (data.canvasWidth || 750)
  return (
    <div ref={wrap} className="w-full">
      {error ? <p className="p-6 text-center text-sm text-danger-fg">{t('sign.docFailed')}</p> : !doc || !width ? <Skeleton className="h-[70vh] rounded-xl" /> : (
        <div className="mx-auto flex flex-col items-center gap-4" style={{ width }}>
          {Array.from({ length: doc.numPages }, (_, i) => i + 1).map((p) => (
            <div key={p} className="relative shadow-md" dir="ltr">
              <PdfPage doc={doc} pageNumber={p} width={width} />
              {data.fields.filter((f) => f.docIndex === docIndex && f.page === p).map((f) => {
                const v = values[f.id]
                const Icon = ICONS[f.type]
                return (
                  <button
                    key={f.id}
                    id={`field-${f.id}`}
                    type="button"
                    onClick={() => onField(f)}
                    aria-label={`${f.label || t(`signatures.field.${f.type}`)}${f.required ? ` (${t('common.required')})` : ''}${v ? ` — ${t('sign.filled')}` : ''}`}
                    className={cn(
                      'absolute flex items-center justify-center overflow-hidden rounded-[4px] border-2 text-[11px] font-medium transition-shadow focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/40',
                      v ? 'border-success/60 bg-success/5' : cn('border-dashed', fieldTone[f.type], f.required && 'animate-pulse'),
                      activeField === f.id && 'ring-4 ring-brand-500/40',
                    )}
                    style={{ left: f.x * scale, top: f.y * scale, width: f.width * scale, height: f.height * scale }}
                  >
                    {v ? (
                      f.type === 'signature' || (f.type === 'initials' && v.startsWith('data:image')) ? <img src={v} alt="" className="h-full w-full object-contain p-0.5" />
                        : f.type === 'checkbox' ? <CheckCircle2 className="size-4 text-success" />
                          : <span className="truncate px-1 text-slate-900" dir="auto" style={{ fontSize: Math.max(9, Math.min(f.height * scale * 0.5, 15)) }}>{v}</span>
                    ) : (
                      <span className="flex items-center gap-1 truncate px-1">{f.type !== 'checkbox' && <Icon className="size-3.5 shrink-0" />}{f.type !== 'checkbox' && f.width * scale > 60 && <span className="truncate">{f.label || t(`signatures.field.${f.type}`)}</span>}</span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Signer({ token }: { token: string }) {
  const { t, fmt, language, setLanguage } = useI18n()
  const [data, setData] = useState<SignerData | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'invalid' | 'error' | 'done'>('loading')
  const [values, setValues] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<Field | null>(null)
  const [draft, setDraft] = useState<string>('')
  const [finishOpen, setFinishOpen] = useState(false)
  const [declineOpen, setDeclineOpen] = useState(false)
  const [signerName, setSignerName] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [declineReason, setDeclineReason] = useState('')
  const [activeDoc, setActiveDoc] = useState(0)
  const viewed = useRef(false)

  const load = useCallback(() => {
    signerApi.get(token).then((d) => {
      setData(d)
      setState((cur) => (cur === 'done' ? 'done' : 'ready'))
      setSignerName((n) => n || d.clientName)
      if (!publicLanguageChoice()) setLanguage(d.language)
      if (!viewed.current && (d.status === 'pending' || d.status === 'viewed')) {
        viewed.current = true
        signerApi.view(token).catch(() => {})
      }
    }).catch((err) => setState((err as ApiError).status === 404 ? 'invalid' : 'error'))
  }, [token, setLanguage])
  useEffect(() => { load() }, [load])

  const fields = useMemo(() => [...(data?.fields || [])].sort((a, b) => a.docIndex - b.docIndex || a.page - b.page || a.y - b.y || a.x - b.x), [data])
  const required = fields.filter((f) => f.required)
  const filledRequired = required.filter((f) => values[f.id]).length
  const complete = filledRequired === required.length

  const openField = (f: Field) => {
    if (f.type === 'checkbox') { setValues((v) => ({ ...v, [f.id]: v[f.id] ? '' : 'true' })); return }
    if (f.type === 'date' && !values[f.id]) { setValues((v) => ({ ...v, [f.id]: todayIso() })); return }
    setDraft(values[f.id] || (f.type === 'name' ? signerName : ''))
    setEditing(f)
  }
  const goNext = () => {
    const next = required.find((f) => !values[f.id]) || fields.find((f) => !values[f.id])
    if (!next) { setFinishOpen(true); return }
    if (next.docIndex !== activeDoc) setActiveDoc(next.docIndex)
    setTimeout(() => {
      const el = document.getElementById(`field-${next.id}`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el?.focus({ preventScroll: true })
    }, next.docIndex !== activeDoc ? 400 : 0)
  }
  const saveField = () => {
    if (!editing) return
    setValues((v) => ({ ...v, [editing.id]: draft }))
    // Re-use a drawn signature for other signature fields.
    if (editing.type === 'signature' && draft) {
      setValues((v) => {
        const nv = { ...v }
        fields.filter((f) => f.type === 'signature' && !nv[f.id]).forEach((f) => { nv[f.id] = draft })
        return nv
      })
    }
    setEditing(null)
  }

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      await signerApi.submit(token, { signerName: signerName.trim(), consent, language, values: Object.entries(values).filter(([, v]) => v).map(([fieldId, value]) => ({ fieldId, value })) })
      setFinishOpen(false)
      setState('done')
      load()
    } catch (err) {
      const e = err as ApiError
      setError(e.code === 'required_fields_missing' ? t('sign.missingFields') : e.code === 'already_signed' ? t('sign.alreadySigned') : e.code === 'expired' ? t('sign.expiredBody') : e.message || t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  const decline = async () => {
    setBusy(true)
    try { await signerApi.decline(token, declineReason); setDeclineOpen(false); load() } catch { setError(t('common.error')) } finally { setBusy(false) }
  }

  if (state === 'loading') return <PublicShell showContact={false}><Skeleton className="h-[60vh] rounded-2xl" /></PublicShell>
  if (state === 'invalid' || state === 'error' || !data) {
    return <PublicShell><PublicMessage icon={state === 'invalid' ? <Link2Off /> : <AlertCircle />} title={state === 'invalid' ? t('sign.invalidTitle') : t('common.loadFailed')} body={state === 'invalid' ? t('sign.invalidBody') : t('common.loadFailedHint')} /></PublicShell>
  }

  const downloadSigned = async () => {
    const { url } = await signerApi.fileUrl(token, 'main', 'signed', 'attachment')
    window.location.href = url
  }

  if (data.status === 'signed') {
    return (
      <PublicShell workspace={data.workspace}>
        <PublicMessage icon={<CheckCircle2 className="text-success" />} title={state === 'done' ? t('sign.thanksTitle') : t('sign.alreadySigned')} body={t('sign.signedBody', { date: fmt.dateTime(data.signedAt), business: data.workspace.name })}>
          <Button variant="primary" icon={<Download className="size-4" />} onClick={downloadSigned}>{t('sign.downloadCopy')}</Button>
        </PublicMessage>
      </PublicShell>
    )
  }
  const ended = { expired: [<Clock key="i" />, t('sign.expiredTitle'), t('sign.expiredBody')], cancelled: [<Ban key="i" />, t('sign.cancelledTitle'), t('sign.cancelledBody')], declined: [<Ban key="i" />, t('sign.declinedTitle'), t('sign.declinedBody')] } as const
  if (data.status in ended) {
    const [icon, title, body] = ended[data.status as keyof typeof ended]
    return <PublicShell workspace={data.workspace}><PublicMessage icon={icon} title={title} body={body} /></PublicShell>
  }

  return (
    <PublicShell workspace={data.workspace}>
      <section className="mb-5 rounded-2xl border border-line bg-surface p-5 shadow-xs">
        <p className="text-xs font-medium text-fg-3">{t('sign.from', { business: data.workspace.name })}</p>
        <h1 className="mt-1 text-xl font-semibold">{data.title}</h1>
        {data.description && <p className="mt-2 whitespace-pre-wrap text-sm text-fg-2">{data.description}</p>}
        <p className="mt-3 text-sm text-fg-3">{t('sign.instructions', { count: required.length })}</p>
        {data.expiresAt && <p className="mt-1 text-xs text-fg-4">{t('sign.expires', { date: fmt.date(data.expiresAt) })}</p>}
      </section>

      {data.documents.length > 1 && (
        <div role="tablist" className="mb-3 flex gap-2 overflow-x-auto">
          {data.documents.map((d, i) => (
            <button key={d.id} role="tab" type="button" aria-selected={activeDoc === i} onClick={() => setActiveDoc(i)} className={cn('flex shrink-0 items-center gap-2 rounded-md border px-3 py-1.5 text-sm', activeDoc === i ? 'border-brand-500 bg-brand-soft' : 'border-line bg-surface')}>
              <FileText className="size-4" /><bdi>{d.fileName}</bdi>
            </button>
          ))}
        </div>
      )}
      <div className="-mx-4 bg-surface-3 px-2 py-4 sm:mx-0 sm:rounded-2xl sm:px-4">
        <DocumentPages key={activeDoc} token={token} docId={data.documents[activeDoc]?.id || 'main'} docIndex={activeDoc} data={data} values={values} onField={openField} activeField={editing?.id || null} />
      </div>
      <div className="mt-4 text-center">
        <button type="button" onClick={() => setDeclineOpen(true)} className="text-sm text-fg-3 underline-offset-4 hover:text-fg-2 hover:underline">{t('sign.decline')}</button>
      </div>
      <div className="h-24" />

      {/* Sticky guide bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{t('sign.progress', { done: filledRequired, total: required.length })}</p>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-brand-600 transition-[width]" style={{ width: `${required.length ? (filledRequired / required.length) * 100 : 100}%` }} /></div>
          </div>
          {complete ? (
            <Button variant="primary" size="lg" icon={<CheckCircle2 className="size-4" />} onClick={() => setFinishOpen(true)}>{t('sign.finish')}</Button>
          ) : (
            <Button variant="primary" size="lg" iconEnd={<ChevronDown className="size-4" />} onClick={goNext}>{filledRequired === 0 ? t('sign.start') : t('sign.next')}</Button>
          )}
        </div>
      </div>

      <Dialog
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing ? (editing.label || t(`signatures.field.${editing.type}`)) : ''}
        size={editing?.type === 'signature' || editing?.type === 'initials' ? 'lg' : 'sm'}
        footer={<><Button onClick={() => setEditing(null)}>{t('common.cancel')}</Button><Button variant="primary" onClick={saveField} disabled={!draft.trim()}>{t('sign.apply')}</Button></>}
      >
        {editing && (editing.type === 'signature' || editing.type === 'initials') ? (
          <SignaturePad
            initialName={editing.type === 'initials' ? signerName.split(/\s+/).map((p) => p[0]).join('') : signerName}
            onChange={(png) => setDraft(png || '')}
            labels={{ draw: t('sign.draw'), type: t('sign.type'), clear: t('sign.clear'), placeholder: t('sign.drawHere'), typePlaceholder: t('sign.typeName'), hint: t('sign.drawHint') }}
          />
        ) : editing?.type === 'date' ? (
          <Input type="date" label={t('signatures.field.date')} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
        ) : editing ? (
          <form onSubmit={(e) => { e.preventDefault(); if (draft.trim()) saveField() }}>
            <Input label={editing.label || t(`signatures.field.${editing.type}`)} value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={editing.type === 'name' ? 120 : 500} autoFocus dir="auto" />
          </form>
        ) : null}
      </Dialog>

      <Dialog
        open={finishOpen}
        onClose={() => !busy && setFinishOpen(false)}
        title={t('sign.confirmTitle')}
        description={t('sign.confirmHint')}
        footer={<><Button onClick={() => setFinishOpen(false)} disabled={busy}>{t('common.back')}</Button><Button variant="primary" loading={busy} disabled={!consent || signerName.trim().length < 2} onClick={submit} icon={<PenLine className="size-4" />}>{t('sign.signNow')}</Button></>}
      >
        <div className="space-y-4">
          <Input label={t('sign.fullName')} value={signerName} onChange={(e) => setSignerName(e.target.value)} required autoComplete="name" dir="auto" />
          <div className="rounded-lg border border-line bg-surface-2 p-3">
            <Checkbox checked={consent} onChange={(e) => setConsent(e.target.checked)} label={data.consentText[language]} />
          </div>
          <p className="text-xs text-fg-4">{t('sign.recordNotice')}</p>
          {error && <p role="alert" className="flex items-center gap-1.5 text-sm text-danger-fg"><AlertCircle className="size-4" />{error}</p>}
          {busy && <p className="flex items-center gap-2 text-sm text-fg-3"><Spinner className="size-3.5" />{t('sign.signing')}</p>}
        </div>
      </Dialog>

      <Dialog
        open={declineOpen}
        onClose={() => setDeclineOpen(false)}
        title={t('sign.declineTitle')}
        description={t('sign.declineHint', { business: data.workspace.name })}
        footer={<><Button onClick={() => setDeclineOpen(false)}>{t('common.cancel')}</Button><Button variant="danger" loading={busy} onClick={decline}>{t('sign.declineConfirm')}</Button></>}
      >
        <Textarea label={t('sign.declineReason')} value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} rows={3} optionalLabel={t('common.optional')} />
      </Dialog>
    </PublicShell>
  )
}

export default function SignPage() {
  const { token = '' } = useParams()
  return (
    <I18nProvider initial={publicLanguageChoice() || detectLanguage()} persist={false}>
      <Signer token={token} />
    </I18nProvider>
  )
}
