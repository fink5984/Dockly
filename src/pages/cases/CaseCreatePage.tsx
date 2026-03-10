import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '@/contexts/I18nContext'
import { Card, CardHeader, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea, SearchInput } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { cn, generateId, getDocCategoryKey } from '@/lib/utils'
import { useSupabaseData } from '@/hooks/useSupabaseData'
import { getClients } from '@/services/clientsService'
import { getDocumentTypes, getDocumentPresets } from '@/services/documentsService'
import { getCaseTypeConfigs } from '@/services/settingsService'
import { Check, FileText, ArrowRight, ArrowLeft, X, Plus, Info, Search, Package, Star } from 'lucide-react'
import type { DocumentType, CaseTypeConfig } from '@/types'

type Step = 'client' | 'type' | 'documents' | 'review'

export function CaseCreatePage() {
  const { t, direction } = useI18n()
  const navigate = useNavigate()

  const { data: allClients } = useSupabaseData(getClients, [])
  const { data: allDocumentTypes } = useSupabaseData(getDocumentTypes, [])
  const { data: allCaseTypeConfigs } = useSupabaseData(getCaseTypeConfigs, [])
  const { data: allPresets } = useSupabaseData(getDocumentPresets, [])

  const [step, setStep] = useState<Step>('client')
  const [selectedClientId, setSelectedClientId] = useState('')
  const [selectedCaseType, setSelectedCaseType] = useState('')
  const [selectedDocs, setSelectedDocs] = useState<DocumentType[]>([])
  const [caseNotes, setCaseNotes] = useState('')
  const [deadline, setDeadline] = useState('')
  const [docSearch, setDocSearch] = useState('')
  const [docCategory, setDocCategory] = useState<string>('all')

  const steps: { key: Step; label: string }[] = [
    { key: 'client', label: t('cases.selectClient') },
    { key: 'type', label: t('cases.selectType') },
    { key: 'documents', label: t('cases.selectDocuments') },
    { key: 'review', label: t('cases.reviewAndCreate') },
  ]

  const currentIndex = steps.findIndex(s => s.key === step)
  const ArrowForward = direction === 'rtl' ? ArrowLeft : ArrowRight
  const ArrowBack = direction === 'rtl' ? ArrowRight : ArrowLeft

  const applyPreset = (presetId: string) => {
    const preset = allPresets.find(p => p.id === presetId)
    if (!preset) return
    const docs = allDocumentTypes.filter(dt => preset.documentTypeIds.includes(dt.id))
    setSelectedDocs(docs)
  }

  const applyCaseTypeDefaults = (ct: CaseTypeConfig) => {
    const docs = allDocumentTypes.filter(dt => ct.defaultDocumentTypeIds.includes(dt.id))
    setSelectedDocs(docs)
    setSelectedCaseType(ct.id)
  }

  const toggleDoc = (doc: DocumentType) => {
    setSelectedDocs(prev => prev.some(d => d.id === doc.id) ? prev.filter(d => d.id !== doc.id) : [...prev, doc])
  }

  const categories = Array.from(new Set(allDocumentTypes.map(d => d.category)))

  const filteredDocs = allDocumentTypes.filter(d => {
    if (docCategory !== 'all' && d.category !== docCategory) return false
    if (docSearch && !d.name.toLowerCase().includes(docSearch.toLowerCase())) return false
    return true
  })

  const selectedClient = allClients.find(c => c.id === selectedClientId)
  const selectedConfig = allCaseTypeConfigs.find(ct => ct.id === selectedCaseType)

  const canProceed = () => {
    if (step === 'client') return !!selectedClientId
    if (step === 'type') return !!selectedCaseType
    if (step === 'documents') return selectedDocs.length > 0
    return true
  }

  const handleCreate = () => {
    navigate('/cases')
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('cases.createCase')}</h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">{t('cases.createCaseDesc')}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => navigate('/cases')}><X className="w-4 h-4" /></Button>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-0">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center flex-1 last:flex-none">
            <div className="flex items-center gap-2">
              <div className={cn(
                'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors',
                i < currentIndex ? 'bg-green-500 text-white' : i === currentIndex ? 'bg-primary-600 text-white' : 'bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]'
              )}>
                {i < currentIndex ? <Check className="w-3.5 h-3.5" /> : i + 1}
              </div>
              <span className={cn('text-xs font-medium hidden sm:block', i === currentIndex ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]')}>
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && <div className={cn('h-0.5 flex-1 mx-3 rounded', i < currentIndex ? 'bg-green-500' : 'bg-[var(--border-primary)]')} />}
          </div>
        ))}
      </div>

      {/* Step content */}
      {step === 'client' && (
        <Card>
          <CardHeader title={t('cases.selectClient')} description={t('cases.selectClientDesc')} />
          <CardContent>
            <div className="space-y-3">
              {allClients.map(client => (
                <button
                  key={client.id}
                  onClick={() => setSelectedClientId(client.id)}
                  className={cn(
                    'w-full text-start p-4 rounded-xl border-2 transition-all',
                    selectedClientId === client.id
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-950/30'
                      : 'border-[var(--border-primary)] hover:border-[var(--border-secondary)] bg-[var(--bg-primary)]'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">{client.fullName}</p>
                      <p className="text-xs text-[var(--text-tertiary)]">{client.email}</p>
                    </div>
                    {selectedClientId === client.id && (
                      <div className="w-5 h-5 rounded-full bg-primary-600 flex items-center justify-center">
                        <Check className="w-3 h-3 text-white" />
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'type' && (
        <Card>
          <CardHeader title={t('cases.selectType')} description={t('cases.selectTypeDesc')} />
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {allCaseTypeConfigs.map(ct => (
                <button
                  key={ct.id}
                  onClick={() => applyCaseTypeDefaults(ct)}
                  className={cn(
                    'text-start p-4 rounded-xl border-2 transition-all',
                    selectedCaseType === ct.id
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-950/30'
                      : 'border-[var(--border-primary)] hover:border-[var(--border-secondary)] bg-[var(--bg-primary)]'
                  )}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-sm">{ct.name}</p>
                      <p className="text-xs text-[var(--text-tertiary)] mt-1">{ct.defaultDocumentTypeIds.length} {t('documents.documentsLabel').toLowerCase()}</p>
                    </div>
                    {selectedCaseType === ct.id && (
                      <div className="w-5 h-5 rounded-full bg-primary-600 flex items-center justify-center">
                        <Check className="w-3 h-3 text-white" />
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'documents' && (
        <div className="space-y-4">
          {/* Presets */}
          <Card>
            <CardContent className="py-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium text-[var(--text-tertiary)] flex items-center gap-1"><Package className="w-3 h-3" />{t('documentTypes.presets')}:</span>
                {allPresets.map(p => (
                  <button key={p.id} onClick={() => applyPreset(p.id)} className="text-xs px-3 py-1 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] rounded-full transition-colors font-medium">
                    {p.name}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Document browser */}
            <div className="lg:col-span-2 space-y-3">
              <div className="flex gap-2 flex-wrap">
                <SearchInput value={docSearch} onChange={setDocSearch} placeholder={t('common.search')} className="flex-1 min-w-[200px]" />
                <div className="flex gap-1 flex-wrap">
                  <button onClick={() => setDocCategory('all')} className={cn('text-xs px-2.5 py-1.5 rounded-lg transition-colors', docCategory === 'all' ? 'bg-primary-600 text-white' : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]')}>
                    {t('common.all')}
                  </button>
                  {categories.map(cat => (
                    <button key={cat} onClick={() => setDocCategory(cat)} className={cn('text-xs px-2.5 py-1.5 rounded-lg transition-colors capitalize', docCategory === cat ? 'bg-primary-600 text-white' : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]')}>
                      {t(getDocCategoryKey(cat))}
                    </button>
                  ))}
                </div>
              </div>

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
                        <div className={cn('w-5 h-5 rounded border-2 flex items-center justify-center mt-0.5 shrink-0 transition-colors', isSelected ? 'border-primary-500 bg-primary-600' : 'border-[var(--border-secondary)]')}>
                          {isSelected && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{doc.name}</p>
                          {doc.description && <p className="text-xs text-[var(--text-tertiary)] mt-0.5 truncate">{doc.description}</p>}
                          <div className="flex items-center gap-1.5 mt-1">
                            <span className="text-[10px] px-1.5 py-0.5 bg-[var(--bg-tertiary)] rounded capitalize">{t(getDocCategoryKey(doc.category))}</span>
                            {doc.isRequired && <Badge variant="status" status="info" size="sm">{t('documentTypes.required')}</Badge>}
                          </div>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Selected panel */}
            <div>
              <Card>
                <CardHeader title={`${t('cases.selectedDocuments')} (${selectedDocs.length})`} />
                <CardContent>
                  {selectedDocs.length === 0 ? (
                    <p className="text-xs text-[var(--text-tertiary)] text-center py-6">{t('cases.noDocsSelected')}</p>
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
                </CardContent>
              </Card>

              <div className="mt-3 space-y-3">
                <Input label={t('cases.deadline')} type="date" value={deadline} onChange={e => setDeadline(e.target.value)} />
                <Textarea label={t('cases.caseNotes')} value={caseNotes} onChange={e => setCaseNotes(e.target.value)} rows={3} placeholder={t('cases.caseNotesPlaceholder')} />
              </div>
            </div>
          </div>
        </div>
      )}

      {step === 'review' && (
        <Card>
          <CardHeader title={t('cases.reviewAndCreate')} />
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-3 bg-[var(--bg-tertiary)] rounded-lg">
                  <p className="text-xs text-[var(--text-tertiary)] mb-1">{t('cases.client')}</p>
                  <p className="text-sm font-medium">{selectedClient?.fullName}</p>
                  <p className="text-xs text-[var(--text-tertiary)]">{selectedClient?.email}</p>
                </div>
                <div className="p-3 bg-[var(--bg-tertiary)] rounded-lg">
                  <p className="text-xs text-[var(--text-tertiary)] mb-1">{t('cases.caseType')}</p>
                  <p className="text-sm font-medium">{selectedConfig ? selectedConfig.name : '-'}</p>
                </div>
              </div>

              <div className="p-3 bg-[var(--bg-tertiary)] rounded-lg">
                <p className="text-xs text-[var(--text-tertiary)] mb-2">{t('cases.requiredDocuments')} ({selectedDocs.length})</p>
                <div className="flex flex-wrap gap-1.5">
                  {selectedDocs.map(d => (
                    <span key={d.id} className="text-xs px-2 py-1 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg">{d.name}</span>
                  ))}
                </div>
              </div>

              {deadline && (
                <div className="p-3 bg-[var(--bg-tertiary)] rounded-lg">
                  <p className="text-xs text-[var(--text-tertiary)] mb-1">{t('cases.deadline')}</p>
                  <p className="text-sm font-medium">{deadline}</p>
                </div>
              )}

              {caseNotes && (
                <div className="p-3 bg-[var(--bg-tertiary)] rounded-lg">
                  <p className="text-xs text-[var(--text-tertiary)] mb-1">{t('cases.caseNotes')}</p>
                  <p className="text-sm">{caseNotes}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between pt-2">
        <Button
          variant="ghost"
          onClick={() => currentIndex > 0 && setStep(steps[currentIndex - 1].key)}
          disabled={currentIndex === 0}
          icon={<ArrowBack className="w-4 h-4" />}
        >
          {t('common.back')}
        </Button>

        {step === 'review' ? (
          <Button onClick={handleCreate} icon={<Check className="w-4 h-4" />}>{t('cases.createCase')}</Button>
        ) : (
          <Button onClick={() => setStep(steps[currentIndex + 1].key)} disabled={!canProceed()} icon={<ArrowForward className="w-4 h-4" />} iconPosition="end">
            {t('common.next')}
          </Button>
        )}
      </div>
    </div>
  )
}
