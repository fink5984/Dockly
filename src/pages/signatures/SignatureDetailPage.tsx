import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useI18n } from '@/contexts/I18nContext'
import { useAuth } from '@/contexts/AuthContext'
import { useApp } from '@/contexts/AppContext'
import { Card, CardHeader, CardContent } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Modal } from '@/components/ui/Modal'
import { cn, formatDate, formatFileSize } from '@/lib/utils'
import {
  getSignatureRequestById,
  cancelSignatureRequest,
  deleteSignatureRequest,
  getSignatureDocumentUrl,
  generateAndDownloadSignedPdf,
  ensureSignedPdfExists,
  getSignatureDocuments,
} from '@/services/signaturesService'
import { supabase } from '@/lib/supabase'
import {
  ArrowLeft, ArrowRight, PenLine, FileText, Copy, Eye, Trash2,
  XCircle, CheckCircle2, Clock, AlertTriangle, Loader2, Download,
  Calendar, User, ExternalLink, Shield,
  MoreHorizontal, Image,
} from 'lucide-react'
import type { SignatureRequest, SignatureRequestStatus } from '@/types'

const statusConfig: Record<SignatureRequestStatus, { color: string; icon: typeof CheckCircle2; bgColor: string }> = {
  draft: { color: 'text-gray-600', icon: FileText, bgColor: 'bg-gray-100 dark:bg-gray-700' },
  pending: { color: 'text-amber-600', icon: Clock, bgColor: 'bg-amber-100 dark:bg-amber-900/30' },
  viewed: { color: 'text-blue-600', icon: Eye, bgColor: 'bg-blue-100 dark:bg-blue-900/30' },
  signed: { color: 'text-green-600', icon: CheckCircle2, bgColor: 'bg-green-100 dark:bg-green-900/30' },
  declined: { color: 'text-red-600', icon: XCircle, bgColor: 'bg-red-100 dark:bg-red-900/30' },
  expired: { color: 'text-orange-600', icon: AlertTriangle, bgColor: 'bg-orange-100 dark:bg-orange-900/30' },
  cancelled: { color: 'text-gray-500', icon: XCircle, bgColor: 'bg-gray-100 dark:bg-gray-700' },
}

interface SignatureDoc {
  id: string
  requestId: string
  fileName: string
  storagePath: string
  fileType: string
  fileSize: number
  sortOrder: number
  signedStoragePath?: string
  createdAt: string
}

function getFileIcon(fileType: string) {
  if (fileType?.startsWith('image/')) return Image
  return FileText
}

function getFileExtColor(fileName: string) {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  if (ext === 'pdf') return 'text-red-500 bg-red-50 dark:bg-red-950/30'
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'text-blue-500 bg-blue-50 dark:bg-blue-950/30'
  if (['doc', 'docx'].includes(ext)) return 'text-indigo-500 bg-indigo-50 dark:bg-indigo-950/30'
  return 'text-gray-500 bg-gray-50 dark:bg-gray-800'
}

export function SignatureDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { t, direction } = useI18n()
  const navigate = useNavigate()
  const { addToast } = useApp()
  const { user, workspace } = useAuth()
  const wsId = workspace?.id || user?.workspaceId || ''
  const isRtl = direction === 'rtl'
  const BackIcon = isRtl ? ArrowRight : ArrowLeft

  const [request, setRequest] = useState<SignatureRequest | null>(null)
  const [loading, setLoading] = useState(true)
  const [docUrl, setDocUrl] = useState<string | null>(null)
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [acting, setActing] = useState(false)
  const [downloading, setDownloading] = useState(false)

  // Lightbox state
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [lightboxFileName, setLightboxFileName] = useState('')
  const [lightboxType, setLightboxType] = useState('')

  // Extra documents
  const [extraDocs, setExtraDocs] = useState<SignatureDoc[]>([])

  // Thumbnail URLs
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({})

  const fetchExtraDocs = useCallback(async () => {
    if (!id) return
    try {
      const docs = await getSignatureDocuments(id)
      setExtraDocs(docs)
    } catch { /* ignore - table might not exist yet */ }
  }, [id])

  useEffect(() => {
    if (!id) return
    setLoading(true)
    getSignatureRequestById(id)
      .then(async (r) => {
        if (!r) { setLoading(false); return }
        setRequest(r)

        // If signed: try to show the signed PDF (auto-generate if missing)
        if (r.status === 'signed') {
          try {
            const updated = await ensureSignedPdfExists(r)
            if (updated.signedDocumentPath) {
              setRequest(updated)
              const url = await getSignatureDocumentUrl(updated.signedDocumentPath)
              setDocUrl(url)
              setLoading(false)
              return
            }
          } catch (err) {
            console.warn('Could not load signed PDF, falling back to original', err)
          }
        }

        // Fallback: show original document
        if (r.documentStoragePath) {
          try {
            const url = await getSignatureDocumentUrl(r.documentStoragePath)
            setDocUrl(url)
          } catch {}
        }
      })
      .finally(() => setLoading(false))

    fetchExtraDocs()
  }, [id, fetchExtraDocs])

  // Load thumbnail URLs for image documents
  useEffect(() => {
    const loadThumbnails = async () => {
      if (!request) return
      const paths: { key: string; path: string }[] = []
      // Main document
      const mainPath = request.signedDocumentPath || request.documentStoragePath
      if (mainPath && isImageType(request.documentFileType)) {
        paths.push({ key: 'main', path: mainPath })
      }
      // Extra docs
      for (const doc of extraDocs) {
        if (isImageType(doc.fileType)) {
          paths.push({ key: doc.id, path: doc.storagePath })
        }
      }
      const urls: Record<string, string> = {}
      for (const p of paths) {
        try {
          const url = await getSignatureDocumentUrl(p.path)
          urls[p.key] = url
        } catch {}
      }
      setThumbnails(prev => ({ ...prev, ...urls }))
    }
    loadThumbnails()
  }, [request, extraDocs])

  const handleCopyLink = () => {
    if (!request) return
    const url = `${window.location.origin}/sign/${request.publicToken}`
    navigator.clipboard.writeText(url)
    addToast({ title: t('signatures.linkCopied'), type: 'success' })
  }

  const handleDownloadSigned = useCallback(async () => {
    if (!request) return
    setDownloading(true)
    try {
      await generateAndDownloadSignedPdf(request)
      addToast({ title: t('signatures.downloadComplete'), type: 'success' })
    } catch (err) {
      console.error('Failed to generate signed PDF:', err)
      addToast({ title: t('common.error'), type: 'error' })
    } finally {
      setDownloading(false)
    }
  }, [request, addToast, t])

  const handleCancel = async () => {
    if (!request) return
    setActing(true)
    try {
      await cancelSignatureRequest(request.id)
      setRequest(prev => prev ? { ...prev, status: 'cancelled' } : null)
      setShowCancelModal(false)
      addToast({ title: t('signatures.cancelled'), type: 'success' })
    } catch { /* ignore */ } finally { setActing(false) }
  }

  const handleDelete = async () => {
    if (!request) return
    setActing(true)
    try {
      await deleteSignatureRequest(request.id)
      navigate('/signatures')
    } catch { /* ignore */ } finally { setActing(false) }
  }

  // Open lightbox for a document
  const openLightbox = async (storagePath: string, fileName: string, fileType: string) => {
    try {
      const url = await getSignatureDocumentUrl(storagePath)
      setLightboxUrl(url)
      setLightboxFileName(fileName)
      setLightboxType(fileType)
    } catch {
      addToast({ type: 'error', title: t('common.error') })
    }
  }

  // Download a document
  const handleDownloadDoc = async (storagePath: string, fileName: string) => {
    try {
      const url = await getSignatureDocumentUrl(storagePath)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.target = '_blank'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } catch {
      addToast({ type: 'error', title: t('common.error') })
    }
  }

  const isImageType = (ft: string) =>
    ft?.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ft?.split('/').pop()?.toLowerCase() || '')

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
      </div>
    )
  }

  if (!request) {
    return (
      <div className="text-center py-20">
        <p className="text-[var(--text-tertiary)]">{t('signatures.invalidLink')}</p>
        <Button variant="outline" onClick={() => navigate('/signatures')} className="mt-4">
          {t('common.back')}
        </Button>
      </div>
    )
  }

  const sc = statusConfig[request.status]
  const StatusIcon = sc.icon
  const filledFields = request.fields.filter(f => f.value).length
  const totalFields = request.fields.length

  // Main document info
  const mainDoc = {
    id: 'main',
    fileName: request.documentFileName,
    storagePath: request.signedDocumentPath || request.documentStoragePath,
    fileType: request.documentFileType,
    fileSize: request.documentFileSize,
  }

  // Build unified docs list
  const allDocs = [mainDoc, ...extraDocs.map(d => ({
    id: d.id,
    fileName: d.fileName,
    storagePath: request.status === 'signed' && d.signedStoragePath ? d.signedStoragePath : d.storagePath,
    fileType: d.fileType,
    fileSize: d.fileSize,
    createdAt: d.createdAt,
  }))]

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-start gap-3">
        <button onClick={() => navigate('/signatures')} className="mt-1 p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors">
          <BackIcon className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
            <h1 className="text-xl font-bold truncate">{request.title}</h1>
            <Badge className={cn('text-xs px-2.5 py-1 rounded-full', sc.bgColor, sc.color)}>
              <StatusIcon className="w-3.5 h-3.5 me-1 inline" />
              {t(`signatures.${request.status}`)}
            </Badge>
          </div>
          <div className="flex items-center gap-4 text-xs text-[var(--text-tertiary)] mt-1">
            <span className="flex items-center gap-1"><User className="w-3 h-3" />{request.clientName}</span>
            <span className="font-mono">{request.id.slice(0, 8)}</span>
          </div>
        </div>
        <div className="flex gap-2 shrink-0 items-center">
          {(request.status === 'pending' || request.status === 'viewed') && (
            <>
              <Button variant="outline" size="sm" onClick={handleCopyLink} icon={<Copy className="w-3.5 h-3.5" />}>
                {t('signatures.copyLink')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(`/sign/${request.publicToken}`, '_blank')}
                icon={<ExternalLink className="w-3.5 h-3.5" />}
              >
                {t('signatures.signingPage')}
              </Button>
              <Button variant="outline" size="sm" className="text-amber-600" onClick={() => setShowCancelModal(true)}
                icon={<XCircle className="w-3.5 h-3.5" />}>
                {t('signatures.cancel')}
              </Button>
            </>
          )}
          {request.status === 'signed' && (
            <Button
              variant="outline" size="sm"
              icon={downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              onClick={handleDownloadSigned}
              disabled={downloading}
            >
              {t('signatures.downloadSigned')}
            </Button>
          )}
          {(request.status === 'signed' || request.status === 'cancelled' || request.status === 'expired') && (
            <Button
              variant="ghost" size="sm"
              icon={<Trash2 className="w-3.5 h-3.5" />}
              onClick={() => setShowDeleteModal(true)}
              className="text-[var(--text-tertiary)] hover:text-danger"
            >
              {t('signatures.delete')}
            </Button>
          )}
        </div>
      </div>

      {/* ── Top section: Progress + Info side by side ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Progress summary */}
        <Card className="lg:col-span-2">
          <CardContent className="py-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex-1">
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="font-medium">{t('signatures.fields')}</span>
                  <span className="tabular-nums font-bold text-lg">{totalFields > 0 ? Math.round((filledFields / totalFields) * 100) : 0}%</span>
                </div>
                <ProgressBar value={filledFields} max={totalFields} size="lg" />
              </div>
              <div className="flex gap-4 text-center shrink-0">
                <div className="px-3">
                  <p className="text-lg font-bold text-green-600">{filledFields}</p>
                  <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">{t('signatures.signed')}</p>
                </div>
                <div className="px-3 border-s border-[var(--border-primary)]">
                  <p className="text-lg font-bold text-gray-400">{totalFields - filledFields}</p>
                  <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">{t('common.remaining')}</p>
                </div>
                <div className="px-3 border-s border-[var(--border-primary)]">
                  <p className="text-lg font-bold text-blue-500">{allDocs.length}</p>
                  <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">{t('signatures.documents')}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Info card */}
        <Card>
          <CardContent className="py-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-tertiary)]">{t('signatures.createdAt')}</span>
                <span className="text-sm font-medium">{formatDate(request.createdAt)}</span>
              </div>
              {request.expiresAt && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--text-tertiary)]">{t('signatures.expiresAt')}</span>
                  <span className="text-sm font-medium flex items-center gap-1"><Calendar className="w-3 h-3" />{formatDate(request.expiresAt)}</span>
                </div>
              )}
              {request.signedAt && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--text-tertiary)]">{t('signatures.signedAt')}</span>
                  <span className="text-sm font-medium">{formatDate(request.signedAt)}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-tertiary)]">{t('signatures.client')}</span>
                <span className="text-sm font-medium">{request.clientName}</span>
              </div>
              {request.description && (
                <div className="pt-2 border-t border-[var(--border-primary)]">
                  <p className="text-xs text-[var(--text-tertiary)]">{t('signatures.description')}</p>
                  <p className="text-sm mt-0.5">{request.description}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Documents Grid ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold flex items-center gap-2">
            {t('signatures.documents')}
            {allDocs.length > 0 && (
              <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-indigo-100 text-indigo-700 text-[11px] font-bold dark:bg-indigo-900 dark:text-indigo-300">
                {allDocs.length}
              </span>
            )}
          </h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {allDocs.map((doc) => {
            const docDate = doc.id === 'main' ? request.createdAt : (doc as any).createdAt || request.createdAt
            const thumbKey = doc.id
            const isPdf = doc.fileType === 'application/pdf' || doc.fileType?.toLowerCase() === 'pdf'
            const isImage = isImageType(doc.fileType)

            return (
              <Card
                key={doc.id}
                hover
                onClick={() => openLightbox(doc.storagePath, doc.fileName, doc.fileType)}
                className="overflow-hidden cursor-pointer flex flex-col"
              >
                {/* Preview area */}
                <div className="relative aspect-[4/3] bg-[var(--bg-tertiary)] flex items-center justify-center overflow-hidden">
                  {isImage && thumbnails[thumbKey] ? (
                    <img src={thumbnails[thumbKey]} alt={doc.fileName} className="w-full h-full object-cover" />
                  ) : isPdf ? (
                    <div className="flex flex-col items-center text-[var(--text-tertiary)]">
                      <FileText className="w-10 h-10 mb-1 text-red-400" />
                      <span className="text-[10px] uppercase font-medium">PDF</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center text-[var(--text-tertiary)]">
                      {(() => { const FIcon = getFileIcon(doc.fileType); return <FIcon className="w-10 h-10 mb-1 opacity-50" /> })()}
                      <span className="text-[10px] uppercase font-medium">{doc.fileType?.split('/').pop() || '?'}</span>
                    </div>
                  )}
                  {/* Status badge overlay */}
                  <div className="absolute top-2 end-2">
                    <Badge className={cn('text-[10px] px-2 py-0.5 rounded', sc.bgColor, sc.color)}>
                      {t(`signatures.${request.status}`)}
                    </Badge>
                  </div>
                </div>

                {/* Document info */}
                <div className="p-3 flex-1">
                  <p className="text-sm font-medium truncate" title={doc.fileName}>{doc.fileName.split('.')[0]}</p>
                  {doc.fileName && (
                    <p className="text-xs text-[var(--text-tertiary)] truncate mt-0.5">{doc.fileName}</p>
                  )}
                  <p className="text-[10px] text-[var(--text-tertiary)] mt-1">{formatDate(docDate)}</p>
                </div>

                {/* Fixed bottom action bar */}
                <div className="border-t border-[var(--border-primary)] px-2 py-1.5 flex items-center justify-between">
                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); openLightbox(doc.storagePath, doc.fileName, doc.fileType) }}
                      className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                      title={t('signatures.viewDocument')}
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDownloadDoc(doc.storagePath, doc.fileName) }}
                      className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                      title={t('common.download')}
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  </div>
                  <button className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors">
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                </div>
              </Card>
            )
          })}
        </div>
      </div>

      {/* ── Document Lightbox ── */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 end-4 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors z-10"
          >
            <XCircle className="w-6 h-6" />
          </button>

          <div
            className="max-w-[90vw] max-h-[90vh] flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            {isImageType(lightboxType) ? (
              <img
                src={lightboxUrl}
                alt={lightboxFileName}
                className="max-w-full max-h-[90vh] object-contain rounded-lg"
              />
            ) : (
              <iframe
                src={`${lightboxUrl}#navpanes=0&toolbar=0&scrollbar=1&view=FitH`}
                className="w-[80vw] h-[85vh] rounded-lg bg-white"
                title={lightboxFileName}
              />
            )}
          </div>
        </div>
      )}

      {/* Cancel modal */}
      {showCancelModal && (
        <Modal open onClose={() => setShowCancelModal(false)} title={t('signatures.cancel')}>
          <p className="text-sm text-[var(--text-secondary)] mb-4">{t('signatures.cancelConfirm')}</p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setShowCancelModal(false)}>{t('common.cancel')}</Button>
            <Button variant="danger" onClick={handleCancel} disabled={acting}>
              {acting ? <Loader2 className="w-4 h-4 animate-spin" /> : t('common.confirm')}
            </Button>
          </div>
        </Modal>
      )}

      {/* Delete modal */}
      {showDeleteModal && (
        <Modal open onClose={() => setShowDeleteModal(false)} title={t('signatures.delete')}>
          <p className="text-sm text-[var(--text-secondary)] mb-4">{t('signatures.deleteConfirm')}</p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setShowDeleteModal(false)}>{t('common.cancel')}</Button>
            <Button variant="danger" onClick={handleDelete} disabled={acting}>
              {acting ? <Loader2 className="w-4 h-4 animate-spin" /> : t('common.confirm')}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
