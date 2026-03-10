import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '@/contexts/I18nContext'
import { useAuth } from '@/contexts/AuthContext'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { SearchInput } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'
import { cn, formatDate } from '@/lib/utils'
import { useRealtimeData } from '@/hooks/useRealtimeData'
import { getCases } from '@/services/casesService'
import { ClipboardPlus, ClipboardList, Calendar, Eye, Download, Filter } from 'lucide-react'
import type { CaseStatus } from '@/types'

type CaseFilter = 'all' | CaseStatus

export function CasesPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { user, workspace } = useAuth()
  const wsId = workspace?.id || user?.workspaceId || ''
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<CaseFilter>('all')

  const { data: allCases } = useRealtimeData(
    () => getCases(wsId),
    [],
    [wsId],
    { tables: ['cases', 'case_documents'] }
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
    { key: 'awaiting-review', labelKey: 'cases.awaitingReview', count: allCases.filter(c => c.status === 'awaiting-review').length },
    { key: 'completed', labelKey: 'cases.completed', count: allCases.filter(c => c.status === 'completed').length },
    { key: 'delayed', labelKey: 'cases.delayed', count: allCases.filter(c => c.status === 'delayed').length },
  ]

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
            // Count documents that are not missing/pending - i.e., have been uploaded
            const uploaded = c.requiredDocuments.filter(d => !['missing', 'pending-upload'].includes(d.status)).length
            const approved = c.requiredDocuments.filter(d => d.status === 'approved').length

            return (
              <Card key={c.id} hover onClick={() => navigate(`/requests/${c.id}`)}>
                <div className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="text-xs font-mono text-[var(--text-tertiary)]">{c.id}</p>
                      <p className="text-sm font-semibold mt-0.5">{c.clientName}</p>
                    </div>
                    <Badge variant="status" status={c.status}>
                      {t(`cases.${c.status === 'waiting-for-client' ? 'waitingForClient' : c.status === 'partial-submission' ? 'partialSubmission' : c.status === 'awaiting-review' ? 'awaitingReview' : c.status}`)}
                    </Badge>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
                      <span className="truncate">{c.caseType}</span>
                      <span>{c.assignedOwnerName}</span>
                    </div>

                    <div>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-[var(--text-tertiary)]">{t('cases.completion')}</span>
                        <span className="font-medium tabular-nums">{uploaded}/{total}</span>
                      </div>
                      <ProgressBar value={uploaded} max={total} />
                    </div>

                    {c.deadline && (
                      <div className="flex items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
                        <Calendar className="w-3 h-3" />
                        <span>{t('cases.deadline')}: {formatDate(c.deadline)}</span>
                      </div>
                    )}

                    {c.supportRequestId && (
                      <Badge variant="status" status="warning" size="sm">{t('support.activeSupportBadge')}</Badge>
                    )}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
