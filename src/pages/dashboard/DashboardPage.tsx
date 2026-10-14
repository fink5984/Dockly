import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ClipboardList, Inbox, AlertTriangle, PenLine, ArrowRight, CheckCircle2, Clock, MessageSquare, Send, Plus,
  UserPlus, Upload, Circle, Sparkles, Hourglass, ChevronDown, BarChart3,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/contexts/I18nContext'
import { useAuth } from '@/contexts/AuthContext'
import { useApi } from '@/hooks/useApi'
import { insightsApi } from '@/services'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader, Stat } from '@/components/ui/Misc'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States'
import { ActivityFeed } from '@/components/domain/ActivityFeed'
import type { ActionKind, Dashboard, RequestStatus } from '@/types'

const ACTION_META: Record<ActionKind, { icon: typeof Inbox; tone: string }> = {
  support: { icon: MessageSquare, tone: 'bg-info-soft text-info' },
  review: { icon: Inbox, tone: 'bg-brand-soft text-brand-600' },
  overdue: { icon: AlertTriangle, tone: 'bg-danger-soft text-danger' },
  stalled: { icon: Hourglass, tone: 'bg-warning-soft text-warning' },
  signature: { icon: PenLine, tone: 'bg-surface-3 text-fg-3' },
  unsent: { icon: Send, tone: 'bg-surface-3 text-fg-3' },
}

function ActionQueue({ actions }: { actions: Dashboard['actions'] }) {
  const { t, fmt } = useI18n()
  const [showAll, setShowAll] = useState(false)
  const list = showAll ? actions : actions.slice(0, 6)
  if (actions.length === 0) {
    return (
      <EmptyState compact icon={<CheckCircle2 />} title={t('dashboard.allClear')} description={t('dashboard.allClearHint')} />
    )
  }
  return (
    <>
      <ul className="divide-y divide-line">
        {list.map((a) => {
          const meta = ACTION_META[a.kind]
          const Icon = meta.icon
          return (
            <li key={`${a.kind}-${a.id}`}>
              <Link to={a.href} className="group flex items-center gap-3 px-5 py-3 hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none">
                <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', meta.tone)}><Icon className="size-4" /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-fg">{t(`dashboard.action.${a.kind}`, { count: a.count ?? 0, client: a.clientName })}</p>
                  <p className="truncate text-xs text-fg-3">{a.title}{a.at ? ` · ${a.kind === 'overdue' ? t('dashboard.dueOn', { date: fmt.date(a.at) }) : fmt.relative(a.at)}` : ''}</p>
                </div>
                <ArrowRight className="size-4 shrink-0 text-fg-4 transition-transform group-hover:translate-x-0.5 rtl-flip" aria-hidden />
              </Link>
            </li>
          )
        })}
      </ul>
      {actions.length > 6 && (
        <div className="border-t border-line px-5 py-2.5">
          <button type="button" onClick={() => setShowAll((s) => !s)} className="text-sm font-medium text-brand-600 hover:text-brand-700">
            {showAll ? t('dashboard.showLess') : t('dashboard.showAll', { count: actions.length })}
          </button>
        </div>
      )}
    </>
  )
}

const PIPELINE: RequestStatus[] = ['new', 'waiting-for-client', 'partial-submission', 'completed', 'closed']

function Pipeline({ pipeline }: { pipeline: Dashboard['pipeline'] }) {
  const { t } = useI18n()
  const max = Math.max(1, ...PIPELINE.map((s) => pipeline[s] || 0))
  return (
    <ul className="space-y-3">
      {PIPELINE.map((s) => {
        const n = pipeline[s] || 0
        return (
          <li key={s}>
            <Link to={`/app/requests?status=${s}`} className="group block rounded-md focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]">
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="text-fg-2 group-hover:text-fg">{t(`status.request.${s}`)}</span>
                <span className="font-medium tabular text-fg">{n}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-3">
                <div className="h-full rounded-full bg-brand-500 transition-[width] duration-500" style={{ width: `${(n / max) * 100}%` }} />
              </div>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

/** Single-series weekly bar chart with hover tooltips and an accessible table. */
function WeeklyChart({ trend }: { trend: Dashboard['trend'] }) {
  const { t, fmt } = useI18n()
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...trend.map((w) => w.completed))
  const total = trend.reduce((n, w) => n + w.completed, 0)
  return (
    <div>
      <p className="mb-4 text-sm text-fg-3">{t('dashboard.completedTotal', { count: total })}</p>
      <div className="relative flex h-36 items-end gap-2" aria-hidden>
        {[0.5, 1].map((g) => <div key={g} className="pointer-events-none absolute inset-x-0 border-t border-dashed border-line" style={{ bottom: `${g * 100}%` }} />)}
        {trend.map((w, i) => (
          <div
            key={w.week}
            className="relative flex h-full flex-1 items-end"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <div
              className={cn('w-full rounded-t-[4px] transition-colors', hover === i ? 'bg-brand-600' : 'bg-brand-400')}
              style={{ height: `${Math.max(w.completed ? 4 : 0, (w.completed / max) * 100)}%` }}
            />
            {w.completed === 0 && <div className="absolute bottom-0 h-px w-full bg-line-2" />}
            {hover === i && (
              <div className="absolute bottom-full start-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs shadow-md rtl:translate-x-1/2">
                <p className="font-medium text-fg">{t('dashboard.weekOf', { date: fmt.date(w.week, { day: 'numeric', month: 'short' }) })}</p>
                <p className="text-fg-3"><span className="font-semibold tabular text-fg">{w.completed}</span> {t('dashboard.completedShort')} · <span className="tabular">{w.uploads}</span> {t('dashboard.uploadsShort')}</p>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2 text-2xs text-fg-4" aria-hidden>
        {trend.map((w) => <span key={w.week} className="flex-1 text-center">{fmt.date(w.week, { day: 'numeric', month: 'numeric' })}</span>)}
      </div>
      <table className="sr-only">
        <caption>{t('dashboard.trendTitle')}</caption>
        <thead><tr><th>{t('dashboard.week')}</th><th>{t('dashboard.completedShort')}</th><th>{t('dashboard.uploadsShort')}</th></tr></thead>
        <tbody>{trend.map((w) => <tr key={w.week}><td>{fmt.date(w.week)}</td><td>{w.completed}</td><td>{w.uploads}</td></tr>)}</tbody>
      </table>
    </div>
  )
}

function GettingStarted({ o }: { o: Dashboard['onboarding'] }) {
  const { t } = useI18n()
  const steps = [
    { done: o.hasClient, label: t('dashboard.start.client'), to: '/app/clients?new=1' },
    { done: o.hasRequest, label: t('dashboard.start.request'), to: '/app/requests/new' },
    { done: o.hasSent, label: t('dashboard.start.send'), to: '/app/requests' },
    { done: o.hasBranding, label: t('dashboard.start.branding'), to: '/app/settings/branding' },
    { done: o.hasSignature, label: t('dashboard.start.signature'), to: '/app/signatures/new' },
  ]
  const done = steps.filter((s) => s.done).length
  if (done === steps.length) return null
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-600"><Sparkles className="size-5" /></div>
        <div className="min-w-0 flex-1">
          <h2 className="text-md font-semibold">{t('dashboard.start.title')}</h2>
          <p className="text-sm text-fg-3">{t('dashboard.start.progress', { done, total: steps.length })}</p>
        </div>
      </div>
      <ol className="grid border-t border-line sm:grid-cols-5">
        {steps.map((s, i) => (
          <li key={i} className="border-b border-line sm:border-b-0 sm:border-e last:border-0">
            <Link to={s.to} className={cn('flex h-full items-center gap-2.5 px-4 py-3 text-sm hover:bg-surface-2', s.done ? 'text-fg-3' : 'font-medium text-fg')}>
              {s.done ? <CheckCircle2 className="size-4 shrink-0 text-success" /> : <Circle className="size-4 shrink-0 text-fg-4" />}
              <span className={cn(s.done && 'line-through decoration-fg-4')}>{s.label}</span>
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  )
}

const INSIGHTS_KEY = 'dockly-dashboard-insights'

export default function DashboardPage() {
  const { t, fmt } = useI18n()
  const { user, can } = useAuth()
  const { data, error, loading, refetch } = useApi('dashboard', insightsApi.dashboard, { topics: ['requests', 'signatures', 'support', 'clients'] })
  const [insightsOpen, setInsightsOpen] = useState(() => {
    try { return localStorage.getItem(INSIGHTS_KEY) === 'open' } catch { return false }
  })
  const toggleInsights = (open: boolean) => {
    setInsightsOpen(open)
    try { localStorage.setItem(INSIGHTS_KEY, open ? 'open' : 'closed') } catch { /* ignore */ }
  }
  const hour = new Date().getHours()
  const greeting = hour < 12 ? t('dashboard.morning') : hour < 18 ? t('dashboard.afternoon') : t('dashboard.evening')

  return (
    <>
      <PageHeader
        title={`${greeting}, ${user?.name?.split(' ')[0] || ''}`}
        description={t('dashboard.subtitle')}
        actions={can('member') && (
          <>
            <Button to="/app/clients?new=1" icon={<UserPlus className="size-4" />}>{t('dashboard.addClient')}</Button>
            <Button to="/app/requests/new" variant="primary" icon={<Plus className="size-4" />}>{t('dashboard.newRequest')}</Button>
          </>
        )}
      />

      {error ? <Card><ErrorState onRetry={refetch} /></Card> : (
        <div className="space-y-6">
          {data && <GettingStarted o={data.onboarding} />}

          <section aria-label={t('dashboard.kpis')} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {loading || !data ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[106px] rounded-xl" />) : (
              <>
                <Stat label={t('dashboard.kpi.active')} value={fmt.number(data.kpis.activeRequests)} hint={t('dashboard.kpi.activeHint', { count: data.kpis.drafts })} icon={<ClipboardList />} to="/app/requests?status=open" />
                <Stat label={t('dashboard.kpi.review')} value={fmt.number(data.kpis.documentsNeedingReview)} hint={t('dashboard.kpi.reviewHint', { count: data.kpis.requestsNeedingReview })} icon={<Inbox />} tone={data.kpis.documentsNeedingReview ? 'brand' : 'neutral'} to="/app/requests?status=needs-review" />
                <Stat label={t('dashboard.kpi.overdue')} value={fmt.number(data.kpis.overdue)} hint={t('dashboard.kpi.awaiting', { count: data.kpis.awaitingClient })} icon={<Clock />} tone={data.kpis.overdue ? 'danger' : 'neutral'} to="/app/requests?status=overdue" />
                <Stat label={t('dashboard.kpi.signatures')} value={fmt.number(data.kpis.pendingSignatures)} hint={t('dashboard.kpi.signedMonth', { count: data.kpis.signedThisMonth })} icon={<PenLine />} to="/app/signatures" />
              </>
            )}
          </section>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Card className="overflow-hidden">
              <CardHeader title={t('dashboard.actionRequired')} description={t('dashboard.actionRequiredHint')} />
              {loading || !data ? <div className="space-y-3 px-5 pb-5">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-11" />)}</div> : <ActionQueue actions={data.actions} />}
            </Card>
            <Card>
              <CardHeader title={t('dashboard.pipeline')} action={<Link to="/app/requests" className="text-sm font-medium text-brand-600 hover:text-brand-700">{t('common.viewAll')}</Link>} />
              <CardBody>{data ? <Pipeline pipeline={data.pipeline} /> : <Skeleton className="h-40" />}</CardBody>
            </Card>
          </div>

          <section aria-label={t('dashboard.insights')}>
            <button
              type="button"
              aria-expanded={insightsOpen}
              aria-controls="dashboard-insights-panel"
              onClick={() => toggleInsights(!insightsOpen)}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-fg-2 hover:bg-surface-3 hover:text-fg focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
            >
              <BarChart3 className="size-4" />
              {insightsOpen ? t('dashboard.hideInsights') : t('dashboard.showInsights')}
              <ChevronDown className={cn('size-4 transition-transform', insightsOpen && 'rotate-180')} />
            </button>
            {insightsOpen && <div id="dashboard-insights-panel" className="mt-3"><Insights data={data} /></div>}
          </section>
        </div>
      )}
    </>
  )
}

/** Weekly trend + recent activity. Mounted only when opened, so the activity feed isn't fetched otherwise. */
function Insights({ data }: { data: Dashboard | undefined }) {
  const { t, fmt } = useI18n()
  const activity = useApi('activity:recent', () => insightsApi.activity({ limit: 12 }), { topics: ['activity'] })
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader
          title={t('dashboard.trendTitle')}
          description={data?.kpis.avgDaysToComplete != null ? t('dashboard.avgDays', { days: fmt.number(data.kpis.avgDaysToComplete) }) : undefined}
        />
        <CardBody>{data ? <WeeklyChart trend={data.trend} /> : <Skeleton className="h-44" />}</CardBody>
      </Card>
      <Card>
        <CardHeader title={t('dashboard.recentActivity')} action={<Link to="/app/activity" className="text-sm font-medium text-brand-600 hover:text-brand-700">{t('common.viewAll')}</Link>} />
        <CardBody>
          {activity.loading ? <Skeleton className="h-44" /> : activity.data && activity.data.length > 0 ? (
            <ActivityFeed items={activity.data.slice(0, 7)} compact />
          ) : (
            <EmptyState compact icon={<Upload />} title={t('activity.empty')} description={t('activity.emptyHint')} />
          )}
        </CardBody>
      </Card>
    </div>
  )
}
