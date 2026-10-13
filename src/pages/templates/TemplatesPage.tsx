import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { LayoutTemplate, FileText, Plus, Pencil, Copy, Trash2, Sparkles, X } from 'lucide-react'
import { useI18n } from '@/contexts/I18nContext'
import { useAuth } from '@/contexts/AuthContext'
import { useApp } from '@/contexts/AppContext'
import { useApi, invalidate } from '@/hooks/useApi'
import { libraryApi } from '@/services'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Textarea, Select, Checkbox } from '@/components/ui/Field'
import { PageHeader } from '@/components/ui/Misc'
import { Tabs, TabPanel } from '@/components/ui/Tabs'
import { Menu } from '@/components/ui/Menu'
import { Dialog, ConfirmDialog } from '@/components/ui/Dialog'
import { Badge } from '@/components/ui/Badge'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/States'
import type { DocumentType, RequestTemplate, TemplateItem } from '@/types'

const FORMATS = ['pdf', 'jpg', 'png', 'heic', 'webp', 'doc', 'docx', 'xls', 'xlsx']

function TemplateDialog({ open, onClose, template, types }: { open: boolean; onClose: () => void; template?: RequestTemplate; types: DocumentType[] }) {
  const { t } = useI18n()
  const { toast, toastError } = useApp()
  const [f, setF] = useState({ name: '', description: '', defaultTitle: '', instructions: '', dueInDays: '' })
  const [items, setItems] = useState<TemplateItem[]>([])
  const [add, setAdd] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    setF({ name: template?.name || '', description: template?.description || '', defaultTitle: template?.defaultTitle || '', instructions: template?.instructions || '', dueInDays: template?.dueInDays ? String(template.dueInDays) : '' })
    setItems(template?.items || [])
  }, [open, template])
  const save = async () => {
    setBusy(true)
    try {
      const body = { name: f.name.trim(), description: f.description, defaultTitle: f.defaultTitle, instructions: f.instructions, dueInDays: f.dueInDays ? Number(f.dueInDays) : undefined, items }
      if (template) await libraryApi.updateTemplate(template.id, body)
      else await libraryApi.createTemplate(body)
      invalidate('templates')
      toast({ tone: 'success', title: t('templates.saved') })
      onClose()
    } catch (err) { toastError(err, t('templates.saveFailed')) } finally { setBusy(false) }
  }
  const available = types.filter((d) => d.status === 'active' && !items.some((i) => i.documentTypeId === d.id))
  return (
    <Dialog open={open} onClose={onClose} title={template ? t('templates.edit') : t('templates.new')} size="lg"
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={busy} disabled={!f.name.trim() || !items.length} onClick={save}>{t('common.save')}</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label={t('templates.name')} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus />
          <Input label={t('templates.defaultTitle')} value={f.defaultTitle} onChange={(e) => setF({ ...f, defaultTitle: e.target.value })} hint={t('templates.defaultTitleHint')} />
        </div>
        <Textarea label={t('requests.create.instructions')} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} rows={3} optionalLabel={t('common.optional')} />
        <Input label={t('templates.dueIn')} type="number" min={1} max={365} value={f.dueInDays} onChange={(e) => setF({ ...f, dueInDays: e.target.value })} optionalLabel={t('common.optional')} hint={t('templates.dueInHint')} />
        <div>
          <p className="mb-2 text-sm font-medium text-fg-2">{t('templates.documents')}</p>
          <ul className="space-y-2">
            {items.map((it) => {
              const d = types.find((x) => x.id === it.documentTypeId)
              return (
                <li key={it.documentTypeId} className="flex items-center gap-2 rounded-lg border border-line p-2.5">
                  <FileText className="size-4 text-fg-4" />
                  <span className="min-w-0 flex-1 truncate text-sm">{d?.name || '—'}</span>
                  <Checkbox label={t('common.required')} checked={it.required} onChange={(e) => setItems(items.map((x) => (x === it ? { ...x, required: e.target.checked } : x)))} />
                  <button type="button" onClick={() => setItems(items.filter((x) => x !== it))} className="rounded p-1 text-fg-4 hover:bg-surface-3" aria-label={t('common.remove')}><X className="size-4" /></button>
                </li>
              )
            })}
          </ul>
          <div className="mt-2 flex gap-2">
            <Select selectSize="sm" wrapperClassName="flex-1" aria-label={t('templates.addDocument')} value={add} onChange={(e) => setAdd(e.target.value)} options={[{ value: '', label: t('templates.addDocument') }, ...available.map((d) => ({ value: d.id, label: d.name }))]} />
            <Button size="sm" disabled={!add} onClick={() => { setItems([...items, { documentTypeId: add, required: true, note: '' }]); setAdd('') }} icon={<Plus className="size-4" />}>{t('common.add')}</Button>
          </div>
        </div>
      </div>
    </Dialog>
  )
}

function TypeDialog({ open, onClose, type }: { open: boolean; onClose: () => void; type?: DocumentType }) {
  const { t } = useI18n()
  const { toast, toastError } = useApp()
  const [f, setF] = useState({ name: '', description: '', helperText: '', maxSizeMB: 15, allowedFormats: ['pdf', 'jpg', 'png'] as string[] })
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) setF({ name: type?.name || '', description: type?.description || '', helperText: type?.helperText || '', maxSizeMB: type?.maxSizeMB || 15, allowedFormats: type?.allowedFormats || ['pdf', 'jpg', 'png', 'heic'] })
  }, [open, type])
  const save = async () => {
    setBusy(true)
    try {
      if (type) await libraryApi.updateDocumentType(type.id, f)
      else await libraryApi.createDocumentType(f)
      invalidate('document-types')
      toast({ tone: 'success', title: t('templates.saved') })
      onClose()
    } catch (err) { toastError(err, t('templates.saveFailed')) } finally { setBusy(false) }
  }
  return (
    <Dialog open={open} onClose={onClose} title={type ? t('templates.editType') : t('templates.newType')}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={busy} disabled={!f.name.trim() || !f.allowedFormats.length} onClick={save}>{t('common.save')}</Button></>}>
      <div className="space-y-4">
        <Input label={t('templates.typeName')} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus />
        <Textarea label={t('templates.clientHelp')} value={f.helperText} onChange={(e) => setF({ ...f, helperText: e.target.value })} rows={2} hint={t('templates.clientHelpHint')} optionalLabel={t('common.optional')} />
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-fg-2">{t('templates.formats')}</legend>
          <div className="flex flex-wrap gap-2">
            {FORMATS.map((fmt) => {
              const on = f.allowedFormats.includes(fmt)
              return (
                <button key={fmt} type="button" aria-pressed={on} onClick={() => setF({ ...f, allowedFormats: on ? f.allowedFormats.filter((x) => x !== fmt) : [...f.allowedFormats, fmt] })}
                  className={on ? 'rounded-full border border-brand-500 bg-brand-soft px-3 py-1 text-xs font-medium text-brand-700' : 'rounded-full border border-line-2 px-3 py-1 text-xs text-fg-3 hover:border-fg-4'}>
                  {fmt.toUpperCase()}
                </button>
              )
            })}
          </div>
        </fieldset>
        <Input label={t('templates.maxSize')} type="number" min={1} max={25} value={f.maxSizeMB} onChange={(e) => setF({ ...f, maxSizeMB: Math.max(1, Math.min(25, Number(e.target.value) || 1)) })} />
      </div>
    </Dialog>
  )
}

export default function TemplatesPage() {
  const { t, language } = useI18n()
  const { can } = useAuth()
  const { toast, toastError } = useApp()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'types' ? 'types' : 'templates'
  const templates = useApi('templates', libraryApi.templates, { topics: ['templates'] })
  const types = useApi('document-types', libraryApi.documentTypes, { topics: ['document-types'] })
  const starters = useApi('starters', libraryApi.starters)
  const [editTpl, setEditTpl] = useState<RequestTemplate | 'new' | null>(null)
  const [editType, setEditType] = useState<DocumentType | 'new' | null>(null)
  const [deleting, setDeleting] = useState<{ kind: 'tpl' | 'type'; id: string; name: string } | null>(null)
  const canWrite = can('member')
  const installed = new Set((templates.data || []).map((x) => x.name))
  const freshStarters = (starters.data || []).filter((s) => !installed.has(language === 'he' ? s.he : s.en))

  return (
    <>
      <PageHeader
        title={t('templates.title')}
        description={t('templates.subtitle')}
        actions={canWrite && (tab === 'templates'
          ? <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditTpl('new')}>{t('templates.new')}</Button>
          : <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditType('new')}>{t('templates.newType')}</Button>)}
      />
      <Tabs label={t('templates.title')} value={tab} onChange={(v) => setParams(v === 'types' ? { tab: 'types' } : {}, { replace: true })} className="mb-5"
        tabs={[{ id: 'templates', label: t('templates.tabTemplates'), count: templates.data?.length }, { id: 'types', label: t('templates.tabTypes'), count: types.data?.filter((d) => d.status === 'active').length }]} />

      <TabPanel id="templates" active={tab === 'templates'} className="space-y-6">
        {templates.error ? <Card><ErrorState onRetry={templates.refetch} /></Card> : templates.loading ? <Card><ListSkeleton /></Card> : (
          <>
            {templates.data!.length === 0 ? (
              <Card><EmptyState icon={<LayoutTemplate />} title={t('templates.emptyTitle')} description={t('templates.emptyHint')} /></Card>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {templates.data!.map((tpl) => (
                  <Card key={tpl.id} className="flex flex-col p-5">
                    <div className="flex items-start gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-600"><LayoutTemplate className="size-4" /></span>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate font-semibold">{tpl.name}</h3>
                        <p className="text-xs text-fg-3">{t('templates.docCount', { count: tpl.items.length })}{tpl.dueInDays ? ` · ${t('templates.dueInShort', { count: tpl.dueInDays })}` : ''}</p>
                      </div>
                      {canWrite && <Menu items={[
                        { label: t('common.edit'), icon: <Pencil />, onSelect: () => setEditTpl(tpl) },
                        { label: t('templates.duplicate'), icon: <Copy />, onSelect: () => libraryApi.duplicateTemplate(tpl.id).then(() => invalidate('templates')).catch((e) => toastError(e, t('common.error'))) },
                        { label: t('common.delete'), icon: <Trash2 />, tone: 'danger', onSelect: () => setDeleting({ kind: 'tpl', id: tpl.id, name: tpl.name }) },
                      ]} />}
                    </div>
                    <ul className="mt-4 flex-1 space-y-1">
                      {tpl.items.slice(0, 5).map((i) => <li key={i.documentTypeId} className="truncate text-sm text-fg-2">• {types.data?.find((d) => d.id === i.documentTypeId)?.name}</li>)}
                      {tpl.items.length > 5 && <li className="text-xs text-fg-4">+{tpl.items.length - 5}</li>}
                    </ul>
                  </Card>
                ))}
              </div>
            )}
            {canWrite && freshStarters.length > 0 && (
              <section>
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg-2"><Sparkles className="size-4 text-brand-600" />{t('templates.starters')}</h2>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {freshStarters.map((s) => (
                    <div key={s.key} className="flex items-center gap-3 rounded-xl border border-dashed border-line-2 bg-surface p-4">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{language === 'he' ? s.he : s.en}</p>
                        <p className="truncate text-xs text-fg-3">{s.docs.map((d) => (language === 'he' ? d[1] : d[0])).join(' · ')}</p>
                      </div>
                      <Button size="sm" onClick={() => libraryApi.installStarter(s.key, language).then(() => { invalidate('templates'); invalidate('document-types'); toast({ tone: 'success', title: t('templates.installed') }) }).catch((e) => toastError(e, t('common.error')))}>{t('templates.install')}</Button>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </TabPanel>

      <TabPanel id="types" active={tab === 'types'}>
        <Card className="overflow-hidden">
          {types.error ? <ErrorState onRetry={types.refetch} /> : types.loading ? <ListSkeleton /> : types.data!.length === 0 ? (
            <EmptyState icon={<FileText />} title={t('templates.noTypes')} description={t('templates.noTypesHint')} />
          ) : (
            <ul className="divide-y divide-line">
              {types.data!.map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-5 py-3">
                  <FileText className="size-4 shrink-0 text-fg-4" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-sm font-medium">{d.name}{d.status === 'archived' && <Badge>{t('templates.archivedBadge')}</Badge>}</p>
                    <p className="truncate text-xs text-fg-3">{d.allowedFormats.join(', ').toUpperCase()} · {d.maxSizeMB} MB{d.usageCount ? ` · ${t('templates.usedIn', { count: d.usageCount })}` : ''}</p>
                  </div>
                  {canWrite && <Menu items={[
                    { label: t('common.edit'), icon: <Pencil />, onSelect: () => setEditType(d) },
                    ...(can('admin') ? [{ label: d.usageCount ? t('templates.archive') : t('common.delete'), icon: <Trash2 />, tone: 'danger' as const, onSelect: () => setDeleting({ kind: 'type', id: d.id, name: d.name }) }] : []),
                  ]} />}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </TabPanel>

      <TemplateDialog open={editTpl !== null} onClose={() => setEditTpl(null)} template={editTpl && editTpl !== 'new' ? editTpl : undefined} types={types.data || []} />
      <TypeDialog open={editType !== null} onClose={() => setEditType(null)} type={editType && editType !== 'new' ? editType : undefined} />
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={t('templates.deleteTitle', { name: deleting?.name || '' })}
        description={deleting?.kind === 'type' ? t('templates.deleteTypeHint') : undefined}
        confirmLabel={t('common.delete')}
        onConfirm={async () => {
          try {
            if (deleting!.kind === 'tpl') { await libraryApi.deleteTemplate(deleting!.id); invalidate('templates') }
            else { const r = await libraryApi.deleteDocumentType(deleting!.id); invalidate('document-types'); if (r.archived) toast({ tone: 'info', title: t('templates.archivedInstead') }) }
          } catch (e) { toastError(e, t('common.error')); throw e }
        }}
      />
    </>
  )
}
