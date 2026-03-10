import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import {
  validateUploadToken,
  getPortalDocuments,
  uploadFromPortal,
  markTokenUsed,
  type UploadPortalDocument,
  type UploadTokenInfo,
} from '@/services/whatsappService'
import {
  Upload, CheckCircle2, XCircle, Clock, FileText, AlertTriangle,
  Loader2, Shield, ArrowUpCircle, Camera, File
} from 'lucide-react'

type PortalState = 'loading' | 'valid' | 'expired' | 'used' | 'not-found' | 'completed'

export function ClientUploadPortal() {
  const { token } = useParams<{ token: string }>()
  const [state, setState] = useState<PortalState>('loading')
  const [tokenInfo, setTokenInfo] = useState<UploadTokenInfo | null>(null)
  const [documents, setDocuments] = useState<UploadPortalDocument[]>([])
  const [uploading, setUploading] = useState<Record<string, boolean>>({})
  const [uploaded, setUploaded] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [workspaceName, setWorkspaceName] = useState('')
  const [clientName, setClientName] = useState('')

  // Detect language from browser
  const isHebrew = navigator.language.startsWith('he')
  const dir = isHebrew ? 'rtl' : 'ltr'

  const t = useCallback((key: string) => {
    const translations: Record<string, Record<string, string>> = {
      en: {
        title: 'Document Upload Portal',
        subtitle: 'Upload your required documents securely',
        expired: 'This upload link has expired',
        expiredDesc: 'Please contact your service provider for a new link.',
        used: 'This link has already been used',
        usedDesc: 'If you need to upload additional documents, please request a new link.',
        notFound: 'Invalid upload link',
        notFoundDesc: 'This link is not valid. Please check the link or contact your service provider.',
        completed: 'All documents uploaded!',
        completedDesc: 'Thank you! All required documents have been uploaded successfully. You can close this page.',
        required: 'Required',
        optional: 'Optional',
        upload: 'Upload',
        uploading: 'Uploading...',
        uploaded: 'Uploaded',
        pending: 'Pending',
        rejected: 'Needs Re-upload',
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
      },
      he: {
        title: 'פורטל העלאת מסמכים',
        subtitle: 'העלה את המסמכים הנדרשים בצורה מאובטחת',
        expired: 'קישור ההעלאה פג תוקף',
        expiredDesc: 'אנא פנה לספק השירות שלך לקבלת קישור חדש.',
        used: 'קישור זה כבר נוצל',
        usedDesc: 'אם עליך להעלות מסמכים נוספים, אנא בקש קישור חדש.',
        notFound: 'קישור העלאה לא תקין',
        notFoundDesc: 'קישור זה אינו תקף. אנא בדוק את הקישור או פנה לספק השירות.',
        completed: 'כל המסמכים הועלו!',
        completedDesc: 'תודה! כל המסמכים הנדרשים הועלו בהצלחה. ניתן לסגור עמוד זה.',
        required: 'חובה',
        optional: 'אופציונלי',
        upload: 'העלאה',
        uploading: 'מעלה...',
        uploaded: 'הועלה',
        pending: 'ממתין',
        rejected: 'דורש העלאה מחדש',
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
      },
    }
    return translations[isHebrew ? 'he' : 'en'][key] || key
  }, [isHebrew])

  useEffect(() => {
    if (!token) {
      setState('not-found')
      return
    }

    async function init() {
      try {
        const info = await validateUploadToken(token!)
        setTokenInfo(info)

        if (!info.valid) {
          setState(info.expired ? 'expired' : info.used ? 'used' : 'not-found')
          return
        }

        // Fetch documents
        const docs = await getPortalDocuments(info.caseId)
        setDocuments(docs)

        // Pre-mark already uploaded docs
        const alreadyUploaded: Record<string, boolean> = {}
        docs.forEach(doc => {
          if (!['missing', 'pending-upload', 'rejected'].includes(doc.status)) {
            alreadyUploaded[doc.id] = true
          }
        })
        setUploaded(alreadyUploaded)

        // Fetch workspace name
        const { data: ws } = await supabase
          .from('workspaces')
          .select('name')
          .eq('id', info.workspaceId)
          .single()
        if (ws) setWorkspaceName(ws.name)

        // Fetch client name
        const { data: client } = await supabase
          .from('clients')
          .select('name')
          .eq('id', info.clientId)
          .single()
        if (client) setClientName(client.name)

        setState('valid')
      } catch {
        setState('not-found')
      }
    }

    init()
  }, [token])

  const handleFileUpload = async (docId: string, file: File, doc: UploadPortalDocument) => {
    if (!tokenInfo) return

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
      await uploadFromPortal(
        tokenInfo.workspaceId,
        tokenInfo.caseId,
        docId,
        file,
        tokenInfo.clientId
      )
      setUploaded(prev => ({ ...prev, [docId]: true }))

      // Check if all required docs are uploaded
      const newUploaded = { ...uploaded, [docId]: true }
      const pendingDocs = documents.filter(
        d => d.isRequired && ['missing', 'pending-upload', 'rejected'].includes(d.status) && !newUploaded[d.id]
      )
      if (pendingDocs.length === 0) {
        await markTokenUsed(token!)
        setState('completed')
      }
    } catch {
      setErrors(prev => ({ ...prev, [docId]: t('errorUpload') }))
    } finally {
      setUploading(prev => ({ ...prev, [docId]: false }))
    }
  }

  const pendingCount = documents.filter(
    d => ['missing', 'pending-upload', 'rejected'].includes(d.status) && !uploaded[d.id]
  ).length

  // ---- Render error states ----
  if (state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50" dir={dir}>
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-green-500 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">{isHebrew ? 'טוען...' : 'Loading...'}</p>
        </div>
      </div>
    )
  }

  if (state === 'expired' || state === 'used' || state === 'not-found') {
    const config = {
      expired: { icon: Clock, color: 'text-amber-500', bg: 'bg-amber-50', title: t('expired'), desc: t('expiredDesc') },
      used: { icon: CheckCircle2, color: 'text-blue-500', bg: 'bg-blue-50', title: t('used'), desc: t('usedDesc') },
      'not-found': { icon: XCircle, color: 'text-red-500', bg: 'bg-red-50', title: t('notFound'), desc: t('notFoundDesc') },
    }[state]

    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4" dir={dir}>
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className={`w-16 h-16 rounded-full ${config.bg} flex items-center justify-center mx-auto mb-4`}>
            <config.icon className={`w-8 h-8 ${config.color}`} />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">{config.title}</h1>
          <p className="text-gray-500 text-sm">{config.desc}</p>
        </div>
      </div>
    )
  }

  if (state === 'completed') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4" dir={dir}>
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className="w-20 h-20 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-10 h-10 text-green-500" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">{t('completed')}</h1>
          <p className="text-gray-500 text-sm">{t('completedDesc')}</p>
          {workspaceName && (
            <p className="text-xs text-gray-400 mt-6">{workspaceName}</p>
          )}
        </div>
      </div>
    )
  }

  // ---- Main upload portal ----
  return (
    <div className="min-h-screen bg-gray-50" dir={dir}>
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-4 py-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
              <FileText className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">{t('title')}</h1>
              <p className="text-xs text-gray-500">{workspaceName}</p>
            </div>
          </div>
          {clientName && (
            <p className="text-sm text-gray-600 mt-3">
              {isHebrew ? `שלום ${clientName}` : `Hello ${clientName}`} 👋
            </p>
          )}
          <p className="text-sm text-gray-500 mt-1">{t('subtitle')}</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
            <span>
              {documents.length - pendingCount} / {documents.length}
            </span>
            <span>
              {pendingCount > 0 ? `${pendingCount} ${t('remaining')}` : t('allUploaded')}
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-green-500 h-2 rounded-full transition-all duration-500"
              style={{ width: `${documents.length > 0 ? ((documents.length - pendingCount) / documents.length) * 100 : 0}%` }}
            />
          </div>
        </div>
      </div>

      {/* Document list */}
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {documents.map(doc => {
          const isUploaded = uploaded[doc.id] || !['missing', 'pending-upload', 'rejected'].includes(doc.status)
          const isRejected = doc.status === 'rejected'
          const isUploadingDoc = uploading[doc.id]
          const error = errors[doc.id]

          return (
            <div
              key={doc.id}
              className={`bg-white rounded-xl border-2 ${
                isUploaded
                  ? 'border-green-200 bg-green-50/50'
                  : isRejected
                    ? 'border-red-200 bg-red-50/50'
                    : 'border-gray-200'
              } overflow-hidden transition-all`}
            >
              <div className="p-4">
                {/* Header */}
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {isUploaded ? (
                      <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
                    ) : isRejected ? (
                      <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
                    ) : (
                      <ArrowUpCircle className="w-5 h-5 text-gray-400 shrink-0" />
                    )}
                    <div>
                      <p className="font-medium text-sm text-gray-900">{doc.documentTypeName}</p>
                      {doc.helperText && (
                        <p className="text-xs text-gray-500 mt-0.5">{doc.helperText}</p>
                      )}
                    </div>
                  </div>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                    isUploaded
                      ? 'bg-green-100 text-green-700'
                      : isRejected
                        ? 'bg-red-100 text-red-700'
                        : doc.isRequired
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-gray-100 text-gray-600'
                  }`}>
                    {isUploaded ? t('uploaded') : isRejected ? t('rejected') : doc.isRequired ? t('required') : t('optional')}
                  </span>
                </div>

                {/* Upload area */}
                {!isUploaded && (
                  <div className="mt-3">
                    {isUploadingDoc ? (
                      <div className="flex items-center justify-center gap-2 p-6 border-2 border-dashed border-green-300 rounded-xl bg-green-50">
                        <Loader2 className="w-5 h-5 animate-spin text-green-500" />
                        <span className="text-sm text-green-600">{t('uploading')}</span>
                      </div>
                    ) : (
                      <>
                        <label className="flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-green-400 hover:bg-green-50/50 transition-colors">
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
