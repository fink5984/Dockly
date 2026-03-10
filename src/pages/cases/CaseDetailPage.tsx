import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useI18n } from '@/contexts/I18nContext'
import { Card, CardHeader, CardContent } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Tabs, useTabState } from '@/components/ui/Tabs'
import { Textarea } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { cn, formatFileSize, getStatusColor, getDocStatusKey, formatDate } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { useRealtimeData } from '@/hooks/useRealtimeData'
import { getCases } from '@/services/casesService'
import { getActivities } from '@/services/activityService'
import { getSupportRequests } from '@/services/supportService'
import { getClientById } from '@/services/clientsService'
import { sendDocumentRequest } from '@/services/whatsappService'
import {
  ArrowLeft, ArrowRight, Copy, Send, Bell, Calendar, User, Clock, FileText, CheckCircle2, XCircle, AlertTriangle,
  UploadCloud, Eye, Download, RotateCcw, MessageCircle, Paperclip, Link2, MoreHorizontal, Settings,
  Shield, Trash2, ChevronDown, ExternalLink, Loader2
} from 'lucide-react'
import { getDocumentTypes } from '@/services/documentsService'
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
  const { activeTab, setActiveTab, tabs } = useTabState([
    { id: 'overview', label: t('cases.overview') },
    { id: 'documents', label: t('cases.documentsTab'), badge: 0 },
    { id: 'activity', label: t('cases.activityTab') },
    { id: 'support', label: t('cases.supportTab') },
    { id: 'settings', label: t('common.settings') },
  ])

  const [chatMessage, setChatMessage] = useState('')
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null)
  const [showWhatsAppModal, setShowWhatsAppModal] = useState(false)
  const [waSending, setWaSending] = useState(false)
  const [waResult, setWaResult] = useState<{ success: boolean; error?: string } | null>(null)

  const { user, workspace } = useAuth()
  const wsId = workspace?.id || user?.workspaceId || ''

  const { data: allCases } = useRealtimeData(
    () => getCases(wsId),
    [],
    [wsId],
    { tables: ['cases', 'case_documents'] }
  )
  const { data: allActivities } = useRealtimeData(
    () => getActivities(wsId),
    [],
    [wsId],
    { tables: ['activity_log'] }
  )
  const { data: allSupportRequests } = useRealtimeData(
    () => getSupportRequests(wsId),
    [],
    [wsId],
    { tables: ['support_requests'] }
  )
  const { data: allDocumentTypes } = useRealtimeData(
    () => getDocumentTypes(wsId),
    [],
    [wsId],
    { tables: ['document_types'] }
  )

  // Fetch client data for WhatsApp
  const caseForClient = allCases.find(c => c.id === id)
  const { data: clientData } = useRealtimeData(
    () => caseForClient?.clientId ? getClientById(caseForClient.clientId) : Promise.resolve(null),
    null,
    [caseForClient?.clientId],
    { tables: ['clients'] }
  )

  const caseData = caseForClient
  const BackArrow = direction === 'rtl' ? ArrowRight : ArrowLeft

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
  const approvedDocs = caseData.requiredDocuments.filter(d => d.status === 'approved').length
  const submittedDocs = caseData.requiredDocuments.filter(d => !['missing', 'pending-upload'].includes(d.status)).length
  const pendingReview = caseData.requiredDocuments.filter(d => ['uploaded', 'under-review'].includes(d.status)).length
  const rejected = caseData.requiredDocuments.filter(d => d.status === 'rejected').length
  const missing = caseData.requiredDocuments.filter(d => ['missing', 'pending-upload'].includes(d.status)).length

  const caseActivities = allActivities.filter(a => a.caseId === caseData.id)
  const supportRequest = caseData.supportRequestId ? allSupportRequests.find(s => s.id === caseData.supportRequestId) : null

  const updatedTabs = tabs.map(tab => tab.id === 'documents' ? { ...tab, badge: pendingReview } : tab)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button onClick={() => navigate('/cases')} className="mt-1 p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors">
          <BackArrow className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
            <h1 className="text-xl font-bold truncate">{caseData.clientName}</h1>
            <Badge variant="status" status={caseData.status}>
              {t(`cases.${caseData.status === 'waiting-for-client' ? 'waitingForClient' : caseData.status === 'partial-submission' ? 'partialSubmission' : caseData.status === 'awaiting-review' ? 'awaitingReview' : caseData.status}`)}
            </Badge>
          </div>
          <div className="flex items-center gap-4 text-xs text-[var(--text-tertiary)] mt-1">
            <span className="font-mono">{caseData.id}</span>
            <span>{caseData.caseType}</span>
            <span className="flex items-center gap-1"><User className="w-3 h-3" />{caseData.assignedOwnerName}</span>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" icon={<Link2 className="w-3.5 h-3.5" />}>{t('cases.copyLink')}</Button>
          <Button variant="outline" size="sm" icon={<Bell className="w-3.5 h-3.5" />}>{t('cases.sendReminder')}</Button>
        </div>
      </div>

      {/* Progress summary */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex-1">
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="font-medium">{t('cases.overallProgress')}</span>
                <span className="tabular-nums font-bold text-lg">{totalDocs > 0 ? Math.round((approvedDocs / totalDocs) * 100) : 0}%</span>
              </div>
              <ProgressBar value={approvedDocs} max={totalDocs} size="lg" />
            </div>
            <div className="flex gap-4 text-center shrink-0">
              <div className="px-3">
                <p className="text-lg font-bold text-green-600">{approvedDocs}</p>
                <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">{t('cases.approved')}</p>
              </div>
              <div className="px-3 border-x border-[var(--border-primary)]">
                <p className="text-lg font-bold text-blue-500">{pendingReview}</p>
                <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">{t('cases.pending')}</p>
              </div>
              <div className="px-3 border-e border-[var(--border-primary)]">
                <p className="text-lg font-bold text-red-500">{rejected}</p>
                <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">{t('cases.rejected')}</p>
              </div>
              <div className="px-3">
                <p className="text-lg font-bold text-gray-400">{missing}</p>
                <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">{t('cases.missing')}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs tabs={updatedTabs} activeTab={activeTab} onChange={setActiveTab} />

      {/* Overview tab */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            <Card>
              <CardHeader title={t('cases.caseInfo')} />
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-[var(--text-tertiary)]">{t('cases.createdAt')}</p>
                    <p className="text-sm font-medium">{formatDate(caseData.createdAt)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--text-tertiary)]">{t('cases.lastActivity')}</p>
                    <p className="text-sm font-medium">{formatDate(caseData.lastActivityDate) || '-'}</p>
                  </div>
                  {caseData.deadline && (
                    <div>
                      <p className="text-xs text-[var(--text-tertiary)]">{t('cases.deadline')}</p>
                      <p className="text-sm font-medium flex items-center gap-1"><Calendar className="w-3 h-3" />{formatDate(caseData.deadline)}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-[var(--text-tertiary)]">{t('cases.assignedTo')}</p>
                    <p className="text-sm font-medium">{caseData.assignedOwnerName}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader title={t('cases.documentStatusBreakdown')} />
              <CardContent>
                <div className="space-y-2">
                  {caseData.requiredDocuments.slice(0, 5).map(doc => {
                    const StatusIcon = statusIcons[doc.status]
                    return (
                      <div key={doc.documentTypeId} className="flex items-center justify-between p-2.5 rounded-lg bg-[var(--bg-tertiary)]">
                        <div className="flex items-center gap-2">
                          <StatusIcon className={cn('w-4 h-4', statusColors[doc.status])} />
                          <span className="text-sm">{doc.documentTypeName}</span>
                        </div>
                        <Badge variant="status" status={doc.status} size="sm">
                          {t(getDocStatusKey(doc.status))}
                        </Badge>
                      </div>
                    )
                  })}
                  {caseData.requiredDocuments.length > 5 && (
                    <button onClick={() => setActiveTab('documents')} className="text-xs text-primary-600 hover:underline w-full text-center py-2">
                      {t('common.viewAll')} ({caseData.requiredDocuments.length})
                    </button>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader title={t('cases.quickActions')} />
              <CardContent>
                <div className="space-y-2">
                  <Button
                    variant="outline"
                    size="sm"
                    icon={<MessageCircle className="w-3.5 h-3.5 text-green-500" />}
                    className="w-full justify-start"
                    onClick={() => setShowWhatsAppModal(true)}
                  >
                    {t('cases.sendWhatsApp')}
                  </Button>
                  <Button variant="outline" size="sm" icon={<Send className="w-3.5 h-3.5" />} className="w-full justify-start">{t('cases.sendReminderEmail')}</Button>
                  <Button variant="outline" size="sm" icon={<Download className="w-3.5 h-3.5" />} className="w-full justify-start">{t('cases.downloadAll')}</Button>
                  <Button variant="outline" size="sm" icon={<Copy className="w-3.5 h-3.5" />} className="w-full justify-start">{t('cases.duplicateCase')}</Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader title={t('cases.recentActivity')} />
              <CardContent>
                <div className="space-y-3">
                  {caseActivities.slice(0, 4).map(activity => (
                    <div key={activity.id} className="flex gap-2 text-xs">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary-500 mt-1.5 shrink-0" />
                      <div>
                        <p>{activity.description}</p>
                        <p className="text-[var(--text-tertiary)]">{formatDate(activity.timestamp)}</p>
                      </div>
                    </div>
                  ))}
                  {caseActivities.length === 0 && <p className="text-xs text-[var(--text-tertiary)] text-center py-2">{t('activity.noActivity')}</p>}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Documents tab - Grid view with previews */}
      {activeTab === 'documents' && (
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
                onClick={() => setExpandedDoc(expandedDoc === doc.documentTypeId ? null : doc.documentTypeId)}
                className="overflow-hidden cursor-pointer"
              >
                {/* Preview area */}
                <div className="relative aspect-[4/3] bg-[var(--bg-tertiary)] flex items-center justify-center overflow-hidden">
                  {hasFile && isImage ? (
                    <img
                      src={`${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/documents/${doc.storagePath}`}
                      alt={doc.documentTypeName}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none'
                        e.currentTarget.nextElementSibling?.classList.remove('hidden')
                      }}
                    />
                  ) : null}
                  <div className={cn(
                    'flex flex-col items-center justify-center text-[var(--text-tertiary)]',
                    hasFile && isImage && 'hidden'
                  )}>
                    {hasFile && isPdf ? (
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
                <div className="p-3">
                  <p className="text-sm font-medium truncate" title={doc.documentTypeName}>
                    {doc.documentTypeName}
                  </p>
                  {doc.fileName ? (
                    <p className="text-xs text-[var(--text-tertiary)] truncate mt-0.5">
                      {doc.fileName}
                    </p>
                  ) : (
                    <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                      {t('documents.notUploaded')}
                    </p>
                  )}
                  {doc.uploadedAt && (
                    <p className="text-[10px] text-[var(--text-tertiary)] mt-1">
                      {formatDate(doc.uploadedAt)}
                    </p>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* Document Detail Modal */}
      <Modal
        isOpen={!!expandedDoc}
        onClose={() => setExpandedDoc(null)}
        title={caseData.requiredDocuments.find(d => d.documentTypeId === expandedDoc)?.documentTypeName || ''}
        size="lg"
      >
        {(() => {
          const doc = caseData.requiredDocuments.find(d => d.documentTypeId === expandedDoc)
          if (!doc) return null
          const StatusIcon = statusIcons[doc.status]
          const docType = allDocumentTypes.find(dt => dt.id === doc.documentTypeId)
          const hasFile = !!doc.storagePath
          const isImage = doc.fileType?.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(doc.fileType?.toLowerCase() || '')

          return (
            <div className="space-y-4">
              {/* Large preview */}
              {hasFile && (
                <div className="relative aspect-video bg-[var(--bg-tertiary)] rounded-lg overflow-hidden flex items-center justify-center">
                  {isImage ? (
                    <img
                      src={`${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/documents/${doc.storagePath}`}
                      alt={doc.documentTypeName}
                      className="max-w-full max-h-full object-contain"
                    />
                  ) : (
                    <div className="flex flex-col items-center text-[var(--text-tertiary)]">
                      <FileText className="w-16 h-16 mb-2" />
                      <span className="text-sm uppercase">{doc.fileType?.split('/').pop() || 'File'}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Status */}
              <div className="flex items-center gap-2">
                <StatusIcon className={cn('w-5 h-5', statusColors[doc.status])} />
                <Badge variant="status" status={doc.status}>
                  {t(getDocStatusKey(doc.status))}
                </Badge>
                {doc.fileSize && (
                  <span className="text-xs text-[var(--text-tertiary)]">
                    {formatFileSize(doc.fileSize)}
                  </span>
                )}
              </div>

              {/* Details grid */}
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

              {/* Rejection reason */}
              {doc.rejectionReason && (
                <div className="p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <p className="text-xs font-medium text-red-700 dark:text-red-400">{t('documents.rejectionReason')}</p>
                  <p className="text-sm text-red-600 dark:text-red-300 mt-1">{doc.rejectionReason}</p>
                </div>
              )}

              {/* Notes */}
              {doc.notes && (
                <div className="p-3 bg-[var(--bg-tertiary)] rounded-lg">
                  <p className="text-xs font-medium text-[var(--text-secondary)]">{t('documents.notes')}</p>
                  <p className="text-sm text-[var(--text-tertiary)] mt-1">{doc.notes}</p>
                </div>
              )}

              {/* Description */}
              {docType?.description && (
                <p className="text-sm text-[var(--text-tertiary)] italic">{docType.description}</p>
              )}

              {/* Actions */}
              <div className="flex gap-2 flex-wrap pt-2 border-t border-[var(--border-primary)]">
                {['uploaded', 'under-review'].includes(doc.status) && (
                  <>
                    <Button icon={<CheckCircle2 className="w-4 h-4" />}>{t('documents.approve')}</Button>
                    <Button variant="danger" icon={<XCircle className="w-4 h-4" />}>{t('documents.reject')}</Button>
                  </>
                )}
                {doc.storagePath && (
                  <>
                    <Button
                      variant="outline"
                      icon={<Eye className="w-4 h-4" />}
                      onClick={() => window.open(`${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/documents/${doc.storagePath}`, '_blank')}
                    >
                      {t('documents.preview')}
                    </Button>
                    <Button
                      variant="outline"
                      icon={<Download className="w-4 h-4" />}
                      onClick={() => {
                        const link = document.createElement('a')
                        link.href = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/documents/${doc.storagePath}`
                        link.download = doc.fileName || 'document'
                        link.click()
                      }}
                    >
                      {t('common.download')}
                    </Button>
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

      {/* Activity tab */}
      {activeTab === 'activity' && (
        <Card>
          <CardHeader title={t('activity.title')} />
          <CardContent>
            {caseActivities.length === 0 ? (
              <EmptyState icon={<Clock className="w-6 h-6" />} title={t('activity.noActivity')} />
            ) : (
              <div className="relative">
                <div className="absolute top-0 bottom-0 start-4 w-0.5 bg-[var(--border-primary)]" />
                <div className="space-y-4">
                  {caseActivities.map(activity => (
                    <div key={activity.id} className="relative flex gap-4 ps-10">
                      <div className="absolute start-2.5 top-1 w-3 h-3 rounded-full bg-primary-500 border-2 border-[var(--bg-secondary)]" />
                      <div className="flex-1 pb-4">
                        <p className="text-sm">{activity.description}</p>
                        <div className="flex items-center gap-3 text-xs text-[var(--text-tertiary)] mt-1">
                          <span>{activity.performedByName}</span>
                          <span>{formatDate(activity.timestamp)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Support tab */}
      {activeTab === 'support' && (
        <Card>
          <CardContent>
            {supportRequest ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{supportRequest.subject}</p>
                    <p className="text-xs text-[var(--text-tertiary)]">
                      {t('support.status')}: <Badge variant="status" status={supportRequest.status} size="sm">{t(`support.${supportRequest.status === 'waiting-for-staff' ? 'waitingForStaff' : supportRequest.status === 'waiting-for-client' ? 'waitingForClient' : supportRequest.status}`)}</Badge>
                    </p>
                  </div>
                </div>

                <div className="border border-[var(--border-primary)] rounded-xl overflow-hidden">
                  <div className="max-h-80 overflow-y-auto p-4 space-y-3 bg-[var(--bg-tertiary)]">
                    {supportRequest.messages.map(msg => (
                      <div key={msg.id} className={cn('flex', msg.senderType === 'staff' ? 'justify-end' : 'justify-start')}>
                        <div className={cn(
                          'max-w-[80%] p-3 rounded-2xl text-sm',
                          msg.senderType === 'staff'
                            ? 'bg-primary-600 text-white rounded-br-sm'
                            : 'bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-bl-sm'
                        )}>
                          <p className="text-xs font-medium mb-1 opacity-80">{msg.senderName}</p>
                          <p>{msg.body}</p>
                          {msg.attachments && msg.attachments.length > 0 && (
                            <div className="mt-2 space-y-1">
                              {msg.attachments.map(att => (
                                <div key={att.id} className="flex items-center gap-1 text-xs opacity-80">
                                  <Paperclip className="w-3 h-3" />
                                  <span>{att.fileName}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          <p className="text-[10px] opacity-60 mt-1">{msg.sentAt}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="p-3 border-t border-[var(--border-primary)] bg-[var(--bg-primary)]">
                    <div className="flex gap-2">
                      <Textarea
                        value={chatMessage}
                        onChange={e => setChatMessage(e.target.value)}
                        placeholder={t('support.typeMessage')}
                        rows={1}
                        className="flex-1"
                      />
                      <Button size="sm" icon={<Send className="w-4 h-4" />} disabled={!chatMessage.trim()} />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <EmptyState
                icon={<MessageCircle className="w-6 h-6" />}
                title={t('support.noSupportRequest')}
                description={t('support.noSupportRequestDesc')}
                action={<Button icon={<MessageCircle className="w-4 h-4" />}>{t('support.startConversation')}</Button>}
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* Settings tab */}
      {activeTab === 'settings' && (
        <div className="space-y-4">
          <Card>
            <CardHeader title={t('cases.caseSettings')} />
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-[var(--bg-tertiary)] rounded-lg">
                  <div>
                    <p className="text-sm font-medium">{t('cases.changeStatus')}</p>
                    <p className="text-xs text-[var(--text-tertiary)]">{t('cases.changeStatusDesc')}</p>
                  </div>
                  <Button variant="outline" size="sm">{t('common.change')}</Button>
                </div>
                <div className="flex items-center justify-between p-3 bg-[var(--bg-tertiary)] rounded-lg">
                  <div>
                    <p className="text-sm font-medium">{t('cases.reassignCase')}</p>
                    <p className="text-xs text-[var(--text-tertiary)]">{t('cases.reassignCaseDesc')}</p>
                  </div>
                  <Button variant="outline" size="sm">{t('common.change')}</Button>
                </div>
                <div className="flex items-center justify-between p-3 bg-[var(--bg-tertiary)] rounded-lg">
                  <div>
                    <p className="text-sm font-medium">{t('cases.editDeadline')}</p>
                    <p className="text-xs text-[var(--text-tertiary)]">{formatDate(caseData.deadline) || t('cases.noDeadline')}</p>
                  </div>
                  <Button variant="outline" size="sm">{t('common.edit')}</Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader title={t('cases.dangerZone')} />
            <CardContent>
              <div className="flex items-center justify-between p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg">
                <div>
                  <p className="text-sm font-medium text-red-700 dark:text-red-400">{t('cases.archiveCase')}</p>
                  <p className="text-xs text-red-600 dark:text-red-300">{t('cases.archiveCaseDesc')}</p>
                </div>
                <Button variant="danger" size="sm" icon={<Trash2 className="w-3.5 h-3.5" />}>{t('cases.archive')}</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* WhatsApp Send Modal */}
      <Modal isOpen={showWhatsAppModal} onClose={() => { setShowWhatsAppModal(false); setWaResult(null) }} title={t('cases.sendWhatsApp')} size="md">
        <div className="space-y-4">
          {!waResult ? (
            <>
              <div className="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-950/20 rounded-xl border border-green-200 dark:border-green-800">
                <MessageCircle className="w-8 h-8 text-green-500 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-green-700 dark:text-green-400">{t('cases.waModalTitle')}</p>
                  <p className="text-xs text-green-600 dark:text-green-300 mt-0.5">{t('cases.waModalDesc')}</p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between p-2 bg-[var(--bg-tertiary)] rounded-lg">
                  <span className="text-xs text-[var(--text-tertiary)]">{t('common.client')}</span>
                  <span className="text-xs font-medium">{caseData.clientName}</span>
                </div>
                <div className="flex justify-between p-2 bg-[var(--bg-tertiary)] rounded-lg">
                  <span className="text-xs text-[var(--text-tertiary)]">{t('common.phone')}</span>
                  <span className="text-xs font-medium">{clientData?.phone || '—'}</span>
                </div>
                <div className="flex justify-between p-2 bg-[var(--bg-tertiary)] rounded-lg">
                  <span className="text-xs text-[var(--text-tertiary)]">{t('cases.pendingDocs')}</span>
                  <span className="text-xs font-medium">{missing}</span>
                </div>
              </div>

              {!clientData?.phone && (
                <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                  <p className="text-xs text-amber-700 dark:text-amber-400">{t('cases.noPhoneWarning')}</p>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={() => setShowWhatsAppModal(false)}>{t('common.cancel')}</Button>
                <Button
                  icon={waSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />}
                  disabled={waSending || !clientData?.phone}
                  onClick={async () => {
                    if (!clientData?.phone) return
                    setWaSending(true)
                    try {
                      const result = await sendDocumentRequest({
                        workspaceId: wsId,
                        caseId: caseData.id,
                        clientId: caseData.clientId,
                        phoneNumber: clientData.phone,
                        language: language as 'en' | 'he',
                      })
                      setWaResult({ success: result.success, error: result.error })
                    } catch (err: any) {
                      setWaResult({ success: false, error: err.message || 'Failed to send' })
                    } finally {
                      setWaSending(false)
                    }
                  }}
                >
                  {t('cases.sendViaWhatsApp')}
                </Button>
              </div>
            </>
          ) : (
            <div className="text-center space-y-4">
              {waResult.success ? (
                <>
                  <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-8 h-8 text-green-500" />
                  </div>
                  <div>
                    <p className="font-medium text-green-700 dark:text-green-400">{t('cases.waSentSuccess')}</p>
                    <p className="text-xs text-[var(--text-tertiary)] mt-1">{t('cases.waSentSuccessDesc')}</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900 flex items-center justify-center mx-auto">
                    <XCircle className="w-8 h-8 text-red-500" />
                  </div>
                  <div>
                    <p className="font-medium text-red-700 dark:text-red-400">{t('cases.waSentFailed')}</p>
                    <p className="text-xs text-[var(--text-tertiary)] mt-1">{waResult.error}</p>
                  </div>
                </>
              )}
              <Button variant="ghost" onClick={() => { setShowWhatsAppModal(false); setWaResult(null) }}>
                {t('common.close')}
              </Button>
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}
