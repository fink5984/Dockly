import { useParams, useNavigate } from 'react-router-dom'
import { useI18n } from '@/contexts/I18nContext'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { cn } from '@/lib/utils'
import { useSupabaseData } from '@/hooks/useSupabaseData'
import { getClients } from '@/services/clientsService'
import { getCases } from '@/services/casesService'
import { getActivities } from '@/services/activityService'
import { getCaseTypeConfigs } from '@/services/settingsService'
import {
  ArrowLeft, ArrowRight, Phone, Mail, Building2, Calendar,
  FolderOpen, Send, MessageCircle, Link2, User, FileCheck,
  AlertTriangle, CheckCircle, Clock,
} from 'lucide-react'

export function ClientProfilePage() {
  const { id } = useParams()
  const { t, direction } = useI18n()
  const navigate = useNavigate()
  const isRtl = direction === 'rtl'
  const BackArrow = isRtl ? ArrowRight : ArrowLeft

  const { data: allClients } = useSupabaseData(getClients, [])
  const { data: allCases } = useSupabaseData(getCases, [])
  const { data: allActivities } = useSupabaseData(getActivities, [])
  const { data: caseTypeConfigs } = useSupabaseData(getCaseTypeConfigs, [])

  const getCaseTypeName = (typeId: string) => {
    const cfg = caseTypeConfigs.find(ct => ct.id === typeId)
    return cfg ? cfg.name : t(`caseTypes.${typeId}`)
  }

  const client = allClients.find(c => c.id === id)
  if (!client) return <div className="p-8 text-center">{t('common.noResults')}</div>

  const clientCases = allCases.filter(c => c.clientId === client.id)
  const clientActivities = allActivities.filter(a => a.clientId === client.id)

  const totalDocs = clientCases.reduce((sum, c) => sum + c.requiredDocuments.length, 0)
  const receivedDocs = clientCases.reduce((sum, c) => sum + c.requiredDocuments.filter(d => d.status !== 'missing').length, 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/clients')} className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)]">
          <BackArrow className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold">{client.name}</h1>
          <p className="text-sm text-[var(--text-tertiary)]">{t('clients.profile')}</p>
        </div>
      </div>

      {/* Top summary */}
      <Card>
        <CardContent className="py-6">
          <div className="flex flex-col md:flex-row md:items-center gap-6">
            <div className="w-16 h-16 rounded-2xl bg-primary-100 text-primary-700 flex items-center justify-center text-xl font-bold">
              {client.name.split(' ').map(n => n[0]).join('')}
            </div>
            <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-[var(--text-tertiary)]" />
                <div>
                  <p className="text-xs text-[var(--text-tertiary)]">{t('clients.phone')}</p>
                  <p className="text-sm font-medium">{client.phone}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-[var(--text-tertiary)]" />
                <div>
                  <p className="text-xs text-[var(--text-tertiary)]">{t('clients.email')}</p>
                  <p className="text-sm font-medium">{client.email}</p>
                </div>
              </div>
              {client.company && (
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-[var(--text-tertiary)]" />
                  <div>
                    <p className="text-xs text-[var(--text-tertiary)]">{t('clients.company')}</p>
                    <p className="text-sm font-medium">{client.company}</p>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-[var(--text-tertiary)]" />
                <div>
                  <p className="text-xs text-[var(--text-tertiary)]">{t('clients.createdAt')}</p>
                  <p className="text-sm font-medium">{client.createdAt}</p>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => navigate('/cases/create')} icon={<FolderOpen className="w-3.5 h-3.5" />}>{t('clients.createCase')}</Button>
              <Button size="sm" variant="outline" icon={<Send className="w-3.5 h-3.5" />}>{t('clients.sendReminder')}</Button>
              <Button size="sm" variant="ghost" icon={<MessageCircle className="w-3.5 h-3.5" />}>{t('clients.whatsappActions')}</Button>
            </div>
          </div>

          {/* Completion indicator */}
          <div className="mt-6 p-4 rounded-xl bg-[var(--bg-secondary)]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">{t('clients.progress')}</span>
              <span className="text-sm font-semibold">{receivedDocs}/{totalDocs} {t('documents.title').toLowerCase()}</span>
            </div>
            <ProgressBar value={receivedDocs} max={totalDocs || 1} size="md" />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Cases list */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">{t('clients.casesList')} ({clientCases.length})</h3>
                <Button size="sm" variant="ghost" onClick={() => navigate('/cases/create')} icon={<FolderOpen className="w-3.5 h-3.5" />}>
                  {t('clients.createCase')}
                </Button>
              </div>
            </CardHeader>
            <div className="divide-y divide-[var(--border-secondary)]">
              {clientCases.map(c => {
                const submitted = c.requiredDocuments.filter(d => d.status !== 'missing').length
                const total = c.requiredDocuments.length
                return (
                  <button
                    key={c.id}
                    onClick={() => navigate(`/cases/${c.id}`)}
                    className="w-full flex items-center gap-4 px-5 py-4 hover:bg-[var(--bg-secondary)] transition-colors text-left"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm font-medium">{c.id}</p>
                        <Badge variant="status" status={c.status}>
                          {t(`cases.${c.status === 'waiting-for-client' ? 'waitingForClient' : c.status === 'partial-submission' ? 'partialSubmission' : c.status === 'awaiting-review' ? 'awaitingReview' : c.status}`)}
                        </Badge>
                        {c.supportRequestId && <Badge variant="status" status="warning">{t('support.activeSupportBadge')}</Badge>}
                      </div>
                      <p className="text-xs text-[var(--text-tertiary)]">
                        {getCaseTypeName(c.caseType)} · {submitted}/{total} {t('documents.title').toLowerCase()}
                      </p>
                    </div>
                    <ProgressBar value={submitted} max={total} className="w-24" showLabel />
                  </button>
                )
              })}
            </div>
          </Card>

          {/* Future placeholders */}
          <Card className="p-5">
            <div className="flex items-center gap-3 text-[var(--text-tertiary)]">
              <Link2 className="w-5 h-5" />
              <div>
                <p className="text-sm font-medium">{t('clients.submissionLink')}</p>
                <p className="text-xs">{t('common.comingSoon')}</p>
              </div>
            </div>
          </Card>
        </div>

        {/* Activity timeline */}
        <Card>
          <CardHeader>
            <h3 className="text-sm font-semibold">{t('clients.activityTimeline')}</h3>
          </CardHeader>
          <div className="px-5 pb-4">
            <div className={cn('relative', isRtl ? 'border-r-2' : 'border-l-2', 'border-[var(--border-secondary)]')}>
              {clientActivities.length === 0 && (
                <p className="text-sm text-[var(--text-tertiary)] py-4 px-4">{t('activity.noActivity')}</p>
              )}
              {clientActivities.map(a => {
                const iconMap: Record<string, typeof CheckCircle> = {
                  'document-uploaded': FileCheck,
                  'document-approved': CheckCircle,
                  'document-rejected': AlertTriangle,
                  'support-opened': MessageCircle,
                  'reminder-sent': Send,
                  'case-opened': FolderOpen,
                }
                const Icon = iconMap[a.type] || Clock
                return (
                  <div key={a.id} className={cn('relative flex items-start gap-3 pb-5', isRtl ? 'pr-5' : 'pl-5')}>
                    <div className={cn(
                      'absolute top-0 w-3 h-3 rounded-full bg-[var(--bg-primary)] border-2 border-[var(--border-primary)]',
                      isRtl ? '-right-[7px]' : '-left-[7px]'
                    )} />
                    <div>
                      <p className="text-xs font-medium">{a.description}</p>
                      <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">{a.timestamp.split('T')[0]}</p>
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
