import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import {
  getSignatureRequestByToken,
  submitPublicSignature,
  getSignatureDocumentUrl,
  updateSignatureRequest,
  getSignatureDocuments,
} from '@/services/signaturesService'
import {
  CheckCircle2, FileText, AlertTriangle,
  Loader2, Shield, PenLine, Calendar, User,
  Type, Hash, CheckSquare, XCircle, X,
  Download, Eye, Image, ChevronLeft, ChevronRight,
} from 'lucide-react'
import type { SignatureRequest, SignatureFieldType } from '@/types'
import { PdfPageCanvas, getPdfPageCount } from '@/components/PdfPageCanvas'

type PageState = 'loading' | 'ready' | 'signed' | 'already-signed' | 'expired' | 'cancelled' | 'not-found'

const fieldIcons: Record<SignatureFieldType, typeof PenLine> = {
  signature: PenLine,
  date: Calendar,
  name: User,
  text: Type,
  initials: Hash,
  checkbox: CheckSquare,
}

export function PublicSignaturePage() {
  const { token } = useParams<{ token: string }>()
  const [state, setState] = useState<PageState>('loading')
  const [request, setRequest] = useState<SignatureRequest | null>(null)
  const [docUrl, setDocUrl] = useState<string | null>(null)
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Auto-dismiss error after 4 seconds
  useEffect(() => {
    if (!error) return
    const timer = setTimeout(() => setError(null), 4000)
    return () => clearTimeout(timer)
  }, [error])

  const [showSignPad, setShowSignPad] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const isDrawingRef = useRef(false)

  // Extra documents
  const [extraDocs, setExtraDocs] = useState<{ id: string; fileName: string; storagePath: string; fileType: string }[]>([])

  // Document viewer state (for viewing documents with field overlays)
  const [activeDocId, setActiveDocId] = useState<string | null>(null)
  const [activeDocUrl, setActiveDocUrl] = useState<string | null>(null)
  const [activeDocType, setActiveDocType] = useState('')
  const docViewerRef = useRef<HTMLDivElement>(null)
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null)
  const [viewerPage, setViewerPage] = useState(1)
  const [activeDocPageCount, setActiveDocPageCount] = useState(1)

  const isImageType = (ft: string) =>
    ft?.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ft?.split('/').pop()?.toLowerCase() || '')

  // Detect language from browser
  const isHebrew = navigator.language.startsWith('he')
  const dir = isHebrew ? 'rtl' : 'ltr'

  const t = useCallback((key: string) => {
    const translations: Record<string, Record<string, string>> = {
      en: {
        signDocument: 'Sign Document',
        signHere: 'Sign here',
        clearSignature: 'Clear',
        submitSignature: 'Submit Signature',
        signatureSubmitted: 'Signature Submitted!',
        signatureSubmittedDesc: 'Thank you! Your signature has been recorded successfully.',
        alreadySigned: 'Already Signed',
        alreadySignedDesc: 'This document has already been signed.',
        requestExpired: 'Request Expired',
        requestExpiredDesc: 'This signing request has expired. Please contact the sender.',
        requestCancelled: 'Request Cancelled',
        requestCancelledDesc: 'This signing request has been cancelled.',
        invalidLink: 'Invalid Link',
        invalidLinkDesc: 'This signing link is not valid. Please check the link or contact the sender.',
        fillRequired: 'Please fill all required fields before submitting.',
        secureSign: 'Your signature is encrypted and legally binding',
        poweredBy: 'Powered by Dockly',
        typeSignature: 'Signature',
        typeDate: 'Date',
        typeName: 'Full Name',
        typeText: 'Text',
        typeInitials: 'Initials',
        typeCheckbox: 'Checkbox',
        required: 'Required',
        optional: 'Optional',
        close: 'Close',
        confirm: 'Confirm',
        document: 'Document',
        viewDocument: 'View Document',
        fieldsToFill: 'Fields to fill',
        filled: 'filled',
        of: 'of',
        documents: 'Documents',
        clickToView: 'Click to view',
      },
      he: {
        signDocument: 'חתום על מסמך',
        signHere: 'חתום כאן',
        clearSignature: 'נקה',
        submitSignature: 'שלח חתימה',
        signatureSubmitted: 'החתימה נשלחה!',
        signatureSubmittedDesc: 'תודה! החתימה שלך נרשמה בהצלחה.',
        alreadySigned: 'כבר נחתם',
        alreadySignedDesc: 'מסמך זה כבר נחתם.',
        requestExpired: 'הבקשה פגה',
        requestExpiredDesc: 'בקשת החתימה פגה. אנא צור קשר עם השולח.',
        requestCancelled: 'הבקשה בוטלה',
        requestCancelledDesc: 'בקשת החתימה בוטלה.',
        invalidLink: 'קישור לא תקף',
        invalidLinkDesc: 'קישור חתימה זה אינו תקף. אנא בדוק את הקישור או פנה לשולח.',
        fillRequired: 'אנא מלא את כל השדות הנדרשים לפני השליחה.',
        secureSign: 'החתימה שלך מוצפנת ומחייבת משפטית',
        poweredBy: 'מופעל על ידי Dockly',
        typeSignature: 'חתימה',
        typeDate: 'תאריך',
        typeName: 'שם מלא',
        typeText: 'טקסט',
        typeInitials: 'ראשי תיבות',
        typeCheckbox: 'תיבת סימון',
        required: 'חובה',
        optional: 'אופציונלי',
        close: 'סגור',
        confirm: 'אישור',
        document: 'מסמך',
        viewDocument: 'צפה במסמך',
        fieldsToFill: 'שדות למילוי',
        filled: 'מולאו',
        of: 'מתוך',
        documents: 'מסמכים',
        clickToView: 'לחץ לצפייה',
      },
    }
    return translations[isHebrew ? 'he' : 'en'][key] || key
  }, [isHebrew])

  useEffect(() => {
    if (!token) { setState('not-found'); return }
    getSignatureRequestByToken(token)
      .then(async (r) => {
        if (!r) { setState('not-found'); return }
        setRequest(r)

        // Pre-fill values from existing field values
        const existing: Record<string, string> = {}
        r.fields.forEach(f => { if (f.value) existing[f.id] = f.value })
        setFieldValues(existing)

        // Check status
        if (r.status === 'signed') {
          // Load signed doc for the already-signed view
          const signedPath = r.signedDocumentPath || r.documentStoragePath
          try { const url = await getSignatureDocumentUrl(signedPath); setDocUrl(url) } catch {}
          setState('already-signed')
          return
        }
        if (r.status === 'cancelled') { setState('cancelled'); return }
        if (r.status === 'expired') { setState('expired'); return }
        if (r.expiresAt && new Date(r.expiresAt) < new Date()) { setState('expired'); return }

        // Mark as viewed if pending
        if (r.status === 'pending') {
          try { await updateSignatureRequest(r.id, { status: 'viewed' }) } catch {}
        }

        // Get document URL
        try {
          const url = await getSignatureDocumentUrl(r.documentStoragePath)
          setDocUrl(url)
        } catch {}

        setState('ready')
      })
      .catch(() => setState('not-found'))
  }, [token])

  // Load extra documents
  useEffect(() => {
    if (!request?.id) return
    getSignatureDocuments(request.id)
      .then(docs => setExtraDocs(docs.map(d => ({
        id: d.id, fileName: d.fileName, storagePath: d.storagePath, fileType: d.fileType,
      }))))
      .catch(() => {})
  }, [request?.id])

  // Signature pad drawing
  const startDraw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    isDrawingRef.current = true
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.beginPath()
    const rect = canvas.getBoundingClientRect()
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
    ctx.moveTo(clientX - rect.left, clientY - rect.top)
  }

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const rect = canvas.getBoundingClientRect()
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#1e293b'
    ctx.lineTo(clientX - rect.left, clientY - rect.top)
    ctx.stroke()
  }

  const endDraw = () => { isDrawingRef.current = false }

  const clearCanvas = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }

  const confirmSignature = () => {
    if (!canvasRef.current || !showSignPad) return
    const dataUrl = canvasRef.current.toDataURL('image/png')
    setFieldValues(prev => ({ ...prev, [showSignPad]: dataUrl }))
    setShowSignPad(null)
  }

  const handleFieldChange = (fieldId: string, value: string) => {
    setFieldValues(prev => ({ ...prev, [fieldId]: value }))
  }

  const handleSubmit = async () => {
    if (!request) return
    setError(null)

    // Validate required fields
    const missingRequired = request.fields
      .filter(f => f.required && !fieldValues[f.id])
    if (missingRequired.length > 0) {
      setError(t('fillRequired'))
      return
    }

    setSubmitting(true)
    try {
      await submitPublicSignature(
        token!,
        Object.entries(fieldValues).map(([fieldId, value]) => ({ fieldId, value })),
      )
      // Reload request to get signedDocumentPath
      try {
        const updated = await getSignatureRequestByToken(token!)
        if (updated?.signedDocumentPath) {
          const url = await getSignatureDocumentUrl(updated.signedDocumentPath)
          setDocUrl(url)
        }
      } catch {}
      setState('signed')
    } catch (err: any) {
      setError(err.message || 'Failed to submit')
    } finally {
      setSubmitting(false)
    }
  }

  const filledCount = request?.fields.filter(f => fieldValues[f.id]).length ?? 0
  const totalFields = request?.fields.length ?? 0

  // All docs list (used in ready state)
  const allDocs = request ? [
    { id: 'main', fileName: request.documentFileName || '', storagePath: request.documentStoragePath || '', fileType: request.documentFileType || '' },
    ...extraDocs,
  ] : []

  const openDocWithFields = useCallback(async (docId: string, storagePath: string, fileType: string) => {
    try {
      const url = await getSignatureDocumentUrl(storagePath)
      setActiveDocUrl(url)
      setActiveDocId(docId)
      setActiveDocType(fileType)
      setViewerPage(1)
      // Resolve actual page count for PDFs
      if (!isImageType(fileType) && url) {
        try {
          const count = await getPdfPageCount(url)
          setActiveDocPageCount(count)
        } catch { setActiveDocPageCount(1) }
      } else {
        setActiveDocPageCount(1)
      }
    } catch {}
  }, [])

  // Auto-open main doc on first render
  useEffect(() => {
    if (state === 'ready' && !activeDocId && request?.documentStoragePath) {
      openDocWithFields('main', request.documentStoragePath, request.documentFileType || '')
    }
  }, [state, request, activeDocId, openDocWithFields])

  const isMainDoc = activeDocId === 'main'
  // Determine which docIndex the active document corresponds to
  const activeDocIndex = isMainDoc ? 0 : allDocs.findIndex(d => d.id === activeDocId)
  const activeFieldsForDoc = request?.fields.filter(f => (f.docIndex ?? 0) === activeDocIndex) ?? []
  const maxFieldPage = activeFieldsForDoc.reduce((max, f) => Math.max(max, f.page), 1)
  // For docs with fields, use whichever is greater; for others use actual page count
  const totalPagesToRender = activeFieldsForDoc.length > 0 ? Math.max(maxFieldPage, activeDocPageCount) : activeDocPageCount
  const currentPageFields = request
    ? activeFieldsForDoc.filter(f => f.page === viewerPage)
    : []

  // State pages
  if (state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-indigo-50 dark:from-slate-900 dark:to-indigo-950" dir={dir}>
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
      </div>
    )
  }

  if (state === 'not-found') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-indigo-50 dark:from-slate-900 dark:to-indigo-950" dir={dir}>
        <div className="text-center max-w-md p-8">
          <XCircle className="w-16 h-16 mx-auto text-red-400 mb-4" />
          <h1 className="text-xl font-bold mb-2">{t('invalidLink')}</h1>
          <p className="text-sm text-gray-500">{t('invalidLinkDesc')}</p>
        </div>
      </div>
    )
  }

  if (state === 'already-signed') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-indigo-50 dark:from-slate-900 dark:to-indigo-950" dir={dir}>
        <div className="text-center max-w-md p-8">
          <CheckCircle2 className="w-16 h-16 mx-auto text-green-500 mb-4" />
          <h1 className="text-xl font-bold mb-2">{t('alreadySigned')}</h1>
          <p className="text-sm text-gray-500">{t('alreadySignedDesc')}</p>
        </div>
      </div>
    )
  }

  if (state === 'expired') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-indigo-50 dark:from-slate-900 dark:to-indigo-950" dir={dir}>
        <div className="text-center max-w-md p-8">
          <AlertTriangle className="w-16 h-16 mx-auto text-orange-400 mb-4" />
          <h1 className="text-xl font-bold mb-2">{t('requestExpired')}</h1>
          <p className="text-sm text-gray-500">{t('requestExpiredDesc')}</p>
        </div>
      </div>
    )
  }

  if (state === 'cancelled') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-indigo-50 dark:from-slate-900 dark:to-indigo-950" dir={dir}>
        <div className="text-center max-w-md p-8">
          <XCircle className="w-16 h-16 mx-auto text-gray-400 mb-4" />
          <h1 className="text-xl font-bold mb-2">{t('requestCancelled')}</h1>
          <p className="text-sm text-gray-500">{t('requestCancelledDesc')}</p>
        </div>
      </div>
    )
  }

  if (state === 'signed') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-green-50 dark:from-slate-900 dark:to-green-950" dir={dir}>
        <div className="max-w-2xl mx-auto px-4 py-12">
          <div className="text-center mb-8">
            <div className="w-20 h-20 mx-auto bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-4">
              <CheckCircle2 className="w-10 h-10 text-green-500" />
            </div>
            <h1 className="text-xl font-bold mb-2">{t('signatureSubmitted')}</h1>
            <p className="text-sm text-gray-500">{t('signatureSubmittedDesc')}</p>
          </div>

          {/* Show signed fields summary */}
          {request && request.fields.length > 0 && (
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5 mb-6">
              <h2 className="font-semibold text-sm mb-3">{request.title}</h2>
              <div className="space-y-2">
                {request.fields.map(field => {
                  const Icon = fieldIcons[field.type]
                  const value = fieldValues[field.id]
                  return (
                    <div key={field.id} className="flex items-start gap-2 p-2 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                      <Icon className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium">{field.label}</span>
                        {value && (
                          <div className="mt-1">
                            {field.type === 'signature' && value.startsWith('data:image') ? (
                              <img src={value} alt={field.label} className="h-10 object-contain bg-white rounded border border-green-200 px-2 py-1" />
                            ) : field.type === 'checkbox' ? (
                              <span className="text-xs text-green-700 dark:text-green-400">{value === 'true' ? '✓' : '✗'}</span>
                            ) : (
                              <span className="text-xs text-green-700 dark:text-green-400">{value}</span>
                            )}
                          </div>
                        )}
                      </div>
                      <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Show signed document */}
          {docUrl && (
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-gray-400" />
                  <span className="text-sm font-medium">{t('document')}</span>
                </div>
                <a
                  href={docUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-indigo-600 hover:underline flex items-center gap-1"
                >
                  {t('viewDocument')}
                </a>
              </div>
              <div style={{ height: 500 }}>
                <embed
                  src={`${docUrl}#navpanes=0&toolbar=0&scrollbar=1&view=FitH`}
                  type="application/pdf"
                  className="w-full h-full"
                />
              </div>
            </div>
          )}

          {/* Security footer */}
          <div className="mt-8 text-center">
            <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
              <Shield className="w-3.5 h-3.5" />
              <span>{t('secureSign')}</span>
            </div>
            <p className="text-[10px] text-gray-300 dark:text-gray-600 mt-2">{t('poweredBy')}</p>
          </div>
        </div>
      </div>
    )
  }

  // Ready state — main signing UI (split layout using app design system)
  return (
    <div className="min-h-screen bg-[var(--bg-secondary)]" dir={dir}>
      {/* Page padding like AppLayout main */}
      <div className="p-4 lg:p-6 h-screen flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 shrink-0">
          <div>
            <h1 className="text-xl font-bold text-[var(--text-primary)]">{request?.title}</h1>
            {request?.description && (
              <p className="text-xs text-[var(--text-tertiary)] mt-0.5">{request.description}</p>
            )}
          </div>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400 text-xs font-medium">
            <PenLine className="w-3.5 h-3.5" />
            {t('signDocument')}
          </div>
        </div>

        {/* Two-column layout */}
        <div className="flex gap-4 lg:gap-6 flex-1 min-h-0">
          {/* START side: Details panel */}
          <div className="w-72 lg:w-80 shrink-0 flex flex-col gap-4 overflow-y-auto min-h-0">
            {/* Progress card */}
            <div className="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-primary)] shadow-[var(--shadow-sm)] overflow-hidden">
              <div className="px-5 py-4 border-b border-[var(--border-secondary)]">
                <h3 className="text-sm font-semibold">{t('fieldsToFill')}</h3>
              </div>
              <div className="px-5 py-4">
                <div className="flex items-center justify-between text-xs mb-2">
                  <span className="text-[var(--text-tertiary)]">{t('fieldsToFill')}</span>
                  <span className="font-semibold text-[var(--text-primary)]">{filledCount} {t('of')} {totalFields} {t('filled')}</span>
                </div>
                <div className="h-2 rounded-full bg-[var(--bg-tertiary)]">
                  <div
                    className="h-2 rounded-full bg-indigo-500 transition-all duration-300"
                    style={{ width: `${totalFields > 0 ? (filledCount / totalFields) * 100 : 0}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Documents card */}
            <div className="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-primary)] shadow-[var(--shadow-sm)] overflow-hidden">
              <div className="px-5 py-4 border-b border-[var(--border-secondary)]">
                <h3 className="text-sm font-semibold">{t('documents')}</h3>
              </div>
              <div className="px-5 py-4 space-y-2">
                {allDocs.map(doc => {
                  const isMain = doc.id === 'main'
                  const isActive = doc.id === activeDocId
                  return (
                    <div
                      key={doc.id}
                      onClick={() => openDocWithFields(doc.id, doc.storagePath, doc.fileType)}
                      className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-all ${
                        isActive
                          ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 shadow-sm'
                          : 'border-[var(--border-secondary)] hover:border-indigo-300 hover:bg-[var(--bg-tertiary)]'
                      }`}
                    >
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                        isImageType(doc.fileType)
                          ? 'bg-blue-50 dark:bg-blue-900/30'
                          : 'bg-red-50 dark:bg-red-900/30'
                      }`}>
                        {isImageType(doc.fileType) ? (
                          <Image className="w-4 h-4 text-blue-500" />
                        ) : (
                          <FileText className="w-4 h-4 text-red-500" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate text-[var(--text-primary)]">{doc.fileName}</p>
                        {isMain && totalFields > 0 && (
                          <p className="text-[10px] text-[var(--text-tertiary)]">{filledCount}/{totalFields} {t('filled')}</p>
                        )}
                      </div>
                      {isActive && <Eye className="w-4 h-4 text-indigo-500 shrink-0" />}
                    </div>
                  )
                })}
              </div>
            </div>



            {/* Submit button */}
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-xl flex items-center justify-center gap-2 transition-colors shadow-[var(--shadow-sm)]"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <PenLine className="w-4 h-4" />
              )}
              {t('submitSignature')}
            </button>

            {/* Footer */}
            <div className="text-center pb-2">
              <div className="flex items-center justify-center gap-2 text-[10px] text-[var(--text-tertiary)]">
                <Shield className="w-3 h-3" />
                <span>{t('secureSign')}</span>
              </div>
              <p className="text-[9px] text-[var(--text-tertiary)] mt-1">{t('poweredBy')}</p>
            </div>
          </div>

          {/* END side: Document viewer card */}
          <div className="flex-1 min-w-0 flex flex-col bg-[var(--bg-primary)] rounded-xl border border-[var(--border-primary)] shadow-[var(--shadow-sm)] overflow-hidden">
            {/* Viewer header */}
            <div className="px-5 py-3 border-b border-[var(--border-secondary)] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="w-4 h-4 text-[var(--text-tertiary)] shrink-0" />
                <span className="text-sm font-semibold truncate text-[var(--text-primary)]">
                  {allDocs.find(d => d.id === activeDocId)?.fileName || t('document')}
                </span>
              </div>
              {!isImageType(activeDocType) && totalPagesToRender > 1 && (
                <span className="text-xs font-medium text-[var(--text-secondary)]">
                  {viewerPage} / {totalPagesToRender}
                </span>
              )}
            </div>

            {/* Viewer content – continuous scroll all pages */}
            <div
              ref={docViewerRef}
              className="flex-1 min-h-0 overflow-auto bg-[var(--bg-secondary)]"
              onScroll={() => {
                // Track visible page by scroll position
                const scrollEl = docViewerRef.current
                if (!scrollEl) return
                const children = scrollEl.querySelectorAll('[data-page]')
                const scrollTop = scrollEl.scrollTop + scrollEl.clientHeight / 3
                let page = 1
                children.forEach(child => {
                  const el = child as HTMLElement
                  if (el.offsetTop <= scrollTop) {
                    page = parseInt(el.dataset.page || '1', 10)
                  }
                })
                if (page !== viewerPage) setViewerPage(page)
              }}
            >
              {activeDocUrl ? (
                <div className="flex flex-col items-center gap-8 py-4">
                  {isImageType(activeDocType) ? (
                    <img src={activeDocUrl} alt="" className="w-full" />
                  ) : (
                    Array.from({ length: totalPagesToRender }, (_, i) => {
                      const pageNum = i + 1
                      const pageFields = request
                        ? activeFieldsForDoc.filter(f => f.page === pageNum)
                        : []
                      return (
                        <div
                          key={pageNum}
                          data-page={pageNum}
                          className="relative w-full border-b border-[var(--border-secondary)] last:border-b-0"
                        >
                          <PdfPageCanvas
                            src={activeDocUrl}
                            page={pageNum}
                            className="w-full"
                          />

                          {/* Fields overlay for this page */}
                          {pageFields.length > 0 && (
                            <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 10 }}>
                              {pageFields.map(field => {
                                const canvasW = request!.canvasWidth ?? 750
                                const viewerW = docViewerRef.current?.getBoundingClientRect().width ?? canvasW
                                const scale = viewerW / canvasW
                                const Icon = fieldIcons[field.type]
                                const isFilled = !!fieldValues[field.id]

                                return (
                                  <div
                                    key={field.id}
                                    className={`absolute rounded border-2 flex items-center justify-center cursor-pointer transition-all pointer-events-auto ${
                                      isFilled
                                        ? 'border-green-400 bg-green-50/80'
                                        : 'border-indigo-400 bg-indigo-50/80 hover:bg-indigo-100/90 animate-pulse'
                                    }`}
                                    style={{
                                      left: field.x * scale,
                                      top: field.y * scale,
                                      width: field.width * scale,
                                      height: field.height * scale,
                                    }}
                                    onClick={() => {
                                      if (field.type === 'signature') {
                                        setShowSignPad(field.id)
                                      } else {
                                        setEditingFieldId(field.id)
                                      }
                                    }}
                                    title={field.label}
                                  >
                                    {isFilled ? (
                                      field.type === 'signature' && fieldValues[field.id]?.startsWith('data:image') ? (
                                        <img src={fieldValues[field.id]} alt="" className="h-full w-full object-contain p-0.5" />
                                      ) : field.type === 'checkbox' ? (
                                        <CheckCircle2 className="w-5 h-5 text-green-600" />
                                      ) : (
                                        <span className="text-xs font-medium text-green-700 truncate px-1">{fieldValues[field.id]}</span>
                                      )
                                    ) : (
                                      <div className="flex flex-col items-center gap-0.5">
                                        <Icon className="w-4 h-4 text-indigo-500" />
                                        <span className="text-[9px] text-indigo-600 font-medium">{field.label}</span>
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-[var(--text-tertiary)] gap-3">
                  <FileText className="w-12 h-12 opacity-30" />
                  <span className="text-sm">{t('clickToView')}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Error toast – floating, auto-dismiss */}
      {error && (
        <div className="fixed bottom-6 start-1/2 -translate-x-1/2 z-[300] px-5 py-3 rounded-xl bg-red-600 text-white text-sm font-medium shadow-lg flex items-center gap-2 animate-in fade-in slide-in-from-bottom-4">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="p-0.5 hover:bg-red-700 rounded ms-2">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── Inline field edit modal (for non-signature fields) ── */}
      {editingFieldId && request && (() => {
        const field = request.fields.find(f => f.id === editingFieldId)
        if (!field) return null
        const Icon = fieldIcons[field.type]

        return (
          <div className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center p-4" onClick={() => setEditingFieldId(null)}>
            <div className="bg-[var(--bg-primary)] rounded-xl shadow-[var(--shadow-xl)] border border-[var(--border-primary)] max-w-sm w-full p-5" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-2 mb-4">
                <Icon className="w-5 h-5 text-indigo-500" />
                <h3 className="font-semibold flex-1">{field.label}</h3>
                <button onClick={() => setEditingFieldId(null)} className="p-1 rounded hover:bg-[var(--bg-tertiary)]">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {field.type === 'date' ? (
                <input
                  type="date"
                  value={fieldValues[field.id] || ''}
                  onChange={e => handleFieldChange(field.id, e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-[var(--border-primary)] rounded-lg bg-[var(--bg-primary)] focus:ring-2 focus:ring-indigo-500"
                  autoFocus
                />
              ) : field.type === 'checkbox' ? (
                <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg border border-[var(--border-primary)]">
                  <input
                    type="checkbox"
                    checked={fieldValues[field.id] === 'true'}
                    onChange={e => handleFieldChange(field.id, e.target.checked ? 'true' : '')}
                    className="w-5 h-5 text-indigo-600 rounded"
                  />
                  <span className="text-sm">{t('confirm')}</span>
                </label>
              ) : (
                <input
                  type="text"
                  value={fieldValues[field.id] || ''}
                  onChange={e => handleFieldChange(field.id, e.target.value)}
                  placeholder={field.label}
                  className="w-full px-3 py-2.5 text-sm border border-[var(--border-primary)] rounded-lg bg-[var(--bg-primary)] focus:ring-2 focus:ring-indigo-500"
                  autoFocus
                />
              )}

              <button
                onClick={() => setEditingFieldId(null)}
                className="w-full mt-4 py-2 px-4 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700"
              >
                {t('confirm')}
              </button>
            </div>
          </div>
        )
      })()}

      {/* Signature pad modal */}
      {showSignPad && (
        <div className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center p-4" onClick={() => setShowSignPad(null)}>
          <div className="bg-[var(--bg-primary)] rounded-xl shadow-[var(--shadow-xl)] border border-[var(--border-primary)] max-w-lg w-full p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">{t('signHere')}</h3>
              <button onClick={() => setShowSignPad(null)} className="p-1 rounded hover:bg-[var(--bg-tertiary)]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="border-2 border-[var(--border-primary)] rounded-xl overflow-hidden mb-4 bg-white">
              <canvas
                ref={canvasRef}
                width={460}
                height={200}
                className="w-full cursor-crosshair touch-none"
                onMouseDown={startDraw}
                onMouseMove={draw}
                onMouseUp={endDraw}
                onMouseLeave={endDraw}
                onTouchStart={startDraw}
                onTouchMove={draw}
                onTouchEnd={endDraw}
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={clearCanvas}
                className="flex-1 py-2 px-4 border border-[var(--border-primary)] rounded-xl text-sm font-medium hover:bg-[var(--bg-tertiary)]"
              >
                {t('clearSignature')}
              </button>
              <button
                onClick={confirmSignature}
                className="flex-1 py-2 px-4 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700"
              >
                {t('confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
