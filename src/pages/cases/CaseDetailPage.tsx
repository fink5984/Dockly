import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useI18n } from '@/contexts/I18nContext'
import { Card, CardHeader, CardContent } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Input, Textarea } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { cn, formatFileSize, getStatusColor, getDocStatusKey, formatDate } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { useApp } from '@/contexts/AppContext'
import { useRealtimeData } from '@/hooks/useRealtimeData'
import { getCases, updateCase, deleteCase, addCaseDocument, updateCaseDocument } from '@/services/casesService'
import { createActivity } from '@/services/activityService'
import { getSupportRequestsByCaseId, createSupportRequest, sendSupportReplyViaWhatsApp, updateSupportRequest, markClientMessagesAsRead } from '@/services/supportService'
import { getClientById } from '@/services/clientsService'
import { sendDocumentRequest } from '@/services/whatsappService'
import { SendActionButton } from '@/components/cases/SendActionButton'
import {
  ArrowLeft, ArrowRight, Copy, Send, Bell, Calendar, User, Clock, FileText, CheckCircle2, XCircle, AlertTriangle,
  UploadCloud, Eye, Download, RotateCcw, MessageCircle, Link2, MoreHorizontal, Loader2, Edit2, Trash2, Save
} from 'lucide-react'
import { getDocumentTypes } from '@/services/documentsService'
import { getSignedUrl, downloadFile } from '@/services/storageService'
import type { CaseDocument, DocumentStatus } from '@/types'

const statusIcons: Record<DocumentStatus, typeof CheckCircle2> = {
  missing: XCircle,
  'pending-upload': UploadCloud,
  uploaded: UploadCloud,
  received: UploadCloud,
  'under-review': Eye,
  approved: CheckCircle2,
  rejected: AlertTriangle,
  expired: Clock,
  blurry: AlertTriangle,
  'missing-pages': AlertTriangle,
}

const statusColors: Record<DocumentStatus, string> = {
  missing: 'text-gray-400',
  'pending-upload': 'text-amber-500',
  uploaded: 'text-blue-500',
  received: 'text-blue-500',
  'under-review': 'text-indigo-500',
  approved: 'text-green-500',
  rejected: 'text-red-500',
  expired: 'text-orange-500',
  blurry: 'text-red-400',
  'missing-pages': 'text-red-400',
}

export function CaseDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { t, direction, language } = useI18n()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [chatMessage, setChatMessage] = useState('')
  const [sendingChat, setSendingChat] = useState(false)
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null)
  const [lightboxDoc, setLightboxDoc] = useState<string | null>(null)
  const [docMenuOpen, setDocMenuOpen] = useState<string | null>(null)
  const [showSupportModal, setShowSupportModal] = useState(false)
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})
  const [urlsLoading, setUrlsLoading] = useState(true)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // Review mode (from CaseCreatePage redirect)
  const isReviewMode = searchParams.get('mode') === 'review'

  // Edit modal state
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editSaving, setEditSaving] = useState(false)

  // Delete modal state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Send state
  const [wasSent, setWasSent] = useState(false)

  // Add doc type modal
  const [addDocModalOpen, setAddDocModalOpen] = useState(false)
  const [addingDoc, setAddingDoc] = useState(false)

  // Edit form state (initialized with defaults, synced via useEffect)
  const [editForm, setEditForm] = useState({ caseType: '', notes: '', deadline: '' })

  const { user, workspace } = useAuth()
  const { addToast } = useApp()
  const wsId = workspace?.id || user?.workspaceId || ''

  const { data: allCases } = useRealtimeData(
    () => getCases(wsId),
    [],
    [wsId],
    { tables: ['cases', 'case_documents'] }
  )
  const { data: allDocumentTypes } = useRealtimeData(
    () => getDocumentTypes(wsId),
    [],
    [wsId],
    { tables: ['document_types'] }
  )

  // Fetch client data for WhatsApp
  const caseForClient = allCases.find(c => c.id === id)

  // Fetch support requests for THIS case (realtime)
  const { data: caseSupportRequests, refetch: refetchSupport } = useRealtimeData(
    () => caseForClient?.id ? getSupportRequestsByCaseId(caseForClient.id) : Promise.resolve([]),
    [],
    [caseForClient?.id],
    { tables: ['support_requests', 'support_messages'] }
  )

  const { data: clientData } = useRealtimeData(
    () => caseForClient?.clientId ? getClientById(caseForClient.clientId) : Promise.resolve(null),
    null,
    [caseForClient?.clientId],
    { tables: ['clients'] }
  )

  // Auto-scroll chat when messages change
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [caseSupportRequests])

  // Handle sending a support reply
  const handleSendSupportReply = useCallback(async (requestId: string) => {
    if (!chatMessage.trim() || sendingChat) return
    setSendingChat(true)
    try {
      const staffName = user?.name || 'צוות'
      await sendSupportReplyViaWhatsApp(requestId, staffName, chatMessage.trim())
      setChatMessage('')
      // Refetch to show the new message
      setTimeout(() => refetchSupport(), 500)
    } catch (err) {
      console.error('Failed to send support reply:', err)
    } finally {
      setSendingChat(false)
    }
  }, [chatMessage, sendingChat, user?.name, refetchSupport])

  // Handle creating a new support request
  const handleStartSupport = useCallback(async () => {
    if (!caseForClient) return
    try {
      await createSupportRequest({
        caseId: caseForClient.id,
        clientId: caseForClient.clientId,
        subject: `שיחת תמיכה – ${caseForClient.clientName}`,
        issueDescription: 'שיחת תמיכה שנפתחה מהמערכת',
      })
      setTimeout(() => refetchSupport(), 500)
    } catch (err) {
      console.error('Failed to create support request:', err)
    }
  }, [caseForClient, refetchSupport])

  // Handle closing a support request
  const handleCloseSupportRequest = useCallback(async (requestId: string) => {
    if (!clientData?.phone) {
      console.error('No client phone number')
      return
    }
    try {
      // Update status to resolved
      await updateSupportRequest(requestId, { status: 'resolved' })
      
      // Send closing message to client via WhatsApp
      await sendSupportReplyViaWhatsApp(
        requestId,
        'מערכת',
        '👋 פניית התמיכה נסגרה. \n\nאם יש לך שאלות נוספות, תמיד אפשר לשלוח "תמיכה" לפתוח פנייה חדשה. נשמח לעזור! 🙏'
      )
      
      // Close modal and refetch
      setShowSupportModal(false)
      setTimeout(() => refetchSupport(), 500)
    } catch (err) {
      console.error('Failed to close support request:', err)
    }
  }, [clientData?.phone, refetchSupport])

  // Fetch signed URLs for documents with storage paths
  useEffect(() => {
    if (!caseForClient?.requiredDocuments) return
    
    const loadSignedUrls = async () => {
      setUrlsLoading(true)
      const docsWithPaths = caseForClient.requiredDocuments.filter(d => d.storagePath)
      const urls: Record<string, string> = {}
      
      await Promise.all(
        docsWithPaths.map(async (doc) => {
          if (!doc.storagePath) return
          try {
            const url = await getSignedUrl(doc.storagePath)
            urls[doc.documentTypeId] = url
          } catch (err) {
            console.error('Failed to get signed URL for', doc.storagePath, err)
          }
        })
      )
      
      setSignedUrls(urls)
      setUrlsLoading(false)
    }
    
    loadSignedUrls()
  }, [caseForClient?.requiredDocuments])

  // Use first open support request from DB (real data)
  const supportRequest = caseSupportRequests.length > 0 ? caseSupportRequests[0] : null
  
  // Count unread messages from client - show indicator ONLY when status is waiting-for-staff
  const unreadClientMessages = (supportRequest?.status === 'waiting-for-staff' && supportRequest?.messages?.filter(
    msg => msg.senderType === 'client' && !msg.isRead
  ).length) || 0

  // Mark unread client messages as read when support modal opens
  useEffect(() => {
    if (showSupportModal && supportRequest && unreadClientMessages > 0) {
      markClientMessagesAsRead(supportRequest.id)
        .then(() => {
          // Refetch support data after a short delay to update UI
          setTimeout(() => refetchSupport(), 500)
        })
        .catch(err => console.error('Failed to mark messages as read:', err))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSupportModal, supportRequest?.id])

  const caseData = caseForClient
  const BackArrow = direction === 'rtl' ? ArrowRight : ArrowLeft

  // Sync edit form when caseData changes (must be before early return to obey Rules of Hooks)
  useEffect(() => {
    if (caseData) {
      setEditForm({
        caseType: caseData.caseType,
        notes: caseData.notes || '',
        deadline: caseData.deadline || '',
      })
    }
  }, [caseData?.caseType, caseData?.notes, caseData?.deadline])

  // Persist sent state from DB status — if case is no longer 'new', it was sent
  useEffect(() => {
    if (caseData && caseData.status !== 'new') {
      setWasSent(true)
    }
  }, [caseData?.status])

  if (!caseData) {
    return (
      <EmptyState
        icon={<FileText className="w-6 h-6" />}
        title={t('cases.notFound')}
        action={<Button onClick={() => navigate('/requests')}>{t('common.back')}</Button>}
      />
    )
  }

  const totalDocs = caseData.requiredDocuments.length
  const uploadedDocs = caseData.requiredDocuments.filter(d => !['missing', 'pending-upload'].includes(d.status)).length
  const missing = caseData.requiredDocuments.filter(d => ['missing', 'pending-upload'].includes(d.status)).length

  // Handler: save edits
  const handleEditSave = async () => {
    setEditSaving(true)
    try {
      await updateCase(caseData.id, {
        caseType: editForm.caseType,
        notes: editForm.notes,
        deadline: editForm.deadline || null,
      })
      addToast({ type: 'success', title: t('common.save') })
      setEditModalOpen(false)
    } catch (err: any) {
      addToast({ type: 'error', title: t('common.error'), message: err?.message })
    } finally {
      setEditSaving(false)
    }
  }

  // Handler: delete case
  const handleDelete = async () => {
    setDeleting(true)
    try {
      await deleteCase(caseData.id)
      await createActivity(wsId, {
        type: 'case-closed',
        description: `Deleted request "${caseData.caseType}"`,
        userId: user?.id || '',
        userName: user?.name || '',
        clientId: caseData.clientId,
        clientName: caseData.clientName,
      })
      addToast({ type: 'success', title: t('cases.deleteSuccess') })
      navigate('/requests')
    } catch (err: any) {
      addToast({ type: 'error', title: t('common.error'), message: err?.message })
    } finally {
      setDeleting(false)
      setDeleteModalOpen(false)
    }
  }

  // Handler: send initial (for SendActionButton)
  const handleSendInitial = async (channel: 'whatsapp'): Promise<boolean> => {
    if (channel === 'whatsapp' && clientData?.phone) {
      try {
        const result = await sendDocumentRequest({
          workspaceId: wsId,
          caseId: caseData.id,
          clientId: caseData.clientId,
          phoneNumber: clientData.phone,
          language: language as 'en' | 'he',
          messageType: 'initial',
        })
        if (result.success) {
          // Update case status so sent state persists across refresh
          await updateCase(caseData.id, { status: 'waiting-for-client' })
          addToast({ type: 'success', title: t('cases.waSentSuccess') })
          return true
        } else {
          addToast({ type: 'error', title: t('cases.waSentFailed'), message: result.error })
          return false
        }
      } catch (err: any) {
        addToast({ type: 'error', title: t('cases.waSentFailed'), message: err.message })
        return false
      }
    }
    return false
  }

  // Handler: send reminder
  const handleSendReminder = async () => {
    if (!clientData?.phone) return
    try {
      await sendDocumentRequest({
        workspaceId: wsId,
        caseId: caseData.id,
        clientId: caseData.clientId,
        phoneNumber: clientData.phone,
        language: language as 'en' | 'he',
        messageType: 'reminder',
      })
      addToast({ type: 'success', title: t('cases.reminderSent') })
    } catch (err: any) {
      addToast({ type: 'error', title: t('common.error'), message: err.message })
    }
  }

  // Handler: mark document as invalid → reset to missing + notify client via WhatsApp
  const handleMarkInvalid = async (doc: CaseDocument) => {
    try {
      // Reset document to 'missing' and clear file info
      await updateCaseDocument(doc.id, {
        status: 'missing',
        fileName: '',
        fileType: '',
        fileSize: 0,
        storagePath: '',
        storageStatus: 'error',
        rejectionReason: null,
      })
      // Recalculate case status based on remaining documents
      const otherDocs = caseData.requiredDocuments.filter(d => d.id !== doc.id)
      const stillUploaded = otherDocs.filter(d => !['missing', 'pending-upload'].includes(d.status)).length
      const totalCount = caseData.requiredDocuments.length
      let newStatus: string
      if (stillUploaded === 0) {
        newStatus = 'waiting-for-client'
      } else if (stillUploaded < totalCount - 1) {
        // -1 because the current doc is now missing
        newStatus = 'partial-submission'
      } else {
        newStatus = 'partial-submission'
      }
      await updateCase(caseData.id, { status: newStatus })
      // Notify client via WhatsApp
      if (clientData?.phone) {
        await sendDocumentRequest({
          workspaceId: wsId,
          caseId: caseData.id,
          clientId: caseData.clientId,
          phoneNumber: clientData.phone,
          language: language as 'en' | 'he',
          messageType: 'document_invalid',
        })
      }
      addToast({ type: 'success', title: t('documents.markedInvalid') })
    } catch (err: any) {
      addToast({ type: 'error', title: t('common.error'), message: err?.message })
    }
  }

  const isRtl = direction === 'rtl'

  return (
    <div className="space-y-6">
      {/* Review Banner */}
      {isReviewMode && (
        <div className="flex items-center justify-between p-4 rounded-xl border
          bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 mb-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            <div>
              <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                {t('cases.reviewBeforeSend')}
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-300 mt-0.5">
                {t('cases.reviewBeforeSendDesc')}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline" size="sm"
              icon={<Edit2 className="w-3.5 h-3.5" />}
              onClick={() => setEditModalOpen(true)}
            >
              {t('common.edit')}
            </Button>
            <Button
              size="sm"
              icon={<CheckCircle2 className="w-3.5 h-3.5" />}
              onClick={async () => {
                setSearchParams({})
                // Auto-send via WhatsApp on confirm
                const sent = await handleSendInitial('whatsapp')
                if (sent) setWasSent(true)
              }}
            >
              {t('cases.confirmAndContinue')}
            </Button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start gap-3">
        <button onClick={() => navigate('/requests')} className="mt-1 p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors">
          <BackArrow className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
            <h1 className="text-xl font-bold truncate">{caseData.clientName}</h1>
            <Badge variant="status" status={caseData.status}>
              {t(`cases.${caseData.status === 'waiting-for-client' ? 'waitingForClient' : caseData.status === 'partial-submission' ? 'partialSubmission' : caseData.status}`)}
            </Badge>
          </div>
          <div className="flex items-center gap-4 text-xs text-[var(--text-tertiary)] mt-1">
            <span className="font-mono">{caseData.id}</span>
            <span>{caseData.caseType}</span>
            <span className="flex items-center gap-1"><User className="w-3 h-3" />{caseData.assignedOwnerName}</span>
          </div>
        </div>
        <div className="flex gap-2 shrink-0 items-center">
          <div className="relative">
            <Button
              variant="outline"
              size="sm"
              icon={<MessageCircle className="w-3.5 h-3.5 text-blue-500" />}
              onClick={() => setShowSupportModal(true)}
            >
              {t('cases.supportTab')}
            </Button>
            {unreadClientMessages > 0 && (
              <span className="absolute -top-1 -end-1 w-3 h-3 rounded-full bg-red-500 border-2 border-white dark:border-gray-800 shadow-md" />
            )}
          </div>
          <SendActionButton
            caseId={caseData.id}
            clientName={caseData.clientName}
            clientPhone={clientData?.phone}
            workspaceId={wsId}
            clientId={caseData.clientId}
            language={language as 'en' | 'he'}
            onSend={handleSendInitial}
            onReminder={handleSendReminder}
            initialSent={wasSent}
          />
          <Button variant="outline" size="sm" icon={<Copy className="w-3.5 h-3.5" />}>{t('cases.duplicateCase')}</Button>
          <Button
            variant="outline"
            size="sm"
            icon={<Link2 className="w-3.5 h-3.5" />}
            onClick={() => {
              if (caseData.publicToken) {
                const url = `${window.location.origin}/p/${caseData.publicToken}`
                navigator.clipboard.writeText(url)
                addToast({ type: 'success', title: t('cases.linkCopied') })
              } else {
                addToast({ type: 'error', title: t('common.error'), message: 'No public token' })
              }
            }}
          >
            {t('cases.copyLink')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<Trash2 className="w-3.5 h-3.5" />}
            onClick={() => setDeleteModalOpen(true)}
            className="text-[var(--text-tertiary)] hover:text-danger"
          >
            {t('common.delete')}
          </Button>
        </div>
      </div>

      {/* ── Top section: Progress + Case Info side by side ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Progress summary */}
        <Card className="lg:col-span-2">
          <CardContent className="py-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex-1">
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="font-medium">{t('cases.overallProgress')}</span>
                  <span className="tabular-nums font-bold text-lg">{totalDocs > 0 ? Math.round((uploadedDocs / totalDocs) * 100) : 0}%</span>
                </div>
                <ProgressBar value={uploadedDocs} max={totalDocs} size="lg" />
              </div>
              <div className="flex gap-4 text-center shrink-0">
                <div className="px-3">
                  <p className="text-lg font-bold text-green-600">{uploadedDocs}</p>
                  <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">{t('documents.uploaded')}</p>
                </div>
                <div className="px-3 border-s border-[var(--border-primary)]">
                  <p className="text-lg font-bold text-gray-400">{missing}</p>
                  <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">{t('cases.missing')}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Case info */}
        <Card>
          <CardContent className="py-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-tertiary)]">{t('cases.createdAt')}</span>
                <span className="text-sm font-medium">{formatDate(caseData.createdAt)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-tertiary)]">{t('cases.lastActivity')}</span>
                <span className="text-sm font-medium">{formatDate(caseData.lastActivityDate) || '-'}</span>
              </div>
              {caseData.deadline && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--text-tertiary)]">{t('cases.deadline')}</span>
                  <span className="text-sm font-medium flex items-center gap-1"><Calendar className="w-3 h-3" />{formatDate(caseData.deadline)}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-tertiary)]">{t('cases.assignedTo')}</span>
                <span className="text-sm font-medium">{caseData.assignedOwnerName}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Documents Grid ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold flex items-center gap-2">
            {t('documents.title')}
            {uploadedDocs > 0 && (
              <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-green-100 text-green-700 text-[11px] font-bold dark:bg-green-900 dark:text-green-300">
                {uploadedDocs}
              </span>
            )}
          </h2>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              icon={<FileText className="w-3.5 h-3.5" />}
              onClick={() => setAddDocModalOpen(true)}
            >
              {t('cases.addDocType')}
            </Button>
            <Button variant="outline" size="sm" icon={<Download className="w-3.5 h-3.5" />}>{t('cases.downloadAll')}</Button>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {caseData.requiredDocuments.map(doc => {
            const StatusIcon = statusIcons[doc.status]
            const docType = allDocumentTypes.find(dt => dt.id === doc.documentTypeId)
            const hasFile = !!doc.storagePath
            const isImage = doc.fileType?.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(doc.fileType?.toLowerCase() || '')
            const isPdf = doc.fileType === 'application/pdf' || doc.fileType?.toLowerCase() === 'pdf'

            return (
              <Card
                key={doc.documentTypeId}
                hover
                onClick={() => {
                  if (hasFile) setLightboxDoc(doc.documentTypeId)
                }}
                className="overflow-hidden cursor-pointer flex flex-col"
              >
                {/* Preview area */}
                <div className="relative aspect-[4/3] bg-[var(--bg-tertiary)] flex items-center justify-center overflow-hidden">
                  {hasFile && isImage && signedUrls[doc.documentTypeId] ? (
                    <img
                      src={signedUrls[doc.documentTypeId]}
                      alt={doc.documentTypeName}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none'
                        const fallback = e.currentTarget.parentElement?.querySelector('[data-fallback]') as HTMLElement
                        if (fallback) fallback.classList.remove('hidden')
                      }}
                    />
                  ) : null}
                  <div data-fallback className={cn(
                    'flex flex-col items-center justify-center text-[var(--text-tertiary)]',
                    hasFile && isImage && signedUrls[doc.documentTypeId] && 'hidden'
                  )}>
                    {hasFile && urlsLoading ? (
                      <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
                    ) : hasFile && isPdf ? (
                      <>
                        <FileText className="w-10 h-10 mb-1 text-red-400" />
                        <span className="text-[10px] uppercase font-medium">PDF</span>
                      </>
                    ) : hasFile ? (
                      <>
                        <FileText className="w-10 h-10 mb-1" />
                        <span className="text-[10px] uppercase font-medium">{doc.fileType?.split('/').pop() || '?'}</span>
                      </>
                    ) : (
                      <>
                        <UploadCloud className="w-10 h-10 mb-1 opacity-50" />
                        <span className="text-[10px]">{t('documents.noFile')}</span>
                      </>
                    )}
                  </div>
                  {/* Status badge overlay */}
                  <div className="absolute top-2 end-2">
                    <Badge variant="status" status={doc.status} size="sm">
                      {t(getDocStatusKey(doc.status))}
                    </Badge>
                  </div>
                </div>

                {/* Document info */}
                <div className="p-3 flex-1">
                  <p className="text-sm font-medium truncate" title={doc.documentTypeName}>{doc.documentTypeName}</p>
                  {doc.fileName ? (
                    <p className="text-xs text-[var(--text-tertiary)] truncate mt-0.5">{doc.fileName}</p>
                  ) : (
                    <p className="text-xs text-[var(--text-tertiary)] mt-0.5">{t('documents.notUploaded')}</p>
                  )}
                  {doc.uploadedAt && (
                    <p className="text-[10px] text-[var(--text-tertiary)] mt-1">{formatDate(doc.uploadedAt)}</p>
                  )}
                </div>

                {/* Fixed bottom action bar */}
                {hasFile && (
                  <div className="border-t border-[var(--border-primary)] px-2 py-1.5 flex items-center justify-between">
                    <div className="flex items-center gap-0.5">
                      <button
                        onClick={async (e) => {
                          e.stopPropagation()
                          if (signedUrls[doc.documentTypeId]) {
                            window.open(signedUrls[doc.documentTypeId], '_blank')
                          } else if (doc.storagePath) {
                            try {
                              const url = await getSignedUrl(doc.storagePath)
                              setSignedUrls(prev => ({ ...prev, [doc.documentTypeId]: url }))
                              window.open(url, '_blank')
                            } catch (err) { console.error('Failed to get preview URL', err) }
                          }
                        }}
                        className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                        title={t('documents.preview')}
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation()
                          if (doc.storagePath) {
                            try {
                              const blob = await downloadFile(doc.storagePath)
                              const url = URL.createObjectURL(blob)
                              const link = document.createElement('a')
                              link.href = url
                              link.download = doc.fileName || 'document'
                              document.body.appendChild(link)
                              link.click()
                              document.body.removeChild(link)
                              URL.revokeObjectURL(url)
                            } catch (err) { console.error('Failed to download', err) }
                          }
                        }}
                        className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                        title={t('common.download')}
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="relative">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setDocMenuOpen(docMenuOpen === doc.documentTypeId ? null : doc.documentTypeId)
                        }}
                        className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </button>
                      {docMenuOpen === doc.documentTypeId && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setDocMenuOpen(null) }} />
                          <div className="absolute end-0 bottom-full mb-1 z-50 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-lg py-1 min-w-[160px]">
                            <button
                              onClick={(e) => { e.stopPropagation(); setDocMenuOpen(null); setExpandedDoc(doc.documentTypeId) }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--bg-tertiary)] transition-colors"
                            >
                              <FileText className="w-3.5 h-3.5" />
                              {t('documents.details') || t('cases.caseInfo')}
                            </button>
                            {!['missing', 'pending-upload'].includes(doc.status) && (
                              <button
                                onClick={async (e) => { e.stopPropagation(); setDocMenuOpen(null); await handleMarkInvalid(doc) }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--bg-tertiary)] text-red-600 transition-colors"
                              >
                                <XCircle className="w-3.5 h-3.5" />{t('documents.markInvalid')}
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      </div>



      {/* ── Image Lightbox ── */}
      {lightboxDoc && (() => {
        const doc = caseData.requiredDocuments.find(d => d.documentTypeId === lightboxDoc)
        if (!doc) return null
        const isImage = doc.fileType?.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(doc.fileType?.toLowerCase() || '')
        const url = signedUrls[doc.documentTypeId]

        return (
          <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4 cursor-pointer" onClick={() => setLightboxDoc(null)}>
            <button onClick={() => setLightboxDoc(null)} className="absolute top-4 end-4 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors z-10">
              <XCircle className="w-6 h-6" />
            </button>
            <div className="max-w-[90vw] max-h-[90vh] flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
              {isImage && url ? (
                <img src={url} alt={doc.documentTypeName} className="max-w-full max-h-[90vh] object-contain rounded-lg" />
              ) : url ? (
                <iframe src={url} className="w-[80vw] h-[85vh] rounded-lg bg-white" title={doc.documentTypeName} />
              ) : (
                <div className="flex flex-col items-center text-white">
                  <FileText className="w-20 h-20 mb-3" />
                  <p className="text-lg">{doc.documentTypeName}</p>
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* ── Document Detail Modal ── */}
      <Modal isOpen={!!expandedDoc} onClose={() => setExpandedDoc(null)} title={caseData.requiredDocuments.find(d => d.documentTypeId === expandedDoc)?.documentTypeName || ''} size="lg">
        {(() => {
          const doc = caseData.requiredDocuments.find(d => d.documentTypeId === expandedDoc)
          if (!doc) return null
          const StatusIcon = statusIcons[doc.status]
          const docType = allDocumentTypes.find(dt => dt.id === doc.documentTypeId)
          const hasFile = !!doc.storagePath
          const isImage = doc.fileType?.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(doc.fileType?.toLowerCase() || '')

          return (
            <div className="space-y-4">
              {hasFile && (
                <div className="relative aspect-video bg-[var(--bg-tertiary)] rounded-lg overflow-hidden flex items-center justify-center">
                  {isImage && signedUrls[doc.documentTypeId] ? (
                    <img src={signedUrls[doc.documentTypeId]} alt={doc.documentTypeName} className="max-w-full max-h-full object-contain" />
                  ) : (
                    <div className="flex flex-col items-center text-[var(--text-tertiary)]">
                      <FileText className="w-16 h-16 mb-2" />
                      <span className="text-sm uppercase">{doc.fileType?.split('/').pop() || 'File'}</span>
                    </div>
                  )}
                </div>
              )}
              <div className="flex items-center gap-2">
                <StatusIcon className={cn('w-5 h-5', statusColors[doc.status])} />
                <Badge variant="status" status={doc.status}>{t(getDocStatusKey(doc.status))}</Badge>
                {doc.fileSize && <span className="text-xs text-[var(--text-tertiary)]">{formatFileSize(doc.fileSize)}</span>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                {doc.uploadedAt && (
                  <div>
                    <p className="text-[10px] uppercase text-[var(--text-tertiary)] tracking-wider">{t('documents.uploadedAt')}</p>
                    <p className="text-sm font-medium mt-0.5">{formatDate(doc.uploadedAt)}</p>
                  </div>
                )}
                {doc.reviewedAt && (
                  <div>
                    <p className="text-[10px] uppercase text-[var(--text-tertiary)] tracking-wider">{t('documents.reviewedAt')}</p>
                    <p className="text-sm font-medium mt-0.5">{formatDate(doc.reviewedAt)}</p>
                  </div>
                )}
                {doc.reviewedByName && (
                  <div>
                    <p className="text-[10px] uppercase text-[var(--text-tertiary)] tracking-wider">{t('documents.reviewedBy')}</p>
                    <p className="text-sm font-medium mt-0.5">{doc.reviewedByName}</p>
                  </div>
                )}
                {doc.fileType && (
                  <div>
                    <p className="text-[10px] uppercase text-[var(--text-tertiary)] tracking-wider">{t('documents.fileType')}</p>
                    <p className="text-sm font-medium mt-0.5 uppercase">{doc.fileType}</p>
                  </div>
                )}
              </div>
              {doc.rejectionReason && (
                <div className="p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <p className="text-xs font-medium text-red-700 dark:text-red-400">{t('documents.rejectionReason')}</p>
                  <p className="text-sm text-red-600 dark:text-red-300 mt-1">{doc.rejectionReason}</p>
                </div>
              )}
              {doc.notes && (
                <div className="p-3 bg-[var(--bg-tertiary)] rounded-lg">
                  <p className="text-xs font-medium text-[var(--text-secondary)]">{t('documents.notes')}</p>
                  <p className="text-sm text-[var(--text-tertiary)] mt-1">{doc.notes}</p>
                </div>
              )}
              {docType?.description && <p className="text-sm text-[var(--text-tertiary)] italic">{docType.description}</p>}
              <div className="flex gap-2 flex-wrap pt-2 border-t border-[var(--border-primary)]">
                {['uploaded', 'under-review'].includes(doc.status) && (
                  <>
                    <Button icon={<CheckCircle2 className="w-4 h-4" />}>{t('documents.approve')}</Button>
                    <Button variant="danger" icon={<XCircle className="w-4 h-4" />}>{t('documents.reject')}</Button>
                  </>
                )}
                {doc.storagePath && (
                  <>
                    <Button variant="outline" icon={<Eye className="w-4 h-4" />} onClick={() => { setExpandedDoc(null); setLightboxDoc(doc.documentTypeId) }}>{t('documents.preview')}</Button>
                    <Button variant="outline" icon={<Download className="w-4 h-4" />} onClick={async () => {
                      if (doc.storagePath) {
                        try {
                          const blob = await downloadFile(doc.storagePath)
                          const url = URL.createObjectURL(blob)
                          const link = document.createElement('a')
                          link.href = url; link.download = doc.fileName || 'document'
                          document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url)
                        } catch (err) { console.error('Failed to download', err) }
                      }
                    }}>{t('common.download')}</Button>
                  </>
                )}
                {doc.status === 'rejected' && (
                  <Button variant="outline" icon={<RotateCcw className="w-4 h-4" />}>{t('documents.requestReupload')}</Button>
                )}
              </div>
            </div>
          )
        })()}
      </Modal>

      {/* ── Support Chat Modal ── */}
      <Modal isOpen={showSupportModal} onClose={() => setShowSupportModal(false)} title="" size="lg">
        {supportRequest ? (
          <div className="space-y-4">
            {/* Header with status and close button */}
            <div className="flex items-start justify-between pb-3 border-b border-[var(--border-primary)]">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <MessageCircle className="w-5 h-5 text-blue-500" />
                  <h3 className="text-lg font-bold">{t('cases.supportTab')}</h3>
                </div>
                <p className="text-sm text-[var(--text-secondary)]">{supportRequest.subject}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="status" status={supportRequest.status} size="sm">
                  {t(`support.${supportRequest.status === 'waiting-for-staff' ? 'waitingForStaff' : supportRequest.status === 'waiting-for-client' ? 'waitingForClient' : supportRequest.status}`)}
                </Badge>
                {supportRequest.status !== 'resolved' && supportRequest.status !== 'closed' && (
                  <Button
                    variant="outline"
                    size="sm"
                    icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                    onClick={() => handleCloseSupportRequest(supportRequest.id)}
                  >
                    {t('support.closeRequest')}
                  </Button>
                )}
              </div>
            </div>

            {/* Chat messages */}
            <div className="border border-[var(--border-primary)] rounded-2xl overflow-hidden shadow-sm">
              <div className="max-h-[450px] overflow-y-auto p-4 space-y-3 bg-gradient-to-b from-[var(--bg-tertiary)] to-[var(--bg-secondary)]">
                {supportRequest.messages.length === 0 ? (
                  <div className="text-center py-8">
                    <MessageCircle className="w-12 h-12 text-[var(--text-tertiary)] mx-auto mb-2 opacity-30" />
                    <p className="text-sm text-[var(--text-tertiary)]">{t('support.noMessages')}</p>
                  </div>
                ) : (
                  supportRequest.messages.map(msg => (
                    <div key={msg.id} className={cn('flex', msg.senderType === 'staff' ? 'justify-end' : 'justify-start')}>
                      <div className={cn(
                        'max-w-[75%] px-4 py-2.5 rounded-2xl shadow-sm',
                        msg.senderType === 'staff'
                          ? 'bg-blue-500 text-white rounded-br-md'
                          : 'bg-white dark:bg-gray-800 border border-[var(--border-primary)] rounded-bl-md'
                      )}>
                        <p className="text-xs font-semibold mb-1 opacity-90">{msg.senderName}</p>
                        <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.body}</p>
                        <p className="text-[10px] opacity-60 mt-1.5">{formatDate(msg.sentAt)}</p>
                      </div>
                    </div>
                  ))
                )}
                <div ref={chatEndRef} />
              </div>
              
              {/* Message input */}
              {supportRequest.status !== 'resolved' && supportRequest.status !== 'closed' && (
                <div className="p-3 bg-[var(--bg-primary)] border-t border-[var(--border-primary)]">
                  <div className="flex gap-2">
                    <Textarea
                      value={chatMessage}
                      onChange={e => setChatMessage(e.target.value)}
                      placeholder={t('support.typeMessage')}
                      rows={2}
                      className="flex-1 text-sm resize-none"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          handleSendSupportReply(supportRequest.id)
                        }
                      }}
                    />
                    <Button
                      size="sm"
                      className="self-end"
                      icon={sendingChat ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      disabled={!chatMessage.trim() || sendingChat}
                      onClick={() => handleSendSupportReply(supportRequest.id)}
                    >
                      {sendingChat ? '' : 'שלח'}
                    </Button>
                  </div>
                  <p className="text-[10px] text-[var(--text-tertiary)] mt-2 flex items-center gap-1 opacity-70">
                    <MessageCircle className="w-3 h-3 text-green-500" />
                    {t('support.messageSentToWhatsApp')}
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="text-center py-12">
            <div className="w-16 h-16 rounded-full bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center mx-auto mb-4">
              <MessageCircle className="w-8 h-8 text-blue-500" />
            </div>
            <h4 className="text-base font-semibold mb-2">{t('support.noSupportRequest')}</h4>
            <p className="text-sm text-[var(--text-tertiary)] mb-6 max-w-md mx-auto">
              הלקוח יכול לכתוב <span className="font-semibold text-blue-500">"תמיכה"</span> בוואטסאפ כדי לפתוח שיחה, או שתוכל לפתוח באופן ידני
            </p>
            <Button
              size="sm"
              variant="outline"
              icon={<MessageCircle className="w-3.5 h-3.5" />}
              onClick={handleStartSupport}
            >
              {t('support.startConversation')}
            </Button>
          </div>
        )}
      </Modal>

      {/* ── Edit Request Modal ── */}
      <Modal isOpen={editModalOpen} onClose={() => setEditModalOpen(false)}
        title={t('cases.editRequest')} size="md">
        <div className="space-y-4 p-2">
          <Input
            label={t('requests.requestTitle')}
            value={editForm.caseType}
            onChange={e => setEditForm(p => ({ ...p, caseType: e.target.value }))}
          />
          <Textarea
            label={t('requests.description')}
            value={editForm.notes}
            onChange={e => setEditForm(p => ({ ...p, notes: e.target.value }))}
            rows={3}
          />
          <Input
            label={t('requests.deadline')}
            type="date"
            value={editForm.deadline}
            onChange={e => setEditForm(p => ({ ...p, deadline: e.target.value }))}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setEditModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleEditSave} loading={editSaving}
              icon={<Save className="w-4 h-4" />}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Delete Confirmation Modal ── */}
      <Modal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title={t('cases.deleteConfirmTitle')}
        size="sm"
      >
        <div className="p-2 space-y-4">
          <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800">
            <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-700 dark:text-red-400">
                {t('cases.deleteConfirmTitle')}
              </p>
              <p className="text-xs text-red-600 dark:text-red-300 mt-1">
                {t('cases.deleteConfirmDesc').replace('{{name}}', caseData.caseType)}
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={deleting}
              icon={<Trash2 className="w-4 h-4" />}
              onClick={handleDelete}
            >
              {t('common.delete')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Add Document Type Modal ── */}
      <Modal
        isOpen={addDocModalOpen}
        onClose={() => setAddDocModalOpen(false)}
        title={t('cases.addDocType')}
        size="md"
      >
        <div className="p-2 space-y-2 max-h-[60vh] overflow-y-auto">
          {(() => {
            // Filter out doc types already in this case
            const existingTypeIds = new Set(caseData.requiredDocuments.map(d => d.documentTypeId))
            const available = allDocumentTypes.filter(dt => !existingTypeIds.has(dt.id) && dt.status === 'active')

            if (available.length === 0) {
              return (
                <div className="text-center py-8 text-[var(--text-tertiary)]">
                  <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">{t('documents.noDocumentTypes')}</p>
                </div>
              )
            }

            return available.map(dt => (
              <button
                key={dt.id}
                disabled={addingDoc}
                onClick={async () => {
                  setAddingDoc(true)
                  try {
                    await addCaseDocument(caseData.id, dt.id, true)
                    addToast({ type: 'success', title: t('cases.addDocType'), message: dt.name })
                    setAddDocModalOpen(false)
                  } catch (err: any) {
                    addToast({ type: 'error', title: t('common.error'), message: err?.message })
                  } finally {
                    setAddingDoc(false)
                  }
                }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-[var(--bg-secondary)] transition-colors text-start border border-[var(--border-secondary)]"
              >
                <div className="w-9 h-9 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center shrink-0">
                  <FileText className="w-4 h-4 text-indigo-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{dt.name}</p>
                  {dt.description && (
                    <p className="text-xs text-[var(--text-tertiary)] truncate mt-0.5">{dt.description}</p>
                  )}
                </div>
              </button>
            ))
          })()}
        </div>
      </Modal>
    </div>
  )
}
