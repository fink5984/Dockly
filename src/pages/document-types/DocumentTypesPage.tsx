import { useState } from 'react'
import { useI18n } from '@/contexts/I18nContext'
import { useAuth } from '@/contexts/AuthContext'
import { Card, CardContent } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { SearchInput, Input, Select, Textarea } from '@/components/ui/Input'
import { Tabs, useTabState } from '@/components/ui/Tabs'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { cn } from '@/lib/utils'
import { useSupabaseData } from '@/hooks/useSupabaseData'
import {
  getDocumentTypes, getDocumentPresets,
  createDocumentType, updateDocumentType, deleteDocumentType,
  createDocumentPreset, updateDocumentPreset, deleteDocumentPreset,
} from '@/services/documentsService'
import { Plus, FileText, Copy, Archive, GripVertical, Edit2, Trash2, Package, Eye, Save } from 'lucide-react'
import type { DocumentType, DocumentPreset } from '@/types'

export function DocumentTypesPage() {
  const { t } = useI18n()
  const { workspace, user } = useAuth()
  const wsId = workspace?.id || user?.workspaceId || ''

  const { data: allDocumentTypes, refetch: refetchDocTypes } = useSupabaseData(() => getDocumentTypes(wsId), [], [wsId])
  const { data: allPresets, refetch: refetchPresets } = useSupabaseData(() => getDocumentPresets(wsId), [], [wsId])

  const { activeTab, setActiveTab, tabs } = useTabState([
    { id: 'library', label: t('documentTypes.library'), badge: allDocumentTypes.length },
    { id: 'presets', label: t('documentTypes.presets'), badge: allPresets.length },
  ])

  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string>('all')

  // Document type modal
  const [dtModalOpen, setDtModalOpen] = useState(false)
  const [editingDt, setEditingDt] = useState<DocumentType | null>(null)
  const [dtForm, setDtForm] = useState({ name: '', description: '', category: 'general', isRequired: false })
  const [dtSaving, setDtSaving] = useState(false)
  const [dtError, setDtError] = useState('')

  // Preset modal
  const [presetModalOpen, setPresetModalOpen] = useState(false)
  const [editingPreset, setEditingPreset] = useState<DocumentPreset | null>(null)
  const [presetForm, setPresetForm] = useState({ name: '', description: '', documentTypeIds: [] as string[] })
  const [presetSaving, setPresetSaving] = useState(false)
  const [presetError, setPresetError] = useState('')

  const DOC_CATEGORIES = [
    { value: 'general', label: t('settings.docCatGeneral') },
    { value: 'identity', label: t('settings.docCatIdentity') },
    { value: 'financial', label: t('settings.docCatFinancial') },
    { value: 'legal', label: t('settings.docCatLegal') },
    { value: 'property', label: t('settings.docCatProperty') },
  ]

  const categories = Array.from(new Set(allDocumentTypes.map(d => d.category)))

  const filtered = allDocumentTypes.filter(d => {
    if (category !== 'all' && d.category !== category) return false
    if (search && !d.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const categoryCount = (cat: string) => allDocumentTypes.filter(d => d.category === cat).length

  // --- Document type handlers ---
  const openAddDt = () => {
    setDtForm({ name: '', description: '', category: 'general', isRequired: false })
    setEditingDt(null)
    setDtError('')
    setDtModalOpen(true)
  }

  const openEditDt = (doc: DocumentType) => {
    setDtForm({ name: doc.name, description: doc.description, category: doc.category, isRequired: doc.isRequired })
    setEditingDt(doc)
    setDtError('')
    setDtModalOpen(true)
  }

  const handleSaveDt = async () => {
    if (!dtForm.name.trim()) { setDtError(t('settings.docTypeNameRequired')); return }
    if (!wsId) return
    setDtSaving(true)
    setDtError('')
    try {
      if (editingDt) {
        await updateDocumentType(editingDt.id, {
          name: dtForm.name.trim(),
          description: dtForm.description.trim(),
          category: dtForm.category,
          isRequired: dtForm.isRequired,
        })
      } else {
        await createDocumentType(wsId, {
          name: dtForm.name.trim(),
          description: dtForm.description.trim(),
          category: dtForm.category,
          isRequired: dtForm.isRequired,
        })
      }
      setDtModalOpen(false)
      refetchDocTypes()
    } catch (err: any) {
      setDtError(err?.message || 'Failed to save')
    } finally {
      setDtSaving(false)
    }
  }

  const handleDeleteDt = async (id: string) => {
    try {
      await deleteDocumentType(id)
      refetchDocTypes()
    } catch (err) {
      console.error('Failed to delete document type:', err)
    }
  }

  // --- Preset handlers ---
  const openAddPreset = () => {
    setPresetForm({ name: '', description: '', documentTypeIds: [] })
    setEditingPreset(null)
    setPresetError('')
    setPresetModalOpen(true)
  }

  const openEditPreset = (p: DocumentPreset) => {
    setPresetForm({ name: p.name, description: p.description || '', documentTypeIds: [...p.documentTypeIds] })
    setEditingPreset(p)
    setPresetError('')
    setPresetModalOpen(true)
  }

  const handleSavePreset = async () => {
    if (!presetForm.name.trim()) { setPresetError(t('documentTypes.presetNameRequired') || 'Name is required'); return }
    if (!wsId) return
    setPresetSaving(true)
    setPresetError('')
    try {
      if (editingPreset) {
        await updateDocumentPreset(editingPreset.id, {
          name: presetForm.name.trim(),
          description: presetForm.description.trim(),
          documentTypeIds: presetForm.documentTypeIds,
        })
      } else {
        await createDocumentPreset(wsId, {
          name: presetForm.name.trim(),
          description: presetForm.description.trim(),
          caseType: 'general',
          documentTypeIds: presetForm.documentTypeIds,
        })
      }
      setPresetModalOpen(false)
      refetchPresets()
    } catch (err: any) {
      setPresetError(err?.message || 'Failed to save')
    } finally {
      setPresetSaving(false)
    }
  }

  const handleDeletePreset = async (id: string) => {
    try {
      await deleteDocumentPreset(id)
      refetchPresets()
    } catch (err) {
      console.error('Failed to delete preset:', err)
    }
  }

  const togglePresetDocType = (dtId: string) => {
    setPresetForm(f => ({
      ...f,
      documentTypeIds: f.documentTypeIds.includes(dtId)
        ? f.documentTypeIds.filter(id => id !== dtId)
        : [...f.documentTypeIds, dtId]
    }))
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('documentTypes.title')}</h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">{t('documentTypes.subtitle')}</p>
        </div>
        <Button onClick={openAddDt} icon={<Plus className="w-4 h-4" />}>{t('documentTypes.addType')}</Button>
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === 'library' && (
        <>
          <div className="flex flex-col sm:flex-row gap-3">
            <SearchInput value={search} onChange={setSearch} placeholder={t('documentTypes.searchTypes')} className="flex-1 max-w-sm" />
            <div className="flex gap-1.5 flex-wrap">
              <button
                onClick={() => setCategory('all')}
                className={cn(
                  'text-xs px-3 py-1.5 rounded-full transition-colors font-medium',
                  category === 'all' ? 'bg-primary-600 text-white' : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                )}
              >
                {t('common.all')} ({allDocumentTypes.length})
              </button>
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setCategory(cat)}
                  className={cn(
                    'text-xs px-3 py-1.5 rounded-full transition-colors font-medium capitalize',
                    category === cat ? 'bg-primary-600 text-white' : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                  )}
                >
                  {DOC_CATEGORIES.find(c => c.value === cat)?.label || cat} ({categoryCount(cat)})
                </button>
              ))}
            </div>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={<FileText className="w-6 h-6" />}
              title={t('documentTypes.noTypes')}
              action={<Button onClick={openAddDt} icon={<Plus className="w-4 h-4" />}>{t('documentTypes.addType')}</Button>}
            />
          ) : (
            <div className="space-y-2">
              {filtered.map(doc => (
                <Card key={doc.id}>
                  <div className="flex items-center gap-3 p-4">
                    <div className="w-9 h-9 rounded-lg bg-primary-50 dark:bg-primary-950/30 flex items-center justify-center shrink-0">
                      <FileText className="w-4 h-4 text-primary-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{doc.name}</p>
                        {doc.isRequired && <Badge variant="status" status="info" size="sm">{t('documentTypes.required')}</Badge>}
                      </div>
                      {doc.description && <p className="text-xs text-[var(--text-tertiary)] truncate mt-0.5">{doc.description}</p>}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] px-2 py-0.5 bg-[var(--bg-tertiary)] rounded-full">
                        {DOC_CATEGORIES.find(c => c.value === doc.category)?.label || doc.category}
                      </span>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => openEditDt(doc)} className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDeleteDt(doc.id)} className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] text-red-400">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {activeTab === 'presets' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {allPresets.map(preset => {
            const presetDocs = allDocumentTypes.filter(dt => preset.documentTypeIds.includes(dt.id))
            return (
              <Card key={preset.id} hover>
                <div className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Package className="w-4 h-4 text-primary-500" />
                      <p className="text-sm font-semibold">{preset.name}</p>
                    </div>
                    <span className="text-xs px-2 py-0.5 bg-[var(--bg-tertiary)] rounded-full">{preset.documentTypeIds.length} {t('documents.documentsLabel')}</span>
                  </div>
                  <div className="space-y-1.5 mb-3">
                    {presetDocs.slice(0, 4).map(d => (
                      <div key={d.id} className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                        <FileText className="w-3 h-3 text-[var(--text-tertiary)]" />
                        <span className="truncate">{d.name}</span>
                      </div>
                    ))}
                    {presetDocs.length > 4 && (
                      <p className="text-xs text-[var(--text-tertiary)] ps-5">+{presetDocs.length - 4} {t('common.more')}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" icon={<Edit2 className="w-3 h-3" />} className="flex-1" onClick={() => openEditPreset(preset)}>{t('common.edit')}</Button>
                    <Button variant="outline" size="sm" icon={<Trash2 className="w-3 h-3" />} className="text-red-400" onClick={() => handleDeletePreset(preset.id)}>{t('common.delete')}</Button>
                  </div>
                </div>
              </Card>
            )
          })}
          <Card hover>
            <button
              onClick={openAddPreset}
              className="w-full h-full min-h-[180px] flex flex-col items-center justify-center gap-2 p-5 text-[var(--text-tertiary)] hover:text-primary-600 transition-colors"
            >
              <Plus className="w-6 h-6" />
              <span className="text-sm font-medium">{t('documentTypes.createPreset')}</span>
            </button>
          </Card>
        </div>
      )}

      {/* Document Type Modal */}
      <Modal
        isOpen={dtModalOpen}
        onClose={() => setDtModalOpen(false)}
        title={editingDt ? t('settings.editDocType') : t('settings.addDocType')}
        size="md"
      >
        <div className="space-y-5 p-6">
          {dtError && (
            <div className="p-3 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 rounded-lg text-sm">{dtError}</div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1.5">{t('settings.docTypeName')}</label>
            <Input
              value={dtForm.name}
              onChange={(e) => setDtForm(f => ({ ...f, name: e.target.value }))}
              placeholder={t('settings.docTypeNamePlaceholder')}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">{t('settings.docTypeCategory')}</label>
            <Select
              value={dtForm.category}
              onChange={(e) => setDtForm(f => ({ ...f, category: e.target.value }))}
              options={DOC_CATEGORIES}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">{t('settings.docTypeDescription')}</label>
            <Textarea
              value={dtForm.description}
              onChange={(e) => setDtForm(f => ({ ...f, description: e.target.value }))}
              placeholder={t('settings.docTypeDescPlaceholder')}
              rows={2}
            />
          </div>

          <label className="flex items-center gap-3 p-3 bg-[var(--bg-tertiary)] rounded-xl cursor-pointer">
            <input
              type="checkbox"
              checked={dtForm.isRequired}
              onChange={(e) => setDtForm(f => ({ ...f, isRequired: e.target.checked }))}
              className="rounded"
            />
            <div>
              <p className="text-sm font-medium">{t('settings.docTypeRequired')}</p>
              <p className="text-xs text-[var(--text-tertiary)]">{t('settings.docTypeRequiredDesc')}</p>
            </div>
          </label>

          <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border-primary)]">
            <Button variant="outline" onClick={() => setDtModalOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleSaveDt} loading={dtSaving} icon={<Save className="w-4 h-4" />}>{t('common.save')}</Button>
          </div>
        </div>
      </Modal>

      {/* Preset Modal */}
      <Modal
        isOpen={presetModalOpen}
        onClose={() => setPresetModalOpen(false)}
        title={editingPreset ? (t('documentTypes.editPreset') || 'Edit Preset') : t('documentTypes.createPreset')}
        size="md"
      >
        <div className="space-y-5 p-6">
          {presetError && (
            <div className="p-3 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 rounded-lg text-sm">{presetError}</div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1.5">{t('documentTypes.presetName')}</label>
            <Input
              value={presetForm.name}
              onChange={(e) => setPresetForm(f => ({ ...f, name: e.target.value }))}
              placeholder={t('documentTypes.presetNamePlaceholder') || 'e.g. Standard Mortgage Documents'}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">{t('settings.docTypeDescription')}</label>
            <Textarea
              value={presetForm.description}
              onChange={(e) => setPresetForm(f => ({ ...f, description: e.target.value }))}
              placeholder={t('documentTypes.presetDescPlaceholder') || 'Brief description...'}
              rows={2}
            />
          </div>

          {allDocumentTypes.length > 0 && (
            <div>
              <label className="block text-sm font-medium mb-2">{t('documentTypes.selectDocTypes')}</label>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {allDocumentTypes.map(dt => (
                  <label key={dt.id} className="flex items-center gap-3 p-2.5 bg-[var(--bg-tertiary)] rounded-lg cursor-pointer hover:bg-[var(--bg-hover)] transition-colors">
                    <input
                      type="checkbox"
                      checked={presetForm.documentTypeIds.includes(dt.id)}
                      onChange={() => togglePresetDocType(dt.id)}
                      className="rounded"
                    />
                    <FileText className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
                    <span className="text-sm">{dt.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border-primary)]">
            <Button variant="outline" onClick={() => setPresetModalOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleSavePreset} loading={presetSaving} icon={<Save className="w-4 h-4" />}>{t('common.save')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
