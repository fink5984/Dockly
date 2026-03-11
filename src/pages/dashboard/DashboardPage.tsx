import { useNavigate } from 'react-router-dom'
import { useI18n } from '@/contexts/I18nContext'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/Button'
import { getCaseStatusKey } from '@/lib/utils'
import { useSupabaseData } from '@/hooks/useSupabaseData'
import { getCases } from '@/services/casesService'
import { getDashboardStats } from '@/services/settingsService'
import {
  Users, ClipboardList, CheckCircle, AlertTriangle, Clock, FileX, FileCheck,
  ArrowUpRight, TrendingUp, Eye,
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

  // Primary hero KPIs
  const heroKpis = [
    { key: 'totalClients', value: stats.totalClients, icon: Users, accent: '#6366f1' },
    { key: 'openCases', value: stats.openCases, icon: ClipboardList, accent: '#3b82f6' },
    { key: 'completedCases', value: stats.completedCases, icon: CheckCircle, accent: '#16a34a' },
    { key: 'delayedCases', value: stats.delayedCases, icon: AlertTriangle, accent: '#ef4444' },
  ]

  // Secondary mini stats
  const miniStats = [
    { key: 'noSubmission', value: stats.noSubmissionClients, icon: FileX },
    { key: 'partialSubmission', value: stats.partialSubmissionClients, icon: Clock },
    { key: 'fullyCompleted', value: stats.fullyCompletedClients, icon: FileCheck },
  ]

  // Time-based greeting
  const hour = new Date().getHours()
  const greeting = hour < 12 ? t('dashboard.goodMorning') : hour < 17 ? t('dashboard.goodAfternoon') : t('dashboard.goodEvening')

  // Hebrew date
  const hebrewDate = new Intl.DateTimeFormat('he-IL-u-ca-hebrew', {
    day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date())

  return (
    <div className="space-y-5">
      {/* ── Greeting Row ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            {greeting}, {user?.name} 👋
          </h1>
          <p className="text-xs text-[var(--text-tertiary)] mt-0.5">{hebrewDate}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            icon={<Eye className="w-3.5 h-3.5" />}
            onClick={() => navigate('/clients')}
          >
            {t('dashboard.viewAll')}
          </Button>
          <button
            onClick={() => navigate('/requests/create')}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white
                       bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400
                       shadow-sm transition-all"
          >
            <ClipboardList className="w-3.5 h-3.5" />
            {t('requests.newRequest')}
          </button>
        </div>
      </div>

      {/* ── Hero Stats ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {heroKpis.map(kpi => {
          const Icon = kpi.icon
          return (
            <div
              key={kpi.key}
              className="relative overflow-hidden rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)]
                         p-4 group hover:shadow-md transition-shadow"
            >
              {/* Subtle accent background blob */}
              <div
                className="absolute -top-6 -end-6 w-20 h-20 rounded-full opacity-[0.07]"
                style={{ backgroundColor: kpi.accent }}
              />
              <div className="flex items-start justify-between mb-3 relative">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: `${kpi.accent}18` }}
                >
                  <Icon className="w-5 h-5" style={{ color: kpi.accent }} />
                </div>
                <ArrowUpRight className="w-4 h-4 text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <p className="text-2xl font-bold tabular-nums">{kpi.value}</p>
              <p className="text-xs text-[var(--text-tertiary)] mt-0.5">{t(`dashboard.${kpi.key}`)}</p>
            </div>
          )
        })}
      </div>

      {/* ── Mini Stats Row ── */}
      <div className="flex items-center rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] divide-x divide-[var(--border-secondary)] overflow-hidden">
        {miniStats.map(ms => {
          const Icon = ms.icon
          return (
            <div key={ms.key} className="flex-1 flex items-center gap-2 px-4 py-3">
              <Icon className="w-4 h-4 text-[var(--text-tertiary)]" />
              <span className="text-sm font-semibold tabular-nums">{ms.value}</span>
              <span className="text-xs text-[var(--text-tertiary)] hidden sm:inline truncate">{t(`dashboard.${ms.key}`)}</span>
            </div>
          )
        })}
      </div>

      {/* ── Charts Row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Trend chart */}
        <div className="lg:col-span-3 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold">{t('dashboard.progressTrend')}</h3>
              <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                {t('dashboard.last6Months')}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#6366f1' }} />
                {t('dashboard.total')}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#16a34a' }} />
                {t('dashboard.completed')}
              </div>
              <div className="flex items-center gap-1 text-xs font-medium" style={{ color: trendGrowth >= 0 ? '#16a34a' : '#ef4444' }}>
                <TrendingUp className="w-3.5 h-3.5" />
                {trendGrowth > 0 ? '+' : ''}{trendGrowth}%
              </div>
            </div>
          </div>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData}>
                <defs>
                  <linearGradient id="totalGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="compGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#16a34a" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#16a34a" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} width={24} />
                <Tooltip
                  contentStyle={{
                    borderRadius: '10px',
                    border: '1px solid var(--border-primary)',
                    background: 'var(--bg-primary)',
                    fontSize: '12px',
                    boxShadow: '0 4px 12px rgba(0,0,0,.08)',
                  }}
                />
                <Area type="monotone" dataKey="total" stroke="#6366f1" strokeWidth={2.5} fill="url(#totalGrad)" dot={false} />
                <Area type="monotone" dataKey="completed" stroke="#16a34a" strokeWidth={2.5} fill="url(#compGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Donut chart */}
        <div className="lg:col-span-2 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] p-5">
          <h3 className="text-sm font-semibold mb-4">{t('dashboard.statusDistribution')}</h3>

          {pieData.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-52 text-[var(--text-tertiary)]">
              <ClipboardList className="w-10 h-10 mb-2 opacity-30" />
              <p className="text-sm">{t('dashboard.noData')}</p>
            </div>
          ) : (
            <>
              <div className="flex justify-center">
                <div className="w-44 h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={48}
                        outerRadius={72}
                        paddingAngle={3}
                        dataKey="value"
                        strokeWidth={0}
                      >
                        {pieData.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-4">
                {pieData.map(d => (
                  <div key={d.name} className="flex items-center gap-2 text-xs">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                    <span className="text-[var(--text-secondary)] truncate">{t(getCaseStatusKey(d.name))}</span>
                    <span className="font-semibold ms-auto">{d.value}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Support Requests — moved to Topbar indicator ── */}
    </div>
  )
}
