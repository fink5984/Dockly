import { useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useI18n } from '@/contexts/I18nContext'
import { useAuth } from '@/contexts/AuthContext'
import { useApp } from '@/contexts/AppContext'
import { Card, CardHeader, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { useRealtimeData } from '@/hooks/useRealtimeData'
import { getClients } from '@/services/clientsService'
import { createSignatureRequest, addSignatureDocument } from '@/services/signaturesService'
import {
  ArrowLeft, ArrowRight, UploadCloud, FileText, PenLine, Calendar, User,
  Type, Hash, CheckSquare, Plus, Trash2, Loader2, GripVertical,
  ChevronLeft, ChevronRight, X
} from 'lucide-react'
import type { SignatureFieldType, Client } from '@/types'
import { PDFDocument } from 'pdf-lib'
import { PdfPageCanvas } from '@/components/PdfPageCanvas'

interface FieldDef {
  id: string
  type: SignatureFieldType
  label: string
  docIndex: number
  page: number
  x: number
  y: number
  width: number
  height: number
  required: boolean
  sortOrder: number
}

const fieldTypeConfig: Record<SignatureFieldType, { icon: typeof PenLine; color: string; defaultW: number; defaultH: number }> = {
  signature: { icon: PenLine, color: 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20', defaultW: 200, defaultH: 60 },
  date: { icon: Calendar, color: 'border-blue-500 bg-blue-50 dark:bg-blue-900/20', defaultW: 140, defaultH: 32 },
  name: { icon: User, color: 'border-green-500 bg-green-50 dark:bg-green-900/20', defaultW: 180, defaultH: 32 },
  text: { icon: Type, color: 'border-amber-500 bg-amber-50 dark:bg-amber-900/20', defaultW: 200, defaultH: 32 },
  initials: { icon: Hash, color: 'border-purple-500 bg-purple-50 dark:bg-purple-900/20', defaultW: 80, defaultH: 40 },
  checkbox: { icon: CheckSquare, color: 'border-rose-500 bg-rose-50 dark:bg-rose-900/20', defaultW: 24, defaultH: 24 },
}

const fieldTypeLabels: Record<SignatureFieldType, string> = {
  signature: 'signatures.typeSignature',
  date: 'signatures.typeDate',
  name: 'signatures.typeName',
  text: 'signatures.typeText',
  initials: 'signatures.typeInitials',
  checkbox: 'signatures.typeCheckbox',
}

export function SignatureCreatePage() {
  const { t, direction } = useI18n()
  const navigate = useNavigate()
  const { user, workspace } = useAuth()
  const { addToast } = useApp()
  const wsId = workspace?.id || user?.workspaceId || ''
  const isRtl = direction === 'rtl'
  const BackIcon = isRtl ? ArrowRight : ArrowLeft
  const [searchParams] = useSearchParams()
  const prefillClientId = searchParams.get('clientId') || ''

  // Form state
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [clientId, setClientId] = useState(prefillClientId)
  const [clientSearch, setClientSearch] = useState('')
  const [showClientDropdown, setShowClientDropdown] = useState(false)
  const [expiresAt, setExpiresAt] = useState('')

  // Documents state – every uploaded PDF is equal
  const [documents, setDocuments] = useState<{ file: File; url: string; pageCount: number }[]>([])
  const [activeDocIndex, setActiveDocIndex] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerScrollRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<(HTMLDivElement | null)[]>([])
  const [viewerHeight, setViewerHeight] = useState(0)
  const [viewerWidth, setViewerWidth] = useState(0)
  const [renderedDims, setRenderedDims] = useState({ width: 0, height: 0 })
  const [isDraggingFromPalette, setIsDraggingFromPalette] = useState(false)

  // Fields
  const [fields, setFields] = useState<FieldDef[]>([])
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null)
  const [draggingField, setDraggingField] = useState<string | null>(null)

  // Submit
  const [submitting, setSubmitting] = useState(false)
  const [step, setStep] = useState<1 | 2 | 3>(1)

  // Clients & cases lists
  const { data: clients } = useRealtimeData(
    () => getClients(wsId),
    [],
    [wsId],
    { tables: ['clients'] }
  )

  const selectedClient = clients.find(c => c.id === clientId)
  const filteredClients = clients.filter(c =>
    !clientSearch || c.name.toLowerCase().includes(clientSearch.toLowerCase()) || c.email.toLowerCase().includes(clientSearch.toLowerCase())
  )

  // Handle PDF file selection – accepts multiple files
  const handleFilesSelect = useCallback(async (fileList: FileList | File[]) => {
    const newDocs: { file: File; url: string; pageCount: number }[] = []
    for (const file of Array.from(fileList)) {
      if (file.type !== 'application/pdf') {
        addToast({ title: t('signatures.pdfOnly'), type: 'error' })
        continue
      }
      if (file.size > 20 * 1024 * 1024) {
        addToast({ title: 'File too large (max 20MB)', type: 'error' })
        continue
      }
      try {
        const buf = await file.arrayBuffer()
        const pdfDoc = await PDFDocument.load(buf, { ignoreEncryption: true })
        newDocs.push({ file, url: URL.createObjectURL(file), pageCount: pdfDoc.getPageCount() })
      } catch {
        addToast({ title: 'Failed to read PDF', type: 'error' })
      }
    }
    if (newDocs.length) {
      setDocuments(prev => [...prev, ...newDocs])
    }
  }, [addToast, t])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer.files.length) handleFilesSelect(e.dataTransfer.files)
  }, [handleFilesSelect])

  // Cleanup dragend listener for palette drag state
  useEffect(() => {
    const end = () => setIsDraggingFromPalette(false)
    document.addEventListener('dragend', end)
    return () => document.removeEventListener('dragend', end)
  }, [])

  // Handle dropping a field type from the palette onto the document
  const handleFieldDrop = useCallback((e: React.DragEvent<HTMLDivElement>, pageNum?: number) => {
    e.preventDefault()
    setIsDraggingFromPalette(false)
    const fieldType = e.dataTransfer.getData('fieldType') as SignatureFieldType
    if (!fieldType || documents.length === 0) return

    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const fc = fieldTypeConfig[fieldType]
    const newField: FieldDef = {
      id: crypto.randomUUID(),
      type: fieldType,
      label: t(fieldTypeLabels[fieldType]),
      docIndex: activeDocIndex,
      page: pageNum ?? currentPage,
      x: Math.max(0, x - fc.defaultW / 2),
      y: Math.max(0, y - fc.defaultH / 2),
      width: fc.defaultW,
      height: fc.defaultH,
      required: true,
      sortOrder: fields.length,
    }
    setFields(prev => [...prev, newField])
    setSelectedFieldId(newField.id)
  }, [documents.length, activeDocIndex, currentPage, fields.length, t])

  const removeField = (id: string) => {
    setFields(prev => prev.filter(f => f.id !== id))
    if (selectedFieldId === id) setSelectedFieldId(null)
  }

  const updateField = (id: string, updates: Partial<FieldDef>) => {
    setFields(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f))
  }

  // Field dragging on the canvas
  const handleFieldMouseDown = (e: React.MouseEvent, fieldId: string) => {
    e.stopPropagation()
    setSelectedFieldId(fieldId)
    setDraggingField(fieldId)

    const startX = e.clientX
    const startY = e.clientY
    const field = fields.find(f => f.id === fieldId)!
    const startFieldX = field.x
    const startFieldY = field.y

    const handleMouseMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      updateField(fieldId, {
        x: Math.max(0, startFieldX + dx),
        y: Math.max(0, startFieldY + dy),
      })
    }

    const handleMouseUp = () => {
      setDraggingField(null)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  // Submit handler
  const handleSubmit = async () => {
    if (!clientId || !title || documents.length === 0) return
    setSubmitting(true)

    try {
      const mainDoc = documents[0]
      // 1. Upload main PDF to storage
      const safeName = mainDoc.file.name.replace(/[^\w.\-]/g, '_')
      const storagePath = `signatures/${wsId}/${Date.now()}_${safeName}`
      const { error: uploadErr } = await supabase.storage
        .from('documents')
        .upload(storagePath, mainDoc.file)

      if (uploadErr) throw uploadErr

      // Capture the actual canvas width for accurate PDF coordinate mapping
      const canvasWidth = renderedDims.width || containerRef.current?.getBoundingClientRect().width || 700

      // 2. Create signature request with first doc as primary
      const created = await createSignatureRequest(wsId, {
        clientId,
        title,
        description: description || undefined,
        documentFileName: mainDoc.file.name,
        documentStoragePath: storagePath,
        documentFileType: mainDoc.file.type,
        documentFileSize: mainDoc.file.size,
        canvasWidth: Math.round(canvasWidth),
        fields: fields.map((f, i) => ({
          type: f.type,
          label: f.label,
          page: f.page,
          x: f.x,
          y: f.y,
          width: f.width,
          height: f.height,
          required: f.required,
          sortOrder: i,
          docIndex: f.docIndex,
        })),
        expiresAt: expiresAt || undefined,
        createdBy: user?.id || '',
      })

      // 3. Upload additional documents
      for (let i = 1; i < documents.length; i++) {
        const doc = documents[i]
        const dn = doc.file.name.replace(/[^\w.\-]/g, '_')
        const dp = `signatures/${wsId}/${created.id}/${Date.now()}_${dn}`
        await supabase.storage.from('documents').upload(dp, doc.file)
        await addSignatureDocument(created.id, {
          fileName: doc.file.name,
          storagePath: dp,
          fileType: doc.file.type,
          fileSize: doc.file.size,
          sortOrder: i,
        })
      }

      addToast({ title: t('signatures.createRequest'), type: 'success' })
      navigate('/signatures')
    } catch (err) {
      console.error('Failed to create signature request:', err)
      addToast({ title: t('common.error'), type: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  const activeDoc = documents[activeDocIndex]
  const activeNumPages = activeDoc?.pageCount ?? 1
  const canProceedStep1 = !!clientId && !!title
  const canProceedStep2 = documents.length > 0
  const canSubmit = canProceedStep1 && canProceedStep2 && fields.length > 0

  const currentDocFields = fields.filter(f => f.docIndex === activeDocIndex && f.page === currentPage)

  // Track viewer container dimensions for contain-fit scaling
  useEffect(() => {
    const el = viewerScrollRef.current
    if (!el || step !== 3) return
    const measure = () => {
      const h = el.clientHeight
      const w = el.clientWidth
      if (h > 0) setViewerHeight(h)
      if (w > 0) setViewerWidth(w)
    }
    measure()
    const obs = new ResizeObserver(() => measure())
    obs.observe(el)
    return () => obs.disconnect()
  }, [step])

  // Track visible page via scroll position (use getBoundingClientRect for accuracy)
  useEffect(() => {
    const scrollEl = viewerScrollRef.current
    if (!scrollEl || step !== 3) return
    const totalPages = documents[activeDocIndex]?.pageCount ?? 1

    const handleScroll = () => {
      const containerRect = scrollEl.getBoundingClientRect()
      const threshold = containerRect.top + containerRect.height * 0.4
      let page = 1
      for (let i = 0; i < totalPages; i++) {
        const el = pageRefs.current[i]
        if (!el) continue
        const rect = el.getBoundingClientRect()
        if (rect.top <= threshold) page = i + 1
      }
      setCurrentPage(page)
    }
    scrollEl.addEventListener('scroll', handleScroll, { passive: true })
    // Also run after a short delay to let pages render
    handleScroll()
    const timer = setTimeout(handleScroll, 300)
    return () => { scrollEl.removeEventListener('scroll', handleScroll); clearTimeout(timer) }
  }, [step, activeDocIndex, documents, viewerHeight])

  const scrollToPage = useCallback((pageNum: number) => {
    const el = pageRefs.current[pageNum - 1]
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  // Step 3: Continuous-scroll all-pages layout
  if (step === 3) {
    const totalPages = activeDoc?.pageCount ?? 1
    return (
      <div className="-m-4 lg:-m-6 flex flex-col" style={{ height: 'calc(100vh - 52px)' }}>
        {/* Header */}
        <div className="px-4 lg:px-6 pt-4 lg:pt-5 pb-3 shrink-0 space-y-3">
          <div className="flex items-center gap-3">
            <button onClick={() => setStep(2)} className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)]">
              <BackIcon className="w-5 h-5" />
            </button>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold">{t('signatures.defineFields')}</h1>
              <p className="text-xs text-[var(--text-tertiary)]">{t('signatures.dragToPlace')}</p>
            </div>
            <Button
              onClick={handleSubmit}
              disabled={!canSubmit || submitting}
              icon={submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <PenLine className="w-4 h-4" />}
            >
              {t('signatures.create')}
            </Button>
          </div>

          {/* Document tabs */}
          {documents.length > 1 && (
            <div className="flex gap-1 overflow-x-auto">
              {documents.map((doc, idx) => (
                <button
                  key={idx}
                  onClick={() => { setActiveDocIndex(idx); setCurrentPage(1) }}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors',
                    activeDocIndex === idx
                      ? 'bg-indigo-600 text-white'
                      : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]'
                  )}
                >
                  {doc.file.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Main content: palette + viewer */}
        <div className="flex gap-4 px-4 lg:px-6 pb-4 lg:pb-6 flex-1 min-h-0">
          {/* Field palette card */}
          <Card className="w-56 shrink-0 hidden md:flex md:flex-col overflow-hidden">
            <CardHeader title={t('signatures.fields')} />
            <CardContent className="space-y-4 overflow-y-auto flex-1 min-h-0">
              {/* Draggable field types */}
              <div className="space-y-1.5">
                {(Object.keys(fieldTypeConfig) as SignatureFieldType[]).map(type => {
                  const cfg = fieldTypeConfig[type]
                  const Icon = cfg.icon
                  return (
                    <div
                      key={type}
                      draggable
                      onDragStart={e => {
                        e.dataTransfer.setData('fieldType', type)
                        e.dataTransfer.effectAllowed = 'copy'
                        setIsDraggingFromPalette(true)
                      }}
                      className={cn(
                        'flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border cursor-grab active:cursor-grabbing transition-colors select-none',
                        cfg.color
                      )}
                    >
                      <GripVertical className="w-3 h-3 opacity-40" />
                      <Icon className="w-4 h-4" />
                      {t(fieldTypeLabels[type])}
                    </div>
                  )
                })}
              </div>

              {/* Placed fields */}
              {fields.length > 0 && (
                <div>
                  <p className="text-xs font-bold mb-2">{t('signatures.fields')} ({fields.length})</p>
                  <div className="space-y-1.5">
                    {fields.map(field => {
                      const cfg = fieldTypeConfig[field.type]
                      const Icon = cfg.icon
                      return (
                        <div
                          key={field.id}
                          className={cn(
                            'flex items-center gap-1.5 p-1.5 rounded-lg border text-xs cursor-pointer',
                            selectedFieldId === field.id ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20' : 'border-[var(--border-primary)]'
                          )}
                          onClick={() => {
                            setSelectedFieldId(field.id)
                            setActiveDocIndex(field.docIndex)
                            setCurrentPage(field.page)
                            scrollToPage(field.page)
                          }}
                        >
                          <Icon className="w-3 h-3 shrink-0" />
                          <input
                            value={field.label}
                            onChange={e => updateField(field.id, { label: e.target.value })}
                            className="flex-1 bg-transparent border-none text-[11px] focus:outline-none min-w-0"
                            onClick={e => e.stopPropagation()}
                          />
                          <button
                            onClick={e => { e.stopPropagation(); removeField(field.id) }}
                            className="p-0.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded shrink-0"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Document viewer card */}
          <Card className="flex-1 min-w-0 flex flex-col overflow-hidden">
              {/* Page navigation header */}
              <CardHeader>
                <div className="flex items-center justify-center gap-3">
                  <button
                    onClick={() => scrollToPage(currentPage - 1)}
                    disabled={currentPage <= 1}
                    className="p-1 rounded hover:bg-[var(--bg-tertiary)] disabled:opacity-30"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-xs font-medium min-w-[80px] text-center">
                    {t('signatures.page')} {currentPage} / {totalPages}
                  </span>
                  <button
                    onClick={() => scrollToPage(currentPage + 1)}
                    disabled={currentPage >= totalPages}
                    className="p-1 rounded hover:bg-[var(--bg-tertiary)] disabled:opacity-30"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </CardHeader>

              {/* All pages – smooth continuous scroll */}
              <div
                ref={viewerScrollRef}
                className="flex-1 min-h-0 overflow-auto bg-[var(--bg-secondary)] rounded-b-xl"
                style={{ scrollBehavior: 'smooth' }}
              >
                <div className="flex flex-col items-center gap-8 py-4">
                {activeDoc && Array.from({ length: totalPages }, (_, i) => {
                  const pageNum = i + 1
                  const pageFields = fields.filter(f => f.docIndex === activeDocIndex && f.page === pageNum)
                  return (
                    <div
                      key={pageNum}
                      ref={el => {
                        pageRefs.current[i] = el
                        if (pageNum === 1) containerRef.current = el
                      }}
                      className="relative w-full shadow-md"
                      onDrop={e => handleFieldDrop(e, pageNum)}
                      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
                    >
                        <PdfPageCanvas
                          src={activeDoc.url}
                          page={pageNum}
                          className="w-full"
                          onRender={dims => setRenderedDims(dims)}
                        />
                        {/* Drop overlay */}
                        {isDraggingFromPalette && (
                          <div className="absolute inset-0 bg-indigo-500/5 border-2 border-dashed border-indigo-400 rounded pointer-events-none" />
                        )}
                        {/* Field overlay */}
                        <div className="absolute inset-0" style={{ pointerEvents: 'none' }}>
                          {pageFields.map(field => {
                            const cfg = fieldTypeConfig[field.type]
                            const Icon = cfg.icon
                            return (
                              <div
                                key={field.id}
                                className={cn(
                                  'absolute border-2 rounded flex items-center justify-center cursor-move transition-shadow',
                                  cfg.color,
                                  selectedFieldId === field.id && 'ring-2 ring-indigo-500 shadow-lg',
                                  draggingField === field.id && 'opacity-80'
                                )}
                                style={{
                                  left: field.x,
                                  top: field.y,
                                  width: field.width,
                                  height: field.height,
                                  pointerEvents: 'auto',
                                }}
                                onMouseDown={e => handleFieldMouseDown(e, field.id)}
                                onClick={e => { e.stopPropagation(); setSelectedFieldId(field.id) }}
                              >
                                <Icon className="w-4 h-4 opacity-50" />
                                <span className="text-[10px] ms-1 truncate opacity-70">{field.label}</span>
                                <button
                                  className="absolute -top-2 -end-2 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600"
                                  onMouseDown={e => e.stopPropagation()}
                                  onClick={e => { e.stopPropagation(); removeField(field.id) }}
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/signatures')} className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)]">
          <BackIcon className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold">{t('signatures.createRequest')}</h1>
          <p className="text-sm text-[var(--text-tertiary)]">{t('signatures.createRequestDesc')}</p>
        </div>
      </div>

      {/* Steps indicator */}
      <div className="flex items-center gap-2">
        {[1, 2, 3].map(s => (
          <div key={s} className="flex items-center gap-2">
            <div className={cn(
              'w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors',
              step >= s
                ? 'bg-indigo-600 text-white'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]'
            )}>
              {s}
            </div>
            {s < 3 && <div className={cn('w-12 h-0.5', step > s ? 'bg-indigo-600' : 'bg-[var(--border-primary)]')} />}
          </div>
        ))}
      </div>

      {/* Step 1: Client & Details */}
      {step === 1 && (
        <div className="space-y-4">
          <Card>
            <CardHeader title={t('signatures.selectClient')} />
            <CardContent className="space-y-4">
              {/* Client selector */}
              <div className="relative">
                <label className="block text-sm font-medium mb-1">{t('signatures.client')}</label>
                {selectedClient ? (
                  <div className="flex items-center gap-2 p-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)]">
                    <User className="w-4 h-4 text-indigo-500" />
                    <span className="font-medium text-sm">{selectedClient.name}</span>
                    <span className="text-xs text-[var(--text-tertiary)]">{selectedClient.email}</span>
                    <button onClick={() => { setClientId('') }} className="ms-auto text-[var(--text-tertiary)] hover:text-red-500">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div>
                    <Input
                      value={clientSearch}
                      onChange={e => { setClientSearch(e.target.value); setShowClientDropdown(true) }}
                      onFocus={() => setShowClientDropdown(true)}
                      placeholder={t('signatures.searchClient')}
                    />
                    {showClientDropdown && (
                      <div className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-lg">
                        {filteredClients.map(c => (
                          <button
                            key={c.id}
                            onClick={() => { setClientId(c.id); setClientSearch(''); setShowClientDropdown(false) }}
                            className="w-full text-start px-3 py-2 text-sm hover:bg-[var(--bg-tertiary)] flex items-center gap-2"
                          >
                            <User className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
                            <span>{c.name}</span>
                            <span className="text-xs text-[var(--text-tertiary)]">{c.email}</span>
                          </button>
                        ))}
                        {filteredClients.length === 0 && (
                          <p className="px-3 py-2 text-sm text-[var(--text-tertiary)]">{t('common.noResults')}</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Title */}
              <div>
                <label className="block text-sm font-medium mb-1">{t('signatures.requestTitle')}</label>
                <Input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder={t('signatures.requestTitlePlaceholder')}
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium mb-1">{t('signatures.description')}</label>
                <Textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder={t('signatures.descriptionPlaceholder')}
                  rows={3}
                />
              </div>

              {/* Expiry */}
              <div>
                <label className="block text-sm font-medium mb-1">{t('signatures.expiresAt')}</label>
                <Input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} />
                <p className="text-xs text-[var(--text-tertiary)] mt-1">{t('signatures.noExpiry')}</p>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button onClick={() => setStep(2)} disabled={!canProceedStep1}>
              {t('common.next')}
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Upload Documents */}
      {step === 2 && (
        <div className="space-y-4">
          <Card>
            <CardHeader title={t('signatures.uploadDocument')} description={t('signatures.uploadDocumentDesc')} />
            <CardContent className="space-y-3">
              {documents.map((doc, idx) => (
                <div key={idx} className="flex items-center gap-3 p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
                  <FileText className="w-6 h-6 text-red-500" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{doc.file.name}</p>
                    <p className="text-xs text-[var(--text-tertiary)]">{(doc.file.size / 1024 / 1024).toFixed(2)} MB · {doc.pageCount} {doc.pageCount === 1 ? t('signatures.page') : t('signatures.page')}</p>
                  </div>
                  <button
                    onClick={() => {
                      URL.revokeObjectURL(doc.url)
                      const removedIdx = idx
                      setDocuments(prev => prev.filter((_, i) => i !== removedIdx))
                      setFields(prev => prev.filter(f => f.docIndex !== removedIdx).map(f => f.docIndex > removedIdx ? { ...f, docIndex: f.docIndex - 1 } : f))
                      if (activeDocIndex >= documents.length - 1) setActiveDocIndex(Math.max(0, documents.length - 2))
                    }}
                    className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-red-500"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <div
                onDrop={handleDrop}
                onDragOver={e => e.preventDefault()}
                onClick={() => {
                  const input = document.createElement('input')
                  input.type = 'file'
                  input.accept = 'application/pdf'
                  input.multiple = true
                  input.onchange = () => { if (input.files?.length) handleFilesSelect(input.files) }
                  input.click()
                }}
                className="border-2 border-dashed border-[var(--border-primary)] rounded-xl p-8 text-center cursor-pointer hover:border-indigo-500 transition-colors"
              >
                <UploadCloud className="w-10 h-10 mx-auto text-[var(--text-tertiary)] mb-2" />
                <p className="text-sm font-medium">{t('signatures.dragOrClick')}</p>
                <p className="text-xs text-[var(--text-tertiary)] mt-1">{t('signatures.pdfOnly')}</p>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(1)}>
              <BackIcon className="w-4 h-4 me-1" /> {t('common.back')}
            </Button>
            <Button onClick={() => { setActiveDocIndex(0); setCurrentPage(1); setStep(3) }} disabled={!canProceedStep2}>
              {t('common.next')}
            </Button>
          </div>
        </div>
      )}

    </div>
  )
}
