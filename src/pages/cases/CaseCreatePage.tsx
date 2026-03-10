import { useState, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useI18n } from '@/contexts/I18nContext'
import { useAuth } from '@/contexts/AuthContext'
import { useApp } from '@/contexts/AppContext'
import { Card, CardHeader, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Textarea, SearchInput, Select } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { cn, getDocCategoryKey } from '@/lib/utils'
import { useSupabaseData } from '@/hooks/useSupabaseData'
import { getClients } from '@/services/clientsService'
import { getDocumentTypes, getDocumentPresets, createDocumentType } from '@/services/documentsService'
import { createCase } from '@/services/casesService'
import { createActivity } from '@/services/activityService'
import {
  Check, FileText, X, Plus, Package,
  ArrowLeft, ArrowRight,
} from 'lucide-react'
import type { DocumentType } from '@/types'

export function CaseCreatePage() {
  const { t, direction } = useI18n()
  const navigate = useNavigate()
  const { user, workspace } = useAuth()
  const { addToast } = useApp()
  const [searchParams] = useSearchParams()
  const preselectedClientId = searchParams.get('clientId') || ''
  const wsId = workspace?.id || user?.workspaceId || ''

  const BackArrow = direction === 'rtl' ? ArrowRight : ArrowLeft

  // Data
  const { data: allClients } = useSupabaseData(
    () => getClients(wsId), [], [wsId]
  )
  const { data: allDocumentTypes, refetch: refetchDocTypes } = useSupabaseData(
    () => getDocumentTypes(wsId), [], [wsId]
  )
  const { data: allPresets } = useSupabaseData(
    () => getDocumentPresets(wsId), [], [wsId]
  )

  // Form state
  const [clientId, setClientId] = useState(preselectedClientId)
  const [clientSearch, setClientSearch] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [selectedDocs, setSelectedDocs] = useState<DocumentType[]>([])
  const [deadline, setDeadline] = useState('')
  const [docSearch, setDocSearch] = useState('')
  const [docCategory, setDocCategory] = useState<string>('all')

  // Save state
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Inline document type creation
  const [showNewDocTypeModal, setShowNewDocTypeModal] = useState(false)
  const [newDocTypeName, setNewDocTypeName] = useState('')
  const [newDocTypeCategory, setNewDocTypeCategory] = useState('general')
  const [newDocTypeDescription, setNewDocTypeDescription] = useState('')
  const [newDocTypeSaving, setNewDocTypeSaving] = useState(false)
  const [newDocTypeError, setNewDocTypeError] = useState('')

  // Derived
  const selectedClient = allClients.find(c => c.id === clientId)
  const isClientPreselected = !!preselectedClientId

  const categories = useMemo(
    () => Array.from(new Set(allDocumentTypes.map(d => d.category))),
    [allDocumentTypes]
  )

  const filteredClients = allClients.filter(c =>
    !clientSearch || c.name.toLowerCase().includes(clientSearch.toLowerCase()) || c.email.toLowerCase().includes(clientSearch.toLowerCase())
  )

  const filteredDocs = allDocumentTypes.filter(d => {
    if (docCategory !== 'all' && d.category !== docCategory) return false
    if (docSearch && !d.name.toLowerCase().includes(docSearch.toLowerCase())) return false
    return true
  })

  const toggleDoc = (doc: DocumentType) => {
    setSelectedDocs(prev =>
      prev.some(d => d.id === doc.id)
        ? prev.filter(d => d.id !== doc.id)
        : [...prev, doc]
    )
  }

  const applyPreset = (presetId: string) => {
    const preset = allPresets.find(p => p.id === presetId)
    if (!preset) return
    const docs = allDocumentTypes.filter(dt => preset.documentTypeIds.includes(dt.id))
    setSelectedDocs(docs)
  }

  const canSave = clientId && title.trim() && selectedDocs.length > 0

  // ---- Inline Document Type Creation ----
  const handleCreateDocType = async () => {
    if (!newDocTypeName.trim()) {
      setNewDocTypeError(t('settings.docTypeNameRequired') || 'Name is required')
      return
    }
    if (!wsId) return
    setNewDocTypeSaving(true)
    setNewDocTypeError('')
    try {
      const created = await createDocumentType(wsId, {
        name: newDocTypeName.trim(),
        category: newDocTypeCategory,
        description: newDocTypeDescription.trim(),
      })
      await refetchDocTypes()
      setSelectedDocs(prev => [...prev, created])
      setNewDocTypeName('')
      setNewDocTypeCategory('general')
      setNewDocTypeDescription('')
      setShowNewDocTypeModal(false)
    } catch (err: any) {
      setNewDocTypeError(err?.message || 'Failed to create document type')
    } finally {
      setNewDocTypeSaving(false)
    }
  }

  // ---- Save Request ----
  const handleCreate = async () => {
    if (!canSave || !wsId) return
    setSaving(true)
    setError('')
    try {
      const result = await createCase(wsId, {
        clientId,
        caseType: title.trim(),
        notes: description.trim() || undefined,
        deadline: deadline || undefined,
        assignedOwner: user?.name || '',
        documentTypeIds: selectedDocs.map(d => d.id),
      })

      try {
        await createActivity(wsId, {
          type: 'case_created',
          description: `Created request "${title.trim()}" for ${selectedClient?.name || 'client'}`,
          userId: user?.id || '',
          userName: user?.name || '',
          clientId: clientId,
          clientName: selectedClient?.name,
          caseId: result.id,
        })
      } catch {
        // Non-critical
      }

      addToast({ type: 'success', title: t('requests.createSuccess') || 'Request created successfully' })
      navigate(`/requests/${result.id}`)
    } catch (err: any) {
      setError(err?.message || 'Failed to create request')
      addToast({ type: 'error', title: t('common.error'), message: err?.message })
    } finally {
      setSaving(false)
    }
  }

  const DOC_CATEGORIES = [
    { value: 'general', label: t('settings.docCatGeneral') || 'General' },
    { value: 'identity', label: t('settings.docCatIdentity') || 'Identity' },
    { value: 'financial', label: t('settings.docCatFinancial') || 'Financial' },
    { value: 'legal', label: t('settings.docCatLegal') || 'Legal' },
    { value: 'property', label: t('settings.docCatProperty') || 'Property' },
  ]

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(isClientPreselected ? `/clients/${clientId}` : '/requests')}
          className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)]"
        >
          <BackArrow className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold">{t('requests.newRequest')}</h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">{t('requests.newRequestDesc')}</p>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Client Section */}
      <Card>
        <CardHeader title={t('requests.client')} />
        <CardContent>
          {isClientPreselected && selectedClient ? (
            <div className="flex items-center gap-3 p-3 bg-[var(--bg-tertiary)] rounded-xl">
              <div className="w-10 h-10 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-sm font-bold">
                {selectedClient.name.split(' ').map(n => n[0]).join('')}
              </div>
              <div>
                <p className="text-sm font-medium">{selectedClient.name}</p>
                <p className="text-xs text-[var(--text-tertiary)]">{selectedClient.email}</p>
              </div>
              <Badge variant="status" status="active" size="sm">{t('requests.autoLinked')}</Badge>
            </div>
          ) : (
            <div className="space-y-3">
              <SearchInput
                value={clientSearch}
                onChange={setClientSearch}
                placeholder={t('requests.searchClient')}
              />
              <div className="max-h-48 overflow-y-auto space-y-1">
                {filteredClients.map(client => (
                  <button
                    key={client.id}
                    onClick={() => setClientId(client.id)}
                    className={cn(
                      'w-full text-start p-3 rounded-lg border transition-all flex items-center gap-3',
                      clientId === client.id
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-950/30'
                        : 'border-[var(--border-primary)] hover:border-[var(--border-secondary)] bg-[var(--bg-primary)]'
                    )}
                  >
                    <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-bold shrink-0">
                      {client.name.split(' ').map(n => n[0]).join('')}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{client.name}</p>
                      <p className="text-xs text-[var(--text-tertiary)]">{client.email}</p>
                    </div>
                    {clientId === client.id && (
                      <div className="w-5 h-5 rounded-full bg-primary-600 flex items-center justify-center shrink-0">
                        <Check className="w-3 h-3 text-white" />
                      </div>
                    )}
                  </button>
                ))}
                {filteredClients.length === 0 && (
                  <p className="text-sm text-[var(--text-tertiary)] text-center py-4">{t('common.noResults')}</p>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Title & Description */}
      <Card>
        <CardHeader title={t('requests.details')} />
        <CardContent>
          <div className="space-y-4">
            <Input
              label={t('requests.requestTitle')}
              placeholder={t('requests.requestTitlePlaceholder')}
              value={title}
              onChange={e => setTitle(e.target.value)}
              required
            />
            <Textarea
              label={t('requests.description')}
              placeholder={t('requests.descriptionPlaceholder')}
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
            />
            <Input
              label={t('requests.deadline')}
              type="date"
              value={deadline}
              onChange={e => setDeadline(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Document Selection */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">{t('requests.requiredDocuments')}</h3>
              <p className="text-xs text-[var(--text-tertiary)] mt-0.5">{t('requests.requiredDocumentsDesc')}</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowNewDocTypeModal(true)}
              icon={<Plus className="w-3.5 h-3.5" />}
            >
              {t('requests.quickAddDocType')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {allPresets.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap mb-4">
              <span className="text-xs font-medium text-[var(--text-tertiary)] flex items-center gap-1">
                <Package className="w-3 h-3" />{t('documentTypes.presets')}:
              </span>
              {allPresets.map(p => (
                <button
                  key={p.id}
                  onClick={() => applyPreset(p.id)}
                  className="text-xs px-3 py-1 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] rounded-full transition-colors font-medium"
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}

          <div className="flex gap-2 flex-wrap mb-3">
            <SearchInput
              value={docSearch}
              onChange={setDocSearch}
              placeholder={t('requests.searchDocTypes')}
              className="flex-1 min-w-[200px]"
            />
            <div className="flex gap-1 flex-wrap">
              <button
                onClick={() => setDocCategory('all')}
                className={cn(
                  'text-xs px-2.5 py-1.5 rounded-lg transition-colors',
                  docCategory === 'all' ? 'bg-primary-600 text-white' : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
                )}
              >
                {t('common.all')}
              </button>
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setDocCategory(cat)}
                  className={cn(
                    'text-xs px-2.5 py-1.5 rounded-lg transition-colors capitalize',
                    docCategory === cat ? 'bg-primary-600 text-white' : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
                  )}
                >
                  {t(getDocCategoryKey(cat))}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {filteredDocs.map(doc => {
                  const isSelected = selectedDocs.some(d => d.id === doc.id)
                  return (
                    <button
                      key={doc.id}
                      onClick={() => toggleDoc(doc)}
                      className={cn(
                        'text-start p-3 rounded-lg border-2 transition-all',
                        isSelected
                          ? 'border-primary-500 bg-primary-50 dark:bg-primary-950/30'
                          : 'border-[var(--border-primary)] hover:border-[var(--border-secondary)]'
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <div className={cn(
                          'w-5 h-5 rounded border-2 flex items-center justify-center mt-0.5 shrink-0 transition-colors',
                          isSelected ? 'border-primary-500 bg-primary-600' : 'border-[var(--border-secondary)]'
                        )}>
                          {isSelected && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{doc.name}</p>
                          {doc.description && (
                            <p className="text-xs text-[var(--text-tertiary)] mt-0.5 truncate">{doc.description}</p>
                          )}
                          <span className="text-[10px] px-1.5 py-0.5 bg-[var(--bg-tertiary)] rounded capitalize mt-1 inline-block">
                            {t(getDocCategoryKey(doc.category))}
                          </span>
                        </div>
                      </div>
                    </button>
                  )
                })}
                {filteredDocs.length === 0 && (
                  <div className="col-span-2 text-center py-8">
                    <p className="text-sm text-[var(--text-tertiary)]">{t('common.noResults')}</p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-2"
                      onClick={() => setShowNewDocTypeModal(true)}
                      icon={<Plus className="w-3.5 h-3.5" />}
                    >
                      {t('requests.quickAddDocType')}
                    </Button>
                  </div>
                )}
              </div>
            </div>

            <div>
              <div className="sticky top-4">
                <div className="p-4 border border-[var(--border-primary)] rounded-xl bg-[var(--bg-primary)]">
                  <h4 className="text-sm font-semibold mb-3">
                    {t('requests.selected')} ({selectedDocs.length})
                  </h4>
                  {selectedDocs.length === 0 ? (
                    <p className="text-xs text-[var(--text-tertiary)] text-center py-4">{t('cases.noDocsSelected')}</p>
                  ) : (
                    <div className="space-y-2">
                      {selectedDocs.map(doc => (
                        <div key={doc.id} className="flex items-center justify-between p-2 bg-[var(--bg-tertiary)] rounded-lg text-xs">
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="w-3.5 h-3.5 text-primary-500 shrink-0" />
                            <span className="truncate">{doc.name}</span>
                          </div>
                          <button onClick={() => toggleDoc(doc)} className="text-[var(--text-tertiary)] hover:text-red-500 p-0.5">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Action buttons */}
      <div className="flex items-center justify-between pt-2 pb-8">
        <Button
          variant="ghost"
          onClick={() => navigate(isClientPreselected ? `/clients/${clientId}` : '/requests')}
          icon={<BackArrow className="w-4 h-4" />}
        >
          {t('common.cancel')}
        </Button>
        <Button
          onClick={handleCreate}
          disabled={!canSave || saving}
          loading={saving}
          icon={<Check className="w-4 h-4" />}
        >
          {saving ? t('common.loading') : t('requests.createRequest')}
        </Button>
      </div>

      {/* ---- Inline Document Type Creation Modal ---- */}
      <Modal
        open={showNewDocTypeModal}
        onClose={() => { setShowNewDocTypeModal(false); setNewDocTypeError('') }}
        title={t('requests.quickAddDocType')}
        size="sm"
      >
        <div className="p-6 space-y-4">
          {newDocTypeError && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
              {newDocTypeError}
            </div>
          )}
          <Input
            label={t('documentTypes.name')}
            placeholder={t('settings.docTypeNamePlaceholder')}
            value={newDocTypeName}
            onChange={e => setNewDocTypeName(e.target.value)}
            required
          />
          <Select
            label={t('documentTypes.category')}
            value={newDocTypeCategory}
            onChange={e => setNewDocTypeCategory(e.target.value)}
            options={DOC_CATEGORIES}
          />
          <Textarea
            label={t('documentTypes.description')}
            placeholder={t('settings.docTypeDescPlaceholder')}
            value={newDocTypeDescription}
            onChange={e => setNewDocTypeDescription(e.target.value)}
            rows={2}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => { setShowNewDocTypeModal(false); setNewDocTypeError('') }}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleCreateDocType}
              loading={newDocTypeSaving}
              icon={<Plus className="w-4 h-4" />}
            >
              {t('requests.addAndSelect')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
