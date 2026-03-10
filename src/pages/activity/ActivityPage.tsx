import { useState } from 'react'
import { useI18n } from '@/contexts/I18nContext'
import { useAuth } from '@/contexts/AuthContext'
import { Card, CardContent } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { SearchInput, Select } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'
import { cn, formatDate } from '@/lib/utils'
import { useSupabaseData } from '@/hooks/useSupabaseData'
import { getActivities } from '@/services/activityService'
import { Clock, FileText, Upload, Download, Send, CheckCircle, XCircle, UserPlus, Settings, Bell, Activity as ActivityIcon } from 'lucide-react'
import type { ActivityType } from '@/types'

const activityIcons: Partial<Record<ActivityType, typeof Clock>> = {
  'case-opened': FileText,
  'document-uploaded': Upload,
  'document-approved': CheckCircle,
  'document-rejected': XCircle,
  'reminder-sent': Send,
  'case-closed': CheckCircle,
  'client-created': UserPlus,
  'support-opened': Bell,
  'support-closed': Bell,
  'note-added': FileText,
  'document-type-created': FileText,
  'document-type-edited': Settings,
  'assignment-updated': UserPlus,
  'staff-added': UserPlus,
}

const activityColors: Partial<Record<ActivityType, string>> = {
  'case-opened': 'bg-blue-500',
  'document-uploaded': 'bg-indigo-500',
  'document-approved': 'bg-green-500',
  'document-rejected': 'bg-red-500',
  'reminder-sent': 'bg-amber-500',
  'case-closed': 'bg-emerald-600',
  'client-created': 'bg-purple-500',
  'support-opened': 'bg-orange-500',
  'support-closed': 'bg-orange-500',
  'note-added': 'bg-cyan-500',
  'document-type-created': 'bg-teal-500',
  'document-type-edited': 'bg-teal-500',
  'assignment-updated': 'bg-gray-500',
  'staff-added': 'bg-violet-500',
}

export function ActivityPage() {
  const { t } = useI18n()
  const { user, workspace } = useAuth()
  const wsId = workspace?.id || user?.workspaceId || ''
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('all')

  const { data: allActivities } = useSupabaseData(() => getActivities(wsId), [], [wsId])

  const types = Array.from(new Set(allActivities.map(a => a.type)))

  const filtered = allActivities.filter(a => {
    if (typeFilter !== 'all' && a.type !== typeFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return a.description.toLowerCase().includes(q) || a.performedByName.toLowerCase().includes(q) || (a.clientName && a.clientName.toLowerCase().includes(q))
    }
    return true
  })

  // Group by date
  const grouped = filtered.reduce<Record<string, typeof filtered>>((acc, activity) => {
    const date = formatDate(activity.timestamp)
    if (!acc[date]) acc[date] = []
    acc[date].push(activity)
    return acc
  }, {})

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">{t('activity.title')}</h1>
        <p className="text-sm text-[var(--text-tertiary)] mt-1">{allActivities.length} {t('activity.events')}</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder={t('activity.searchActivity')} className="flex-1 max-w-sm" />
        <Select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          options={[
            { value: 'all', label: t('common.all') },
            ...types.map(tp => ({ value: tp, label: tp.replace(/_/g, ' ') })),
          ]}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={<ActivityIcon className="w-6 h-6" />} title={t('activity.noActivity')} />
      ) : (
        <div className="relative">
          <div className="absolute top-0 bottom-0 start-5 w-0.5 bg-[var(--border-primary)]" />
          <div className="space-y-6">
            {Object.entries(grouped).map(([date, activities]) => (
              <div key={date}>
                <div className="relative flex items-center gap-3 ps-12 mb-3">
                  <span className="text-xs font-semibold text-[var(--text-tertiary)] bg-[var(--bg-secondary)] px-2 relative z-10">{date}</span>
                </div>
                <div className="space-y-2">
                  {activities.map(activity => {
                    const Icon = activityIcons[activity.type] || Clock
                    const color = activityColors[activity.type] || 'bg-gray-500'
                    return (
                      <div key={activity.id} className="relative flex gap-4 ps-12">
                        <div className={cn('absolute start-3 top-2 w-4 h-4 rounded-full flex items-center justify-center z-10', color)}>
                          <Icon className="w-2.5 h-2.5 text-white" />
                        </div>
                        <Card className="flex-1">
                          <div className="p-3.5">
                            <div className="flex items-start justify-between">
                              <div className="min-w-0">
                                <p className="text-sm">{activity.description}</p>
                                <div className="flex items-center gap-3 text-xs text-[var(--text-tertiary)] mt-1">
                                  <span>{activity.performedByName}</span>
                                  {activity.clientName && <span>• {activity.clientName}</span>}
                                  {activity.caseId && <span className="font-mono">• {activity.caseId}</span>}
                                </div>
                              </div>
                              <span className="text-[10px] text-[var(--text-tertiary)] whitespace-nowrap ms-3">{formatDate(activity.timestamp)}</span>
                            </div>
                          </div>
                        </Card>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
