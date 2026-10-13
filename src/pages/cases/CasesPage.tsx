import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useI18n } from '@/contexts/I18nContext'
import { useAuth } from '@/contexts/AuthContext'
import { useApp } from '@/contexts/AppContext'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { SearchInput } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { cn, formatDate } from '@/lib/utils'
import { useRealtimeData } from '@/hooks/useRealtimeData'
import { getCases, deleteCase } from '@/services/casesService'
import { getSupportRequests } from '@/services/supportService'
import { ClipboardPlus, ClipboardList, Calendar, Eye, Download, Filter, Clock, CheckCircle2, FileText, Trash2, Loader2 } from 'lucide-react'
import { CardMenu } from '@/components/ui/CardMenu'
import type { CaseStatus } from '@/types'

type CaseFilter = 'all' | CaseStatus

export function CasesPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { user, workspace } = useAuth()
  const wsId = workspace?.id || user?.workspaceId || ''
  const [searchParams] = useSearchParams()
  const initialFilter = (searchParams.get('filter') || 'all') as CaseFilter
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<CaseFilter>(initialFilter)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [acting, setActing] = useState(false)
  const { addToast } = useApp()

  const { data: allCases, loading, refetch } = useRealtimeData(
    () => getCases(wsId),
    [],
    [wsId],
    { tables: ['cases', 'case_documents'] }
  )

  const { data: allSupportRequests } = useRealtimeData(
    () => getSupportRequests(wsId),
    [],
    [wsId],
    { tables: ['support_requests', 'support_messages'] }
  )

  if (loading) return (
    <div className="flex items-center justify-center py-32">
      <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
    </div>
  )

  const filtered = allCases.filter(c => {
    if (search && !c.clientName.toLowerCase().includes(search.toLowerCase()) && !c.id.includes(search)) return false
    if (filter !== 'all' && c.status !== filter) return false
    return true
  })

  const filters: { key: CaseFilter; labelKey: string; count: number }[] = [
    { key: 'all', labelKey: 'common.all', count: allCases.length },
    { key: 'new', labelKey: 'cases.new', count: allCases.filter(c => c.status === 'new').length },
    { key: 'waiting-for-client', labelKey: 'cases.waitingForClient', count: allCases.filter(c => c.status === 'waiting-for-client').length },
    { key: 'partial-submission', labelKey: 'cases.partialSubmission', count: allCases.filter(c => c.status === 'partial-submission').length },
    { key: 'completed', labelKey: 'cases.completed', count: allCases.filter(c => c.status === 'completed').length },
    { key: 'delayed', labelKey: 'cases.delayed', count: allCases.filter(c => c.status === 'delayed').length },
  ]

  const handleDelete = async () => {
    if (!deleteId) return
    setActing(true)
    try {
      await deleteCase(deleteId)
      refetch()
      setDeleteId(null)
      addToast({ title: t('requests.deleteSuccess'), type: 'success' })
    } catch {
      addToast({ title: t('common.error'), type: 'error' })
    } finally {
      setActing(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('requests.title')}</h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">{allCases.length} {t('common.total').toLowerCase()}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" icon={<Download className="w-3.5 h-3.5" />}>{t('common.export')}</Button>
          <Button onClick={() => navigate('/requests/create')} icon={<ClipboardPlus className="w-4 h-4" />}>{t('requests.newRequest')}</Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: t('requests.totalRequests'), value: allCases.length, icon: FileText, color: 'text-indigo-500' },
          { label: t('requests.pendingRequests'), value: allCases.filter(c => ['new', 'waiting-for-client', 'partial-submission'].includes(c.status)).length, icon: Clock, color: 'text-amber-500' },
          { label: t('requests.completedRequests'), value: allCases.filter(c => c.status === 'completed').length, icon: CheckCircle2, color: 'text-green-500' },
        ].map((s, i) => (
          <Card key={i} className="p-4">
            <div className="flex items-center gap-3">
              <div className={cn('p-2 rounded-lg bg-[var(--bg-tertiary)]', s.color)}>
                <s.icon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm text-[var(--text-secondary)]">{s.label}</p>
                <p className="text-2xl font-bold">{s.value}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-1.5 overflow-x-auto pb-1">
        {filters.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap',
              filter === f.key
                ? 'bg-primary-600 text-white'
                : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] border border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)]'
            )}
          >
            {t(f.labelKey)}
            <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-bold', filter === f.key ? 'bg-white/20' : 'bg-[var(--bg-tertiary)]')}>{f.count}</span>
          </button>
        ))}
      </div>

      <SearchInput value={search} onChange={setSearch} placeholder={t('cases.searchCases')} className="max-w-sm" />

      {filtered.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="w-6 h-6" />}
          title={t('requests.noRequests')}
          description={t('requests.noRequestsDesc')}
          action={<Button onClick={() => navigate('/requests/create')} icon={<ClipboardPlus className="w-4 h-4" />}>{t('requests.newRequest')}</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(c => {
            const total = c.requiredDocuments.length
            const uploaded = c.requiredDocuments.filter(d => !['missing', 'pending-upload'].includes(d.status)).length

            // Check for unread support messages - only show indicator if status is waiting-for-staff
            const caseSupportRequest = allSupportRequests.find(sr => sr.caseId === c.id)
            const unreadSupportMessages = (caseSupportRequest?.status === 'waiting-for-staff' && caseSupportRequest?.messages?.filter(
              msg => msg.senderType === 'client' && !msg.isRead
            ).length) || 0

            return (
              <Card key={c.id} hover onClick={() => navigate(`/requests/${c.id}`)}>
                <div className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold truncate">{c.caseType}</p>
                        {unreadSupportMessages > 0 && (
                          <div className="w-2 h-2 rounded-full bg-red-500 shadow-md" />
                        )}
                      </div>
                      <p className="text-xs text-[var(--text-secondary)] mt-0.5">{c.clientName}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge variant="status" status={c.status}>
                        {t(`cases.${c.status === 'waiting-for-client' ? 'waitingForClient' : c.status === 'partial-submission' ? 'partialSubmission' : c.status}`)}
                      </Badge>
                      <CardMenu items={[
                        { label: t('requests.deleteRequest'), icon: <Trash2 className="w-3.5 h-3.5" />, onClick: () => setDeleteId(c.id), variant: 'danger' },
                      ]} />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center text-xs text-[var(--text-tertiary)]">
                      <Calendar className="w-3 h-3 me-1" />
                      <span>{formatDate(c.createdAt)}</span>
                    </div>

                    <div>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-[var(--text-tertiary)]">{t('cases.completion')}</span>
                        <span className="font-medium tabular-nums">{uploaded}/{total}</span>
                      </div>
                      <ProgressBar value={uploaded} max={total} />
                    </div>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteId && (
        <Modal open onClose={() => setDeleteId(null)} title={t('requests.deleteRequest')}>
          <p className="text-sm text-[var(--text-secondary)] mb-4">{t('requests.deleteConfirm')}</p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setDeleteId(null)}>{t('common.cancel')}</Button>
            <Button variant="danger" onClick={handleDelete} disabled={acting}>
              {acting ? <Loader2 className="w-4 h-4 animate-spin" /> : t('common.confirm')}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
