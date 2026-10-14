import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams, useBlocker } from 'react-router-dom'
import { Check, Plus, UserPlus, Search, X, FileText, MessageCircle, Mail, Link2, LayoutTemplate, AlertCircle, CalendarDays, Bell } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/contexts/I18nContext'
import { useApp } from '@/contexts/AppContext'
import { useApi, invalidate } from '@/hooks/useApi'
import { clientsApi, libraryApi, requestsApi, workspaceApi } from '@/services'
import { ApiError } from '@/lib/api'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Textarea, Select, Switch, SearchInput, Checkbox } from '@/components/ui/Field'
import { PageHeader, Stepper, Avatar } from '@/components/ui/Misc'
import { Dialog, ConfirmDialog } from '@/components/ui/Dialog'
import { Badge } from '@/components/ui/Badge'
import { EmptyState, Skeleton } from '@/components/ui/States'
import type { Client, DocumentType, Language, TemplateItem } from '@/types'

type Channel = 'whatsapp' | 'email' | 'link'

interface Draft {
  clientId?: string
  newClient?: { name: string; phone: string; email: string }
  title: string
  items: TemplateItem[]
  instructions: string
  deadline: string
  language: Language | ''
  remindersEnabled: boolean
  notes: string
}

function ClientStep({ draft, setDraft, clients }: { draft: Draft; setDraft: (d: Draft) => void; clients: Client[] | undefined }) {
  const { t } = useI18n()
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(Boolean(draft.newClient))
  const filtered = (clients || []).filter((c) => c.status !== 'archived' && (!q || `${c.name} ${c.email} ${c.phone}`.toLowerCase().includes(q.toLowerCase()))).slice(0, 50)
  const nc = draft.newClient || { name: '', phone: '', email: '' }

  if (creating) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-md font-semibold">{t('requests.create.newClient')}</h2>
          <Button variant="ghost" size="sm" onClick={() => { setCreating(false); setDraft({ ...draft, newClient: undefined }) }}>{t('requests.create.pickExisting')}</Button>
        </div>
        <Input label={t('clients.name')} value={nc.name} onChange={(e) => setDraft({ ...draft, clientId: undefined, newClient: { ...nc, name: e.target.value } })} required autoFocus />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label={t('clients.phone')} type="tel" dir="ltr" value={nc.phone} onChange={(e) => setDraft({ ...draft, newClient: { ...nc, phone: e.target.value } })} hint={t('requests.create.phoneHint')} />
          <Input label={t('clients.email')} type="email" dir="ltr" value={nc.email} onChange={(e) => setDraft({ ...draft, newClient: { ...nc, email: e.target.value } })} optionalLabel={t('common.optional')} />
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput value={q} onChange={setQ} placeholder={t('requests.create.searchClients')} className="flex-1" aria-label={t('requests.create.searchClients')} autoFocus />
        <Button icon={<UserPlus className="size-4" />} onClick={() => { setCreating(true); setDraft({ ...draft, clientId: undefined, newClient: { name: q, phone: '', email: '' } }) }}>{t('requests.create.newClient')}</Button>
      </div>
      {!clients ? <Skeleton className="h-48" /> : filtered.length === 0 ? (
        <EmptyState compact icon={<Search />} title={q ? t('requests.create.noClientMatch') : t('clients.emptyTitle')} action={<Button size="sm" variant="primary" icon={<UserPlus className="size-4" />} onClick={() => { setCreating(true); setDraft({ ...draft, newClient: { name: q, phone: '', email: '' } }) }}>{t('requests.create.newClient')}</Button>} />
      ) : (
        <ul role="listbox" aria-label={t('nav.clients')} className="max-h-[420px] divide-y divide-line overflow-y-auto scroll-thin rounded-lg border border-line">
          {filtered.map((c) => {
            const selected = draft.clientId === c.id
            return (
              <li key={c.id} role="option" aria-selected={selected}>
                <button type="button" onClick={() => setDraft({ ...draft, clientId: c.id, newClient: undefined })} className={cn('flex w-full items-center gap-3 px-4 py-3 text-start hover:bg-surface-2', selected && 'bg-brand-soft hover:bg-brand-soft')}>
                  <Avatar name={c.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{c.name}</span>
                    <span className="block truncate text-xs text-fg-3" dir="ltr">{[c.phone, c.email].filter(Boolean).join(' · ') || '—'}</span>
                  </span>
                  {!c.phoneValid && c.phone && <Badge tone="warning">{t('clients.phoneInvalid')}</Badge>}
                  {selected && <Check className="size-4 text-brand-600" />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function DocumentsStep({ draft, setDraft, types, onTypeCreated }: { draft: Draft; setDraft: (d: Draft) => void; types: DocumentType[] | undefined; onTypeCreated: (d: DocumentType) => void }) {
  const { t, language } = useI18n()
  const { toastError } = useApp()
  const templates = useApi('templates', libraryApi.templates, { topics: ['templates'] })
  const [q, setQ] = useState('')
  const [newOpen, setNewOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const active = (types || []).filter((d) => d.status === 'active')
  const selected = new Map(draft.items.map((i) => [i.documentTypeId, i]))
  const toggle = (id: string) => {
    if (selected.has(id)) setDraft({ ...draft, items: draft.items.filter((i) => i.documentTypeId !== id) })
    else setDraft({ ...draft, items: [...draft.items, { documentTypeId: id, required: true, note: '' }] })
  }
  const patchItem = (id: string, p: Partial<TemplateItem>) => setDraft({ ...draft, items: draft.items.map((i) => (i.documentTypeId === id ? { ...i, ...p } : i)) })
  const applyTemplate = (id: string) => {
    const tpl = templates.data?.find((x) => x.id === id)
    if (!tpl) return
    setDraft({
      ...draft,
      title: draft.title || tpl.defaultTitle || tpl.name,
      instructions: draft.instructions || tpl.instructions,
      deadline: draft.deadline || (tpl.dueInDays ? new Date(Date.now() + tpl.dueInDays * 86400000).toISOString().slice(0, 10) : ''),
      items: tpl.items.filter((i) => active.some((d) => d.id === i.documentTypeId)),
    })
  }
  const createType = async () => {
    if (!newName.trim()) return
    setBusy(true)
    try {
      const d = await libraryApi.createDocumentType({ name: newName.trim(), allowedFormats: ['pdf', 'jpg', 'png', 'heic'], maxSizeMB: 15 })
      onTypeCreated(d)
      setDraft({ ...draft, items: [...draft.items, { documentTypeId: d.id, required: true, note: '' }] })
      setNewOpen(false)
      setNewName('')
    } catch (err) {
      toastError(err, t('requests.create.typeFailed'))
    } finally {
      setBusy(false)
    }
  }
  const visible = active.filter((d) => !q || d.name.toLowerCase().includes(q.toLowerCase()))

  return (
    <div className="space-y-5">
      <Input label={t('requests.create.titleLabel')} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder={t('requests.create.titlePlaceholder')} required hint={t('requests.create.titleHint')} />
      {templates.data && templates.data.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-2 p-3 sm:flex-row sm:items-center">
          <LayoutTemplate className="hidden size-4 text-fg-3 sm:block" />
          <span className="text-sm text-fg-2">{t('requests.create.startFromTemplate')}</span>
          <Select
            selectSize="sm"
            wrapperClassName="sm:ms-auto sm:w-64"
            aria-label={t('requests.create.startFromTemplate')}
            value=""
            onChange={(e) => applyTemplate(e.target.value)}
            options={[{ value: '', label: t('requests.create.chooseTemplate') }, ...templates.data.map((x) => ({ value: x.id, label: x.name }))]}
          />
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">{t('requests.create.library')}</h3>
            <Button size="xs" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setNewOpen(true)}>{t('requests.create.newType')}</Button>
          </div>
          <SearchInput value={q} onChange={setQ} placeholder={t('requests.create.searchTypes')} aria-label={t('requests.create.searchTypes')} className="mb-2" />
          {!types ? <Skeleton className="h-64" /> : (
            <ul className="max-h-[360px] divide-y divide-line overflow-y-auto scroll-thin rounded-lg border border-line">
              {visible.length === 0 && <li className="px-4 py-8 text-center text-sm text-fg-3">{t('requests.create.noTypes')}</li>}
              {visible.map((d) => (
                <li key={d.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                    <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggle(d.id)} className="size-4 accent-brand-600" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{d.name}</span>
                      <span className="block text-xs text-fg-4">{d.allowedFormats.join(', ').toUpperCase()} · {d.maxSizeMB} MB</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold">{t('requests.create.selected', { count: draft.items.length })}</h3>
          {draft.items.length === 0 ? (
            <div className="flex h-[200px] items-center justify-center rounded-lg border border-dashed border-line-2 px-6 text-center text-sm text-fg-3">{t('requests.create.selectHint')}</div>
          ) : (
            <ol className="space-y-2">
              {draft.items.map((item, i) => {
                const d = types?.find((x) => x.id === item.documentTypeId)
                return (
                  <li key={item.documentTypeId} className="rounded-lg border border-line bg-surface p-3">
                    <div className="flex items-center gap-2">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-3 text-2xs font-semibold text-fg-3 tabular">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{d?.name}</span>
                      <label className="flex items-center gap-1.5 text-xs text-fg-3">
                        <input type="checkbox" checked={item.required} onChange={(e) => patchItem(item.documentTypeId, { required: e.target.checked })} className="size-3.5 accent-brand-600" />
                        {t('common.required')}
                      </label>
                      <button type="button" onClick={() => toggle(item.documentTypeId)} className="rounded p-1 text-fg-4 hover:bg-surface-3 hover:text-fg-2" aria-label={`${t('common.remove')} ${d?.name}`}><X className="size-3.5" /></button>
                    </div>
                    <input
                      value={item.note}
                      onChange={(e) => patchItem(item.documentTypeId, { note: e.target.value })}
                      placeholder={t('requests.create.itemNote')}
                      aria-label={`${t('requests.create.itemNote')} — ${d?.name}`}
                      maxLength={500}
                      className="mt-2 h-8 w-full rounded-md border border-line bg-surface-2 px-2.5 text-sm placeholder:text-fg-4 focus:border-brand-500 focus:outline-none"
                    />
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      </div>
      <Dialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title={t('requests.create.newType')}
        size="sm"
        footer={<><Button onClick={() => setNewOpen(false)}>{t('common.cancel')}</Button><Button variant="primary" loading={busy} onClick={createType} disabled={!newName.trim()}>{t('common.add')}</Button></>}
      >
        <form onSubmit={(e) => { e.preventDefault(); createType() }}>
          <Input label={t('requests.create.typeName')} value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus hint={t('requests.create.typeNameHint')} />
        </form>
      </Dialog>
      <span className="sr-only">{language}</span>
    </div>
  )
}

function DetailsStep({ draft, setDraft }: { draft: Draft; setDraft: (d: Draft) => void }) {
  const { t } = useI18n()
  return (
    <div className="space-y-5">
      <Textarea label={t('requests.create.instructions')} value={draft.instructions} onChange={(e) => setDraft({ ...draft, instructions: e.target.value })} rows={4} placeholder={t('requests.create.instructionsPlaceholder')} hint={t('requests.create.instructionsHint')} optionalLabel={t('common.optional')} maxLength={4000} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label={t('requests.create.deadline')} type="date" value={draft.deadline} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setDraft({ ...draft, deadline: e.target.value })} leading={<CalendarDays className="size-4" />} optionalLabel={t('common.optional')} />
        <Select label={t('requests.create.language')} value={draft.language} onChange={(e) => setDraft({ ...draft, language: e.target.value as Language | '' })} options={[{ value: '', label: t('requests.create.languageDefault') }, { value: 'he', label: 'עברית' }, { value: 'en', label: 'English' }]} />
      </div>
      <Card className="p-4">
        <Switch checked={draft.remindersEnabled} onChange={(v) => setDraft({ ...draft, remindersEnabled: v })} label={<span className="inline-flex items-center gap-2"><Bell className="size-4 text-fg-3" />{t('requests.create.reminders')}</span>} description={t('requests.create.remindersHint')} />
      </Card>
      <Textarea label={t('requests.create.internalNotes')} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} rows={2} hint={t('requests.create.internalNotesHint')} optionalLabel={t('common.optional')} />
    </div>
  )
}

function PortalPreview({ draft, types, clientName, wsName, color }: { draft: Draft; types: DocumentType[]; clientName: string; wsName: string; color?: string }) {
  const { t } = useI18n()
  return (
    <div className="overflow-hidden rounded-[22px] border-[6px] border-fg/90 bg-canvas shadow-lg" aria-label={t('requests.create.preview')}>
      <div className="h-1.5" style={{ background: color || 'var(--dk-brand-600)' }} />
      <div className="space-y-3 p-4">
        <p className="text-2xs font-semibold uppercase tracking-wide text-fg-4">{wsName}</p>
        <p className="text-md font-semibold leading-snug">{t('portal.greeting', { name: clientName.split(' ')[0] || '' })}</p>
        <p className="text-xs text-fg-3">{draft.title}</p>
        {draft.instructions && <p className="rounded-lg bg-surface p-2.5 text-xs text-fg-2 whitespace-pre-wrap">{draft.instructions}</p>}
        <ul className="space-y-1.5">
          {draft.items.slice(0, 5).map((i) => (
            <li key={i.documentTypeId} className="flex items-center gap-2 rounded-lg bg-surface p-2.5 text-xs">
              <FileText className="size-3.5 text-fg-4" />
              <span className="flex-1 truncate">{types.find((d) => d.id === i.documentTypeId)?.name}</span>
              {!i.required && <span className="text-fg-4">{t('common.optional')}</span>}
            </li>
          ))}
          {draft.items.length > 5 && <li className="text-center text-xs text-fg-4">+{draft.items.length - 5}</li>}
        </ul>
      </div>
    </div>
  )
}

export default function RequestCreatePage() {
  const { t } = useI18n()
  const { toast, toastError } = useApp()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const clients = useApi('clients:all', () => clientsApi.list(), { topics: ['clients'] })
  const types = useApi('document-types', libraryApi.documentTypes, { topics: ['document-types'] })
  const ws = useApi('workspace', workspaceApi.get)
  const channels = useApi('integrations', workspaceApi.integrations)
  const [step, setStep] = useState(0)
  const [draft, setDraft] = useState<Draft>({
    clientId: params.get('clientId') || undefined, title: '', items: [], instructions: '', deadline: '', language: '', remindersEnabled: true, notes: '',
  })
  const [channel, setChannel] = useState<Channel>('whatsapp')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const savedRef = useRef(false)
  const [errors, setErrors] = useState('')

  const client = clients.data?.find((c) => c.id === draft.clientId)
  const clientName = client?.name || draft.newClient?.name || ''
  const phone = client?.phone ?? draft.newClient?.phone ?? ''
  const email = client?.email ?? draft.newClient?.email ?? ''
  const phoneOk = client ? client.phoneValid : /\d{9,}/.test(phone.replace(/\D/g, ''))
  const emailOk = Boolean(channels.data?.email.configured && /\S+@\S+\.\S+/.test(email))
  const dirty = !saved && (Boolean(draft.clientId || draft.newClient?.name) || draft.items.length > 0 || Boolean(draft.title))

  useEffect(() => {
    if (!phoneOk && channel === 'whatsapp') setChannel(emailOk ? 'email' : 'link')
  }, [phoneOk, emailOk, channel])

  // Unsaved-changes protection (in-app navigation + tab close)
  // savedRef updates synchronously, so the redirect after creating isn't blocked by stale state.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !savedRef.current && currentLocation.pathname !== nextLocation.pathname)
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const steps = useMemo(() => [
    { id: 'client', label: t('requests.create.stepClient') },
    { id: 'docs', label: t('requests.create.stepDocuments') },
    { id: 'details', label: t('requests.create.stepDetails') },
    { id: 'review', label: t('requests.create.stepReview') },
  ], [t])

  const canNext = [
    Boolean(draft.clientId || draft.newClient?.name.trim()),
    Boolean(draft.title.trim()) && draft.items.length > 0,
    true,
    true,
  ][step]

  const next = () => {
    if (!canNext) {
      setErrors(step === 0 ? t('requests.create.errClient') : t('requests.create.errDocs'))
      return
    }
    setErrors('')
    setStep((s) => Math.min(3, s + 1))
    window.scrollTo({ top: 0 })
  }

  const submit = async () => {
    setBusy(true)
    try {
      const res = await requestsApi.create({
        clientId: draft.clientId,
        newClient: draft.newClient ? { name: draft.newClient.name.trim(), phone: draft.newClient.phone.trim(), email: draft.newClient.email.trim() } : undefined,
        title: draft.title.trim(),
        instructions: draft.instructions,
        notes: draft.notes,
        deadline: draft.deadline || null,
        language: draft.language || null,
        remindersEnabled: draft.remindersEnabled,
        items: draft.items,
        send: channel === 'link' ? null : { channel },
      })
      savedRef.current = true
      setSaved(true)
      invalidate('requests:')
      invalidate('clients')
      invalidate('dashboard')
      if (res.send && !res.send.ok) toast({ tone: 'warning', title: t('requests.create.createdNotSent'), message: res.send.error })
      else if (res.send?.simulated) toast({ tone: 'info', title: t('requests.create.createdSimulated') })
      else toast({ tone: 'success', title: channel === 'link' ? t('requests.create.createdLink') : t('requests.create.createdSent') })
      navigate(`/app/requests/${res.request.id}`, { replace: true })
    } catch (err) {
      if (err instanceof ApiError && err.code === 'validation_failed') setErrors(Object.values(err.fields)[0] || err.message)
      toastError(err, t('requests.create.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t('requests.create.title')} breadcrumbs={[{ label: t('nav.requests'), to: '/app/requests' }, { label: t('requests.create.title') }]} />
      <div className="mb-6"><Stepper steps={steps} current={step} onStepClick={setStep} /></div>
      <div className={cn('grid gap-6', step === 3 && 'lg:grid-cols-[minmax(0,1fr)_300px]')}>
        <Card className="p-5 sm:p-6">
          {step === 0 && <ClientStep draft={draft} setDraft={setDraft} clients={clients.data} />}
          {step === 1 && <DocumentsStep draft={draft} setDraft={setDraft} types={types.data} onTypeCreated={(d) => types.mutate([...(types.data || []), d])} />}
          {step === 2 && <DetailsStep draft={draft} setDraft={setDraft} />}
          {step === 3 && (
            <div className="space-y-6">
              <dl className="grid gap-4 sm:grid-cols-2">
                <div><dt className="text-xs text-fg-3">{t('requests.col.client')}</dt><dd className="mt-0.5 font-medium">{clientName}{draft.newClient && <Badge tone="brand" className="ms-2">{t('requests.create.newBadge')}</Badge>}</dd></div>
                <div><dt className="text-xs text-fg-3">{t('requests.col.request')}</dt><dd className="mt-0.5 font-medium">{draft.title}</dd></div>
                <div><dt className="text-xs text-fg-3">{t('requests.create.documentsLabel')}</dt><dd className="mt-0.5">{t('requests.create.docSummary', { count: draft.items.length, required: draft.items.filter((i) => i.required).length })}</dd></div>
                <div><dt className="text-xs text-fg-3">{t('requests.create.deadline')}</dt><dd className="mt-0.5">{draft.deadline || '—'}</dd></div>
              </dl>
              <fieldset>
                <legend className="mb-2 text-sm font-semibold">{t('requests.create.howToSend')}</legend>
                <div className="grid gap-2 sm:grid-cols-3">
                  {([
                    { id: 'whatsapp', icon: MessageCircle, ok: phoneOk, hint: phoneOk ? phone : t('requests.create.noPhone') },
                    { id: 'email', icon: Mail, ok: emailOk, hint: !channels.data?.email.configured ? t('requests.create.emailOff') : email || t('requests.create.noEmail') },
                    { id: 'link', icon: Link2, ok: true, hint: t('requests.create.linkHint') },
                  ] as const).map((o) => (
                    <label key={o.id} className={cn('relative flex cursor-pointer flex-col gap-1 rounded-lg border p-3 transition-colors', channel === o.id ? 'border-brand-500 bg-brand-soft' : 'border-line hover:border-line-2', !o.ok && 'cursor-not-allowed opacity-50')}>
                      <input type="radio" name="channel" value={o.id} checked={channel === o.id} disabled={!o.ok} onChange={() => setChannel(o.id)} className="sr-only" />
                      <span className="flex items-center gap-2 text-sm font-medium"><o.icon className="size-4" />{t(`requests.create.channel.${o.id}`)}</span>
                      <span className="truncate text-xs text-fg-3" dir={o.id === 'link' ? undefined : 'ltr'}>{o.hint}</span>
                    </label>
                  ))}
                </div>
                {channel === 'whatsapp' && channels.data?.whatsapp.mode === 'log' && (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-warning-fg"><AlertCircle className="mt-px size-3.5 shrink-0" />{t('requests.create.waSimulated')}</p>
                )}
              </fieldset>
            </div>
          )}
          {errors && <p role="alert" className="mt-4 flex items-center gap-1.5 text-sm text-danger-fg"><AlertCircle className="size-4" />{errors}</p>}
          <div className="mt-6 flex items-center justify-between gap-3 border-t border-line pt-5">
            <Button variant="ghost" onClick={() => (step === 0 ? navigate('/app/requests') : setStep(step - 1))}>{step === 0 ? t('common.cancel') : t('common.back')}</Button>
            {step < 3 ? (
              <Button variant="primary" onClick={next}>{t('common.next')}</Button>
            ) : (
              <Button variant="primary" loading={busy} onClick={submit} icon={channel === 'link' ? <Check className="size-4" /> : <MessageCircle className="size-4" />}>
                {channel === 'link' ? t('requests.create.createOnly') : t('requests.create.createAndSend')}
              </Button>
            )}
          </div>
        </Card>
        {step === 3 && types.data && (
          <aside className="hidden lg:block">
            <p className="mb-2 text-sm font-medium text-fg-3">{t('requests.create.preview')}</p>
            <PortalPreview draft={draft} types={types.data} clientName={clientName} wsName={ws.data?.name || ''} color={ws.data?.brandColor} />
          </aside>
        )}
      </div>
      <ConfirmDialog
        open={blocker.state === 'blocked'}
        onClose={() => blocker.reset?.()}
        onConfirm={() => blocker.proceed?.()}
        title={t('common.unsavedChanges')}
        confirmLabel={t('requests.create.discard')}
      />
      <span hidden><Checkbox label="" /></span>
    </div>
  )
}
