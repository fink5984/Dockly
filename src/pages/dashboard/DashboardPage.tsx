import { useNavigate } from 'react-router-dom'
import { useI18n } from '@/contexts/I18nContext'
import { useAuth } from '@/contexts/AuthContext'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Button } from '@/components/ui/Button'
import { cn, getCaseStatusKey } from '@/lib/utils'
import { useSupabaseData } from '@/hooks/useSupabaseData'
import { getCases } from '@/services/casesService'
import { getActivities } from '@/services/activityService'
import { getSupportRequests } from '@/services/supportService'
import { getDashboardStats } from '@/services/settingsService'
import {
  Users, ClipboardList, CheckCircle, AlertTriangle, Clock, FileX, FileCheck,
  MessageCircle, ArrowUpRight, TrendingUp, Eye, Bell,
} from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts'

const STATUS_COLORS: Record<string, string> = {
  new: '#3b82f6',
  'waiting-for-client': '#f59e0b',
  'partial-submission': '#8b5cf6',
  'awaiting-review': '#06b6d4',
  completed: '#16a34a',
  closed: '#16a34a',
  delayed: '#dc2626',
}

const defaultStats = {
  totalClients: 0, openCases: 0, completedCases: 0,
  noSubmissionClients: 0, partialSubmissionClients: 0,
  fullyCompletedClients: 0, delayedCases: 0, activeSupportRequests: 0,
}

export function DashboardPage() {
  const { t } = useI18n()
  const { user, workspace } = useAuth()
  const navigate = useNavigate()
  const wsId = workspace?.id || user?.workspaceId || ''

  const { data: stats } = useSupabaseData(() => getDashboardStats(wsId), defaultStats, [wsId])
  const { data: cases } = useSupabaseData(() => getCases(wsId), [], [wsId])
  const { data: activities } = useSupabaseData(() => getActivities(wsId, 10), [], [wsId])
  const { data: supportRequests } = useSupabaseData(() => getSupportRequests(wsId), [], [wsId])

  // Find clients needing attention (no submission or delayed)
  const attentionClients = cases
    .filter(c => c.status === 'delayed' || c.status === 'new' || c.status === 'waiting-for-client')
    .slice(0, 5)

  // Compute pie chart data from real cases
  const statusCounts: Record<string, number> = {}
  cases.forEach(c => {
    statusCounts[c.status] = (statusCounts[c.status] || 0) + 1
  })
  const pieData = Object.entries(statusCounts).map(([status, value]) => ({
    name: status,
    value,
    color: STATUS_COLORS[status] || '#94a3b8',
  }))

  // Compute trend data from real cases (last 6 months)
  const now = new Date()
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const trendData = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1)
    const endOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0)
    const casesUpToMonth = cases.filter(c => new Date(c.createdAt) <= endOfMonth)
    const completedUpToMonth = casesUpToMonth.filter(c => c.status === 'completed' || c.status === 'closed')
    return {
      month: monthNames[d.getMonth()],
      total: casesUpToMonth.length,
      completed: completedUpToMonth.length,
    }
  })

  const trendGrowth = trendData.length >= 2 && trendData[trendData.length - 2].total > 0
    ? Math.round(((trendData[trendData.length - 1].total - trendData[trendData.length - 2].total) / trendData[trendData.length - 2].total) * 100)
    : 0

  // Most missing docs
  const missingCounts: Record<string, number> = {}
  cases.forEach(c => {
    c.requiredDocuments.forEach(d => {
      if (d.status === 'missing') {
        missingCounts[d.documentTypeName] = (missingCounts[d.documentTypeName] || 0) + 1
      }
    })
  })
  const mostMissing = Object.entries(missingCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

  const kpiCards = [
    { key: 'totalClients', value: stats.totalClients, icon: Users, color: 'text-primary-600', bg: 'bg-primary-50 dark:bg-primary-900/20' },
    { key: 'openCases', value: stats.openCases, icon: ClipboardList, color: 'text-info', bg: 'bg-info-light dark:bg-blue-900/20' },
    { key: 'completedCases', value: stats.completedCases, icon: CheckCircle, color: 'text-success', bg: 'bg-success-light dark:bg-green-900/20' },
    { key: 'delayedCases', value: stats.delayedCases, icon: AlertTriangle, color: 'text-danger', bg: 'bg-danger-light dark:bg-red-900/20' },
    { key: 'noSubmission', value: stats.noSubmissionClients, icon: FileX, color: 'text-surface-500', bg: 'bg-surface-100 dark:bg-surface-800' },
    { key: 'partialSubmission', value: stats.partialSubmissionClients, icon: Clock, color: 'text-warning', bg: 'bg-warning-light dark:bg-amber-900/20' },
    { key: 'fullyCompleted', value: stats.fullyCompletedClients, icon: FileCheck, color: 'text-success', bg: 'bg-success-light dark:bg-green-900/20' },
    { key: 'activeSupportRequests', value: stats.activeSupportRequests, icon: MessageCircle, color: 'text-warning', bg: 'bg-warning-light dark:bg-amber-900/20' },
  ]

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('dashboard.title')}</h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">
            {t('dashboard.welcome')}, {user?.name}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" icon={<Bell className="w-3.5 h-3.5" />}>
            {t('cases.sendReminder')}
          </Button>
          <Button size="sm" onClick={() => navigate('/requests/create')} icon={<ClipboardList className="w-3.5 h-3.5" />}>
            {t('requests.newRequest')}
          </Button>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpiCards.map(kpi => {
          const Icon = kpi.icon
          return (
            <Card key={kpi.key} hover className="group">
              <CardContent className="py-4 px-4">
                <div className="flex items-start justify-between mb-3">
                  <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', kpi.bg)}>
                    <Icon className={cn('w-5 h-5', kpi.color)} />
                  </div>
                  <ArrowUpRight className="w-4 h-4 text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <p className="text-2xl font-bold tabular-nums">{kpi.value}</p>
                <p className="text-xs text-[var(--text-tertiary)] mt-1">{t(`dashboard.${kpi.key}`)}</p>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Status distribution */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <h3 className="text-sm font-semibold">{t('dashboard.statusDistribution')}</h3>
          </CardHeader>
          <CardContent className="flex items-center justify-center py-6">
            <div className="w-48 h-48">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value">
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2 ml-4">
              {pieData.map(d => (
                <div key={d.name} className="flex items-center gap-2 text-xs">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                  <span className="text-[var(--text-secondary)]">{t(getCaseStatusKey(d.name))}</span>
                  <span className="font-semibold ml-auto">{d.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Completion trend */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{t('dashboard.progressTrend')}</h3>
              <div className="flex items-center gap-1 text-xs text-success">
                <TrendingUp className="w-3.5 h-3.5" />
                <span>{trendGrowth > 0 ? '+' : ''}{trendGrowth}%</span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-2 pb-4">
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData}>
                  <defs>
                    <linearGradient id="totalGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="compGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#16a34a" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#16a34a" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} width={24} />
                  <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12px' }} />
                  <Area type="monotone" dataKey="total" stroke="#3b82f6" strokeWidth={2} fill="url(#totalGrad)" />
                  <Area type="monotone" dataKey="completed" stroke="#16a34a" strokeWidth={2} fill="url(#compGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Clients needing attention */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{t('dashboard.needingAttention')}</h3>
              <button onClick={() => navigate('/clients')} className="text-xs text-primary-600 hover:underline">
                {t('dashboard.viewAll')}
              </button>
            </div>
          </CardHeader>
          <div className="divide-y divide-[var(--border-secondary)]">
            {attentionClients.map(c => {
              const submitted = c.requiredDocuments.filter(d => d.status !== 'missing').length
              const total = c.requiredDocuments.length
              return (
                <button
                  key={c.id}
                  onClick={() => navigate(`/requests/${c.id}`)}
                  className="w-full flex items-center gap-3 px-5 py-3 hover:bg-[var(--bg-secondary)] transition-colors text-left"
                >
                  <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-bold">
                    {c.clientName.split(' ').map(n => n[0]).join('')}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{c.clientName}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="status" status={c.status} size="sm">{t(`cases.${c.status === 'waiting-for-client' ? 'waitingForClient' : c.status}`)}</Badge>
                      <span className="text-[10px] text-[var(--text-tertiary)]">{submitted}/{total}</span>
                    </div>
                  </div>
                  <Eye className="w-4 h-4 text-[var(--text-tertiary)]" />
                </button>
              )
            })}
          </div>
        </Card>

        {/* Most missing documents */}
        <Card>
          <CardHeader>
            <h3 className="text-sm font-semibold">{t('dashboard.mostMissing')}</h3>
          </CardHeader>
          <CardContent className="space-y-3">
            {mostMissing.map(([name, count]) => (
              <div key={name}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm">{name}</span>
                  <span className="text-xs font-semibold text-danger">{count} {t('cases.missing').toLowerCase()}</span>
                </div>
                <ProgressBar value={count} max={cases.length || 1} />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Recent activity + support */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{t('dashboard.recentActivity')}</h3>
              <button onClick={() => navigate('/activity')} className="text-xs text-primary-600 hover:underline">
                {t('dashboard.viewAll')}
              </button>
            </div>
          </CardHeader>
          <div className="divide-y divide-[var(--border-secondary)]">
            {activities.slice(0, 6).map(a => {
              const iconMap: Record<string, typeof CheckCircle> = {
                'document-uploaded': FileCheck,
                'document-approved': CheckCircle,
                'document-rejected': AlertTriangle,
                'support-opened': MessageCircle,
                'reminder-sent': Bell,
                'case-opened': ClipboardList,
                'case-closed': CheckCircle,
                'client-created': Users,
                'note-added': FileCheck,
              }
              const Icon = iconMap[a.type] || FileCheck
              return (
                <div key={a.id} className="flex items-start gap-3 px-5 py-3">
                  <div className="w-7 h-7 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center shrink-0 mt-0.5">
                    <Icon className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs">
                      <span className="font-medium">{a.userName}</span>{' · '}
                      <span className="text-[var(--text-tertiary)]">{a.description}</span>
                    </p>
                    {a.clientName && <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">{a.clientName}</p>}
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      </div>

      {/* Active support requests */}
      {supportRequests.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">{t('dashboard.activeSupport')}</h3>
              <Badge variant="status" status="open">{supportRequests.length}</Badge>
            </div>
          </CardHeader>
          <div className="divide-y divide-[var(--border-secondary)]">
            {supportRequests.map(sr => (
              <button
                key={sr.id}
                onClick={() => navigate(`/requests/${sr.caseId}`)}
                className="w-full flex items-center gap-4 px-5 py-4 hover:bg-[var(--bg-secondary)] transition-colors text-left"
              >
                <div className="w-10 h-10 rounded-full bg-warning/10 flex items-center justify-center">
                  <MessageCircle className="w-5 h-5 text-warning" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{sr.clientName}</p>
                  <p className="text-xs text-[var(--text-tertiary)] truncate mt-0.5">{sr.issueDescription}</p>
                </div>
                <div className="text-right">
                  <Badge variant="status" status={sr.status}>{t(`support.${sr.status}`)}</Badge>
                  <p className="text-[10px] text-[var(--text-tertiary)] mt-1">{sr.messages.length} {t('support.messages').toLowerCase()}</p>
                </div>
              </button>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
