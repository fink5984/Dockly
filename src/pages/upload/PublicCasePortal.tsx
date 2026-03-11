import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'react-router-dom'
import {
  getCaseByPublicToken,
  getPublicDocuments,
  uploadFromPublicPortal,
  getPublicSignedUrl,
  type PublicCaseInfo,
  type PublicDocument,
} from '@/services/publicPortalService'
import {
  CheckCircle2, FileText, AlertTriangle,
  Loader2, Shield, UploadCloud, Eye, RefreshCw,
  X, XCircle, ChevronLeft, ChevronRight, Download,
} from 'lucide-react'

type PortalState = 'loading' | 'valid' | 'not-found'

export function PublicCasePortal() {
  const { token } = useParams<{ token: string }>()
  const [state, setState] = useState<PortalState>('loading')
  const [caseInfo, setCaseInfo] = useState<PublicCaseInfo | null>(null)
  const [documents, setDocuments] = useState<PublicDocument[]>([])
  const [uploading, setUploading] = useState<Record<string, boolean>>({})
  const [justUploaded, setJustUploaded] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({})
  const [lightboxDoc, setLightboxDoc] = useState<string | null>(null)
  const [loadingPreviews, setLoadingPreviews] = useState(false)
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  // Detect language from browser
  const isHebrew = navigator.language.startsWith('he')
  const dir = isHebrew ? 'rtl' : 'ltr'

  const t = useCallback((key: string) => {
    const translations: Record<string, Record<string, string>> = {
      en: {
        overallProgress: 'Overall Progress',
        uploaded: 'Uploaded',
        missingLabel: 'Missing',
        documentCenter: 'Document Center',
        notFound: 'Page not found',
        notFoundDesc: 'This link is not valid. Please check the link or contact your service provider.',
        statusMissing: 'Missing',
        statusUploaded: 'Uploaded',
        statusApproved: 'Approved',
        statusRejected: 'Rejected',
        statusReview: 'In Review',
        noFile: 'No file',
        notUploaded: 'Not uploaded',
        uploading: 'Uploading...',
        secureUpload: 'Your files are encrypted and securely stored',
        poweredBy: 'Powered by Dockly',
        allUploaded: 'All documents uploaded!',
        allUploadedDesc: 'Thank you! All required documents have been uploaded successfully.',
        errorSize: 'File too large. Maximum size is',
        errorFormat: 'Invalid file format. Accepted:',
        errorUpload: 'Upload failed. Please try again.',
        preview: 'Preview',
        download: 'Download',
        close: 'Close',
        uploadFile: 'Upload file',
        reupload: 'Re-upload',
        rejectedMsg: 'Rejected — please re-upload',
        clickToUpload: 'Click to upload',
      },
      he: {
        overallProgress: 'התקדמות כללית',
        uploaded: 'הועלה',
        missingLabel: 'חסר',
        documentCenter: 'מרכז מסמכים',
        notFound: 'עמוד לא נמצא',
        notFoundDesc: 'קישור זה אינו תקף. אנא בדוק את הקישור או פנה לספק השירות.',
        statusMissing: 'חסר',
        statusUploaded: 'הועלה',
        statusApproved: 'אושר',
        statusRejected: 'נדחה',
        statusReview: 'בבדיקה',
        noFile: 'ללא קובץ',
        notUploaded: 'לא הועלה',
        uploading: 'מעלה...',
        secureUpload: 'הקבצים שלך מוצפנים ומאוחסנים בצורה מאובטחת',
        poweredBy: 'מופעל על ידי Dockly',
        allUploaded: 'כל המסמכים הועלו!',
        allUploadedDesc: 'תודה! כל המסמכים הנדרשים הועלו בהצלחה.',
        errorSize: 'הקובץ גדול מדי. גודל מקסימלי',
        errorFormat: 'פורמט לא תקין. מותר:',
        errorUpload: 'ההעלאה נכשלה. נסה שוב.',
        preview: 'תצוגה מקדימה',
        download: 'הורדה',
        close: 'סגור',
        uploadFile: 'העלה קובץ',
        reupload: 'העלה מחדש',
        rejectedMsg: 'נדחה — יש להעלות מחדש',
        clickToUpload: 'לחץ להעלאה',
      },
    }
    return translations[isHebrew ? 'he' : 'en'][key] || key
  }, [isHebrew])

  // Load case data
  const loadData = useCallback(async () => {
    if (!token) {
      setState('not-found')
      return
    }

    try {
      const info = await getCaseByPublicToken(token)
      if (!info) {
        setState('not-found')
        return
      }

      setCaseInfo(info)
      const docs = await getPublicDocuments(info.caseId)
      setDocuments(docs)
      setState('valid')

      // Load preview URLs for uploaded docs
      setLoadingPreviews(true)
      const urls: Record<string, string> = {}
      await Promise.all(
        docs
          .filter(d => d.storagePath)
          .map(async doc => {
            try {
              const url = await getPublicSignedUrl(doc.storagePath!)
              urls[doc.id] = url
            } catch {
              // ignore preview errors
            }
          })
      )
      setPreviewUrls(urls)
      setLoadingPreviews(false)
    } catch {
      setState('not-found')
    }
  }, [token])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Handle file upload
  const handleFileUpload = async (docId: string, file: globalThis.File, doc: PublicDocument) => {
    if (!caseInfo) return

    // Validate file size
    if (file.size > doc.maxSizeMB * 1024 * 1024) {
      setErrors(prev => ({ ...prev, [docId]: `${t('errorSize')} ${doc.maxSizeMB}MB` }))
      return
    }

    // Validate file format
    const ext = file.name.split('.').pop()?.toLowerCase() || ''
    if (doc.allowedFormats.length > 0 && !doc.allowedFormats.includes(ext)) {
      setErrors(prev => ({ ...prev, [docId]: `${t('errorFormat')} ${doc.allowedFormats.join(', ')}` }))
      return
    }

    setErrors(prev => ({ ...prev, [docId]: '' }))
    setUploading(prev => ({ ...prev, [docId]: true }))

    try {
      await uploadFromPublicPortal(
        caseInfo.workspaceId,
        caseInfo.caseId,
        docId,
        file,
        caseInfo.clientId
      )

      setJustUploaded(prev => ({ ...prev, [docId]: true }))

      // Update the doc in local state
      setDocuments(prev =>
        prev.map(d =>
          d.id === docId
            ? {
                ...d,
                status: 'uploaded',
                fileName: file.name,
                fileType: file.type,
                fileSize: file.size,
                uploadedAt: new Date().toISOString(),
                storagePath: `${caseInfo.workspaceId}/${caseInfo.caseId}/${docId}/${file.name}`,
              }
            : d
        )
      )

      // Generate preview URL for the newly uploaded file
      const storagePath = `${caseInfo.workspaceId}/${caseInfo.caseId}/${docId}/${file.name}`
      try {
        const url = await getPublicSignedUrl(storagePath)
        setPreviewUrls(prev => ({ ...prev, [docId]: url }))
      } catch {
        // ignore
      }
    } catch {
      setErrors(prev => ({ ...prev, [docId]: t('errorUpload') }))
    } finally {
      setUploading(prev => ({ ...prev, [docId]: false }))
    }
  }

  const needsUpload = (doc: PublicDocument) =>
    ['missing', 'pending-upload', 'rejected', 'blurry', 'missing-pages'].includes(doc.status)

  const isDocUploaded = (doc: PublicDocument) =>
    !needsUpload(doc) || justUploaded[doc.id]

  const pendingCount = documents.filter(d => needsUpload(d) && !justUploaded[d.id]).length
  const totalCount = documents.length
  const doneCount = totalCount - pendingCount
  const progressPercent = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0

  const getStatusLabel = (doc: PublicDocument) => {
    if (justUploaded[doc.id] || doc.status === 'uploaded' || doc.status === 'received') return t('statusUploaded')
    if (doc.status === 'approved') return t('statusApproved')
    if (doc.status === 'under-review') return t('statusReview')
    if (doc.status === 'rejected' || doc.status === 'blurry' || doc.status === 'missing-pages') return t('statusRejected')
    return t('statusMissing')
  }

  const getStatusColor = (doc: PublicDocument) => {
    if (justUploaded[doc.id] || doc.status === 'uploaded' || doc.status === 'received') return 'bg-blue-100 text-blue-700'
    if (doc.status === 'approved') return 'bg-green-100 text-green-700'
    if (doc.status === 'under-review') return 'bg-indigo-100 text-indigo-700'
    if (doc.status === 'rejected' || doc.status === 'blurry' || doc.status === 'missing-pages') return 'bg-red-100 text-red-700'
    return 'bg-gray-100 text-gray-500'
  }

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleDateString(isHebrew ? 'he-IL' : 'en-US', {
      year: 'numeric', month: '2-digit', day: '2-digit',
    })
  }

  const isPreviewableImage = (fileType?: string) => fileType?.startsWith('image/')
  const isPreviewablePdf = (fileType?: string) => fileType === 'application/pdf'

  // Lightbox navigation
  const lightboxDocObj = documents.find(d => d.id === lightboxDoc)

  // ---- LOADING ----
  if (state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f0f4f8]" dir={dir}>
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin text-blue-500 mx-auto mb-4" />
          <p className="text-gray-400 text-sm">{isHebrew ? 'טוען...' : 'Loading...'}</p>
        </div>
      </div>
    )
  }

  // ---- NOT FOUND ----
  if (state === 'not-found') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f0f4f8] p-4" dir={dir}>
        <div className="max-w-sm w-full bg-white rounded-2xl shadow-xl p-10 text-center">
          <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-5">
            <XCircle className="w-8 h-8 text-red-500" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">{t('notFound')}</h1>
          <p className="text-gray-500 text-sm leading-relaxed">{t('notFoundDesc')}</p>
        </div>
      </div>
    )
  }

  // ---- MAIN PORTAL ----
  return (
    <div className="min-h-screen bg-[#f0f4f8]" dir={dir}>
      {/* ── Top Header Bar ── */}
      <div className="bg-white shadow-sm">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {caseInfo?.workspaceLogo ? (
              <img src={caseInfo.workspaceLogo} alt="" className="w-9 h-9 rounded-lg object-cover" />
            ) : (
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
                <FileText className="w-4.5 h-4.5 text-white" />
              </div>
            )}
            <div>
              <h1 className="text-base font-bold text-gray-900">{caseInfo?.workspaceName}</h1>
              <p className="text-xs text-gray-400">{caseInfo?.caseType} • {caseInfo?.clientName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadData}
              className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              title={isHebrew ? 'רענן' : 'Refresh'}
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
              <Shield className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t('secureUpload')}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">

        {/* ── Progress Card ── */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex-1">
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-sm font-semibold text-gray-800">{t('overallProgress')}</span>
                <span className="text-2xl font-bold text-gray-900 tabular-nums">{progressPercent}%</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2.5">
                <div
                  className={`h-2.5 rounded-full transition-all duration-700 ease-out ${
                    progressPercent === 100 ? 'bg-green-500' : 'bg-blue-500'
                  }`}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
            <div className="flex gap-6 text-center shrink-0">
              <div className="px-3">
                <p className="text-2xl font-bold text-green-600">{doneCount}</p>
                <p className="text-[10px] text-gray-400 uppercase tracking-wider mt-0.5">{t('uploaded')}</p>
              </div>
              <div className="px-3 border-s border-gray-200">
                <p className="text-2xl font-bold text-gray-400">{pendingCount}</p>
                <p className="text-[10px] text-gray-400 uppercase tracking-wider mt-0.5">{t('missingLabel')}</p>
              </div>
            </div>
          </div>
        </div>

        {/* ── All Done Banner ── */}
        {pendingCount === 0 && totalCount > 0 && (
          <div className="bg-green-50 border border-green-200 rounded-2xl p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <p className="font-bold text-green-800">{t('allUploaded')}</p>
              <p className="text-green-600 text-sm mt-0.5">{t('allUploadedDesc')}</p>
            </div>
          </div>
        )}

        {/* ── Document Center ── */}
        <div>
          <h2 className="text-lg font-bold text-gray-800 mb-4">{t('documentCenter')}</h2>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {documents.map(doc => {
              const uploaded = isDocUploaded(doc)
              const isRejected = !justUploaded[doc.id] && (doc.status === 'rejected' || doc.status === 'blurry' || doc.status === 'missing-pages')
              const showUploadArea = needsUpload(doc) && !justUploaded[doc.id]
              const isUploadingDoc = uploading[doc.id]
              const error = errors[doc.id]
              const hasPreview = previewUrls[doc.id]
              const isImage = isPreviewableImage(doc.fileType)
              const isPdf = isPreviewablePdf(doc.fileType)

              return (
                <div
                  key={doc.id}
                  className={`bg-white rounded-xl border overflow-hidden flex flex-col shadow-sm transition-all hover:shadow-md ${
                    isRejected
                      ? 'border-red-200'
                      : uploaded
                        ? 'border-green-200'
                        : 'border-gray-200'
                  }`}
                >
                  {/* Preview / Upload Area (aspect 4:3) */}
                  <div
                    className={`relative aspect-[4/3] flex items-center justify-center overflow-hidden ${
                      showUploadArea
                        ? 'cursor-pointer hover:bg-blue-50/60 transition-colors bg-gray-50'
                        : uploaded && hasPreview  
                          ? 'cursor-pointer bg-gray-50'
                          : 'bg-gray-50'
                    }`}
                    onClick={() => {
                      if (showUploadArea && !isUploadingDoc) {
                        fileInputRefs.current[doc.id]?.click()
                      } else if (uploaded && hasPreview) {
                        setLightboxDoc(doc.id)
                      }
                    }}
                  >
                    {/* Status badge */}
                    <div className="absolute top-2 start-2 z-10">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${getStatusColor(doc)}`}>
                        {getStatusLabel(doc)}
                      </span>
                    </div>

                    {/* Preview content */}
                    {isUploadingDoc ? (
                      <div className="flex flex-col items-center gap-2">
                        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                        <span className="text-xs text-blue-600">{t('uploading')}</span>
                      </div>
                    ) : uploaded && hasPreview && isImage ? (
                      <img
                        src={previewUrls[doc.id]}
                        alt={doc.documentTypeName}
                        className="w-full h-full object-cover"
                      />
                    ) : uploaded && hasPreview && isPdf ? (
                      <div className="flex flex-col items-center gap-1 text-gray-400">
                        <FileText className="w-10 h-10 text-red-400" />
                        <span className="text-[10px] font-medium uppercase">PDF</span>
                      </div>
                    ) : uploaded && doc.fileName ? (
                      <div className="flex flex-col items-center gap-1 text-gray-400">
                        <CheckCircle2 className="w-10 h-10 text-green-400" />
                        <span className="text-[10px] text-gray-400">{doc.fileType?.split('/').pop()?.toUpperCase() || ''}</span>
                      </div>
                    ) : loadingPreviews && doc.storagePath ? (
                      <Loader2 className="w-8 h-8 animate-spin text-gray-300" />
                    ) : (
                      <div className="flex flex-col items-center gap-1.5">
                        <UploadCloud className="w-10 h-10 text-gray-300" />
                        <span className="text-[11px] text-gray-400">{t('noFile')}</span>
                      </div>
                    )}

                    {/* Hidden file input */}
                    {showUploadArea && (
                      <input
                        ref={el => { fileInputRefs.current[doc.id] = el }}
                        type="file"
                        className="hidden"
                        accept={doc.allowedFormats.map(f => `.${f}`).join(',')}
                        capture="environment"
                        onChange={e => {
                          const file = e.target.files?.[0]
                          if (file) handleFileUpload(doc.id, file, doc)
                          e.target.value = '' // reset for re-upload
                        }}
                      />
                    )}
                  </div>

                  {/* Document info bottom section */}
                  <div className="p-3 border-t border-gray-100 flex-1 flex flex-col">
                    <p className="text-sm font-semibold text-gray-900 truncate" title={doc.documentTypeName}>
                      {doc.documentTypeName}
                    </p>
                    {doc.fileName && uploaded ? (
                      <>
                        <p className="text-xs text-gray-400 truncate mt-0.5">{doc.fileName}</p>
                        {doc.uploadedAt && (
                          <p className="text-[10px] text-gray-400 mt-0.5">{formatDate(doc.uploadedAt)}</p>
                        )}
                      </>
                    ) : isRejected ? (
                      <p className="text-xs text-red-500 mt-0.5">{t('rejectedMsg')}</p>
                    ) : (
                      <p className="text-xs text-gray-400 mt-0.5">{t('notUploaded')}</p>
                    )}

                    {/* Error message */}
                    {error && (
                      <p className="text-[10px] text-red-500 mt-1 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3 shrink-0" /> {error}
                      </p>
                    )}

                    {/* Action buttons for uploaded docs */}
                    {uploaded && hasPreview && (
                      <div className="flex items-center gap-1 mt-auto pt-2">
                        <button
                          onClick={() => setLightboxDoc(doc.id)}
                          className="flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-800 px-1.5 py-1 rounded hover:bg-blue-50 transition-colors"
                        >
                          <Eye className="w-3 h-3" /> {t('preview')}
                        </button>
                      </div>
                    )}

                    {/* Re-upload for rejected */}
                    {isRejected && (
                      <button
                        onClick={() => fileInputRefs.current[doc.id]?.click()}
                        className="mt-auto pt-2 text-[10px] text-red-600 hover:text-red-700 font-medium"
                      >
                        {t('reupload')} ↑
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="mt-12 pb-6">
        <p className="text-center text-[11px] text-gray-300">{t('poweredBy')}</p>
      </div>

      {/* ── Lightbox Modal ── */}
      {lightboxDoc && lightboxDocObj && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setLightboxDoc(null)}
        >
          <div
            className="relative max-w-4xl w-full max-h-[90vh] bg-white rounded-2xl overflow-hidden shadow-2xl flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Lightbox header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <div>
                <p className="font-semibold text-gray-900">{lightboxDocObj.documentTypeName}</p>
                {lightboxDocObj.fileName && (
                  <p className="text-xs text-gray-400">{lightboxDocObj.fileName}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {previewUrls[lightboxDoc] && (
                  <a
                    href={previewUrls[lightboxDoc]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                  >
                    <Download className="w-4 h-4" />
                  </a>
                )}
                <button
                  onClick={() => setLightboxDoc(null)}
                  className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Lightbox content */}
            <div className="flex-1 overflow-auto flex items-center justify-center bg-gray-50 min-h-[300px]">
              {isPreviewableImage(lightboxDocObj.fileType) && previewUrls[lightboxDoc] ? (
                <img
                  src={previewUrls[lightboxDoc]}
                  alt={lightboxDocObj.documentTypeName}
                  className="max-w-full max-h-[70vh] object-contain"
                />
              ) : isPreviewablePdf(lightboxDocObj.fileType) && previewUrls[lightboxDoc] ? (
                <iframe
                  src={previewUrls[lightboxDoc]}
                  className="w-full h-[70vh]"
                  title={lightboxDocObj.documentTypeName}
                />
              ) : (
                <div className="text-center p-8">
                  <FileText className="w-16 h-16 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500">{lightboxDocObj.fileName}</p>
                  {previewUrls[lightboxDoc] && (
                    <a
                      href={previewUrls[lightboxDoc]}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 hover:underline mt-2 inline-block"
                    >
                      {isHebrew ? 'פתח בחלון חדש' : 'Open in new tab'}
                    </a>
                  )}
                </div>
              )}
            </div>

            {/* Lightbox nav arrows */}
            {documents.filter(d => previewUrls[d.id]).length > 1 && (
              <>
                <button
                  className="absolute start-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 shadow-lg flex items-center justify-center text-gray-600 hover:bg-white transition-colors"
                  onClick={() => {
                    const uploadedDocs = documents.filter(d => previewUrls[d.id])
                    const curIdx = uploadedDocs.findIndex(d => d.id === lightboxDoc)
                    const prevIdx = (curIdx - 1 + uploadedDocs.length) % uploadedDocs.length
                    setLightboxDoc(uploadedDocs[prevIdx].id)
                  }}
                >
                  {isHebrew ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
                </button>
                <button
                  className="absolute end-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 shadow-lg flex items-center justify-center text-gray-600 hover:bg-white transition-colors"
                  onClick={() => {
                    const uploadedDocs = documents.filter(d => previewUrls[d.id])
                    const curIdx = uploadedDocs.findIndex(d => d.id === lightboxDoc)
                    const nextIdx = (curIdx + 1) % uploadedDocs.length
                    setLightboxDoc(uploadedDocs[nextIdx].id)
                  }}
                >
                  {isHebrew ? <ChevronLeft className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
