import { useState, useEffect, useCallback } from 'react'
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
  Upload, CheckCircle2, XCircle, Clock, FileText, AlertTriangle,
  Loader2, Shield, ArrowUpCircle, Camera, File, Eye, RefreshCw,
  ChevronDown, ChevronUp, Image, FileIcon,
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
  const [expandedPreview, setExpandedPreview] = useState<string | null>(null)
  const [loadingPreviews, setLoadingPreviews] = useState(false)

  // Detect language from browser
  const isHebrew = navigator.language.startsWith('he')
  const dir = isHebrew ? 'rtl' : 'ltr'

  const t = useCallback((key: string) => {
    const translations: Record<string, Record<string, string>> = {
      en: {
        title: 'Document Upload Portal',
        subtitle: 'Upload your required documents securely',
        caseLabel: 'Case',
        notFound: 'Page not found',
        notFoundDesc: 'This link is not valid. Please check the link or contact your service provider.',
        required: 'Required',
        optional: 'Optional',
        upload: 'Upload',
        uploading: 'Uploading...',
        uploaded: 'Uploaded',
        approved: 'Approved',
        rejected: 'Needs Re-upload',
        underReview: 'Under Review',
        pending: 'Pending',
        missing: 'Missing',
        dragDrop: 'Drag & drop or click to upload',
        maxSize: 'Max file size',
        formats: 'Accepted formats',
        secureUpload: 'Your files are encrypted and securely stored',
        poweredBy: 'Powered by Dockly',
        remaining: 'documents remaining',
        allUploaded: 'All documents uploaded',
        takePhoto: 'Take Photo',
        chooseFile: 'Choose File',
        errorSize: 'File too large. Maximum size is',
        errorFormat: 'Invalid file format. Accepted formats:',
        errorUpload: 'Upload failed. Please try again.',
        preview: 'Preview',
        hidePreview: 'Hide Preview',
        uploadedOn: 'Uploaded on',
        progress: 'Progress',
        reupload: 'Upload Again',
        completed: 'Completed',
        refreshStatus: 'Refresh',
        fileDetails: 'File details',
      },
      he: {
        title: 'פורטל העלאת מסמכים',
        subtitle: 'העלה את המסמכים הנדרשים בצורה מאובטחת',
        caseLabel: 'תיק',
        notFound: 'עמוד לא נמצא',
        notFoundDesc: 'קישור זה אינו תקף. אנא בדוק את הקישור או פנה לספק השירות.',
        required: 'חובה',
        optional: 'אופציונלי',
        upload: 'העלאה',
        uploading: 'מעלה...',
        uploaded: 'הועלה',
        approved: 'אושר',
        rejected: 'דורש העלאה מחדש',
        underReview: 'בבדיקה',
        pending: 'ממתין',
        missing: 'חסר',
        dragDrop: 'גרור ושחרר או לחץ להעלאה',
        maxSize: 'גודל קובץ מקסימלי',
        formats: 'פורמטים מקובלים',
        secureUpload: 'הקבצים שלך מוצפנים ומאוחסנים בצורה מאובטחת',
        poweredBy: 'מופעל על ידי Dockly',
        remaining: 'מסמכים נותרו',
        allUploaded: 'כל המסמכים הועלו',
        takePhoto: 'צלם תמונה',
        chooseFile: 'בחר קובץ',
        errorSize: 'הקובץ גדול מדי. גודל מקסימלי הוא',
        errorFormat: 'פורמט קובץ לא תקין. פורמטים מקובלים:',
        errorUpload: 'ההעלאה נכשלה. נסה שוב.',
        preview: 'תצוגה מקדימה',
        hidePreview: 'הסתר תצוגה מקדימה',
        uploadedOn: 'הועלה בתאריך',
        progress: 'התקדמות',
        reupload: 'העלה שוב',
        completed: 'הושלם',
        refreshStatus: 'רענן',
        fileDetails: 'פרטי קובץ',
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

  const getStatusBadge = (doc: PublicDocument) => {
    if (justUploaded[doc.id] || doc.status === 'uploaded' || doc.status === 'received') {
      return { label: t('uploaded'), bg: 'bg-blue-100 text-blue-700', icon: CheckCircle2 }
    }
    if (doc.status === 'approved') {
      return { label: t('approved'), bg: 'bg-green-100 text-green-700', icon: CheckCircle2 }
    }
    if (doc.status === 'under-review') {
      return { label: t('underReview'), bg: 'bg-indigo-100 text-indigo-700', icon: Eye }
    }
    if (doc.status === 'rejected' || doc.status === 'blurry' || doc.status === 'missing-pages') {
      return { label: t('rejected'), bg: 'bg-red-100 text-red-700', icon: AlertTriangle }
    }
    return { label: doc.isRequired ? t('required') : t('optional'), bg: doc.isRequired ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600', icon: null }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleDateString(isHebrew ? 'he-IL' : 'en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  const isPreviewableImage = (fileType?: string) =>
    fileType?.startsWith('image/')

  const isPreviewablePdf = (fileType?: string) =>
    fileType === 'application/pdf'

  // ---- LOADING ----
  if (state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-blue-50" dir={dir}>
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">{isHebrew ? 'טוען...' : 'Loading...'}</p>
        </div>
      </div>
    )
  }

  // ---- NOT FOUND ----
  if (state === 'not-found') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-blue-50 p-4" dir={dir}>
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
            <XCircle className="w-8 h-8 text-red-500" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">{t('notFound')}</h1>
          <p className="text-gray-500 text-sm">{t('notFoundDesc')}</p>
        </div>
      </div>
    )
  }

  // ---- MAIN PORTAL ----
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50" dir={dir}>
      {/* Header */}
      <div className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-5">
          <div className="flex items-center gap-3">
            {caseInfo?.workspaceLogo ? (
              <img src={caseInfo.workspaceLogo} alt="" className="w-10 h-10 rounded-xl object-cover" />
            ) : (
              <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
                <FileText className="w-5 h-5 text-blue-600" />
              </div>
            )}
            <div>
              <h1 className="text-lg font-bold text-gray-900">{caseInfo?.workspaceName}</h1>
              <p className="text-xs text-gray-500">
                {t('caseLabel')}: {caseInfo?.caseType}
              </p>
            </div>
          </div>
          {caseInfo?.clientName && (
            <p className="text-sm text-gray-600 mt-3">
              {isHebrew ? `שלום ${caseInfo.clientName}` : `Hello ${caseInfo.clientName}`} 👋
            </p>
          )}
          <p className="text-sm text-gray-500 mt-1">{t('subtitle')}</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
            <span className="font-medium">
              {t('progress')}: {doneCount} / {totalCount}
            </span>
            <div className="flex items-center gap-2">
              <span>
                {pendingCount > 0
                  ? `${pendingCount} ${t('remaining')}`
                  : t('allUploaded')}
              </span>
              <button
                onClick={loadData}
                className="p-1 rounded hover:bg-gray-100 transition-colors"
                title={t('refreshStatus')}
              >
                <RefreshCw className="w-3.5 h-3.5 text-gray-400" />
              </button>
            </div>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2.5">
            <div
              className={`h-2.5 rounded-full transition-all duration-500 ${
                pendingCount === 0 ? 'bg-green-500' : 'bg-blue-500'
              }`}
              style={{ width: `${totalCount > 0 ? (doneCount / totalCount) * 100 : 0}%` }}
            />
          </div>
        </div>
      </div>

      {/* All done banner */}
      {pendingCount === 0 && totalCount > 0 && (
        <div className="max-w-2xl mx-auto px-4 mt-4">
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="font-semibold text-green-800 text-sm">{t('allUploaded')}</p>
              <p className="text-green-600 text-xs mt-0.5">
                {isHebrew
                  ? 'תודה! כל המסמכים הועלו בהצלחה.'
                  : 'Thank you! All documents have been uploaded successfully.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Document list */}
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {documents.map(doc => {
          const uploaded = isDocUploaded(doc)
          const showUploadArea = needsUpload(doc) && !justUploaded[doc.id]
          const isUploadingDoc = uploading[doc.id]
          const error = errors[doc.id]
          const badge = getStatusBadge(doc)
          const hasPreview = previewUrls[doc.id]
          const isExpanded = expandedPreview === doc.id

          return (
            <div
              key={doc.id}
              className={`bg-white rounded-xl border-2 transition-all shadow-sm ${
                uploaded
                  ? doc.status === 'approved'
                    ? 'border-green-200'
                    : doc.status === 'rejected' || doc.status === 'blurry' || doc.status === 'missing-pages'
                      ? 'border-red-200'
                      : 'border-blue-200'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="p-4">
                {/* Header row */}
                <div className="flex items-start justify-between mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    {uploaded ? (
                      doc.status === 'approved' ? (
                        <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
                      ) : doc.status === 'rejected' || doc.status === 'blurry' || doc.status === 'missing-pages' ? (
                        <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
                      ) : (
                        <CheckCircle2 className="w-5 h-5 text-blue-500 shrink-0" />
                      )
                    ) : (
                      <ArrowUpCircle className="w-5 h-5 text-gray-400 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="font-medium text-sm text-gray-900 truncate">{doc.documentTypeName}</p>
                      {doc.category && (
                        <p className="text-[10px] text-gray-400 uppercase tracking-wider">{doc.category}</p>
                      )}
                    </div>
                  </div>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ${badge.bg}`}>
                    {badge.label}
                  </span>
                </div>

                {/* Helper text */}
                {doc.helperText && (
                  <p className="text-xs text-gray-500 mt-1 ms-7">{doc.helperText}</p>
                )}

                {/* Uploaded file info + preview */}
                {uploaded && doc.fileName && (
                  <div className="mt-3 ms-7">
                    <div className="flex items-center justify-between bg-gray-50 rounded-lg p-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        {isPreviewableImage(doc.fileType) ? (
                          <Image className="w-4 h-4 text-blue-500 shrink-0" />
                        ) : (
                          <FileIcon className="w-4 h-4 text-gray-500 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-gray-700 truncate">{doc.fileName}</p>
                          <p className="text-[10px] text-gray-400">
                            {doc.fileSize ? formatFileSize(doc.fileSize) : ''}
                            {doc.uploadedAt && (
                              <> • {t('uploadedOn')} {formatDate(doc.uploadedAt)}</>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {hasPreview && (
                          <button
                            onClick={() => setExpandedPreview(isExpanded ? null : doc.id)}
                            className="flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-800 px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                          >
                            <Eye className="w-3 h-3" />
                            {isExpanded ? t('hidePreview') : t('preview')}
                            {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Preview area */}
                    {isExpanded && hasPreview && (
                      <div className="mt-2 rounded-lg overflow-hidden border border-gray-200 bg-gray-100">
                        {isPreviewableImage(doc.fileType) ? (
                          <img
                            src={previewUrls[doc.id]}
                            alt={doc.fileName}
                            className="w-full max-h-96 object-contain"
                          />
                        ) : isPreviewablePdf(doc.fileType) ? (
                          <iframe
                            src={previewUrls[doc.id]}
                            className="w-full h-96"
                            title={doc.fileName}
                          />
                        ) : (
                          <div className="p-8 text-center">
                            <FileIcon className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                            <p className="text-sm text-gray-500">{doc.fileName}</p>
                            <a
                              href={previewUrls[doc.id]}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-600 hover:underline mt-1 inline-block"
                            >
                              {isHebrew ? 'פתח בחלון חדש' : 'Open in new tab'}
                            </a>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Re-upload button for rejected docs */}
                    {(doc.status === 'rejected' || doc.status === 'blurry' || doc.status === 'missing-pages') && !justUploaded[doc.id] && (
                      <div className="mt-2">
                        <p className="text-xs text-red-600 mb-2">
                          {isHebrew
                            ? 'המסמך נדחה. אנא העלה מסמך חדש.'
                            : 'This document was rejected. Please upload a new one.'}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Upload area */}
                {showUploadArea && (
                  <div className="mt-3 ms-7">
                    {isUploadingDoc ? (
                      <div className="flex items-center justify-center gap-2 p-6 border-2 border-dashed border-blue-300 rounded-xl bg-blue-50">
                        <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                        <span className="text-sm text-blue-600">{t('uploading')}</span>
                      </div>
                    ) : (
                      <>
                        <label className="flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-colors">
                          <Upload className="w-6 h-6 text-gray-400" />
                          <span className="text-sm text-gray-500">{t('dragDrop')}</span>
                          <div className="flex gap-2 mt-1">
                            <span className="flex items-center gap-1 text-[10px] bg-gray-100 px-2 py-0.5 rounded text-gray-500">
                              <File className="w-3 h-3" /> {t('chooseFile')}
                            </span>
                            <span className="flex items-center gap-1 text-[10px] bg-gray-100 px-2 py-0.5 rounded text-gray-500">
                              <Camera className="w-3 h-3" /> {t('takePhoto')}
                            </span>
                          </div>
                          <input
                            type="file"
                            className="hidden"
                            accept={doc.allowedFormats.map(f => `.${f}`).join(',')}
                            capture="environment"
                            onChange={e => {
                              const file = e.target.files?.[0]
                              if (file) handleFileUpload(doc.id, file, doc)
                            }}
                          />
                        </label>
                        <div className="flex items-center gap-3 mt-2 text-[10px] text-gray-400">
                          <span>{t('formats')}: {doc.allowedFormats.join(', ').toUpperCase()}</span>
                          <span>•</span>
                          <span>{t('maxSize')}: {doc.maxSizeMB}MB</span>
                        </div>
                      </>
                    )}
                    {error && (
                      <p className="text-xs text-red-500 mt-2 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> {error}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div className="bg-white border-t border-gray-200 mt-8">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
            <Shield className="w-3.5 h-3.5" />
            <span>{t('secureUpload')}</span>
          </div>
          <p className="text-center text-[10px] text-gray-300 mt-2">{t('poweredBy')}</p>
        </div>
      </div>
    </div>
  )
}
