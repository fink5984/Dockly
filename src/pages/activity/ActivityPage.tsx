import { useEffect, useState } from 'react'
import { Activity as ActivityIcon } from 'lucide-react'
import { useI18n } from '@/contexts/I18nContext'
import { insightsApi } from '@/services'
import { subscribeLive } from '@/lib/live'
import { Card, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Segmented } from '@/components/ui/Field'
import { PageHeader } from '@/components/ui/Misc'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States'
import { ActivityFeed } from '@/components/domain/ActivityFeed'
import type { ActivityEvent } from '@/types'

const FILTERS: Record<string, (a: ActivityEvent) => boolean> = {
  all: () => true,
  docs: (a) => a.type.startsWith('document'),
  requests: (a) => a.type.startsWith('request') || a.type === 'reminder_sent',
  signatures: (a) => a.type.startsWith('signature'),
  messages: (a) => a.type.startsWith('support') || a.type.endsWith('_sent'),
}

const PAGE = 50

export default function ActivityPage() {
  const { t } = useI18n()
  const [items, setItems] = useState<ActivityEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [more, setMore] = useState(true)
  const [error, setError] = useState(false)
  const [filter, setFilter] = useState('all')

  const load = async (before?: string) => {
    setLoading(true)
    setError(false)
    try {
      const page = await insightsApi.activity({ limit: PAGE, before })
      setItems((cur) => (before ? [...cur, ...page] : page))
      setMore(page.length === PAGE)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])
  useEffect(() => subscribeLive((e) => {
    if (e.topic === 'activity') insightsApi.activity({ limit: 10 }).then((fresh) => setItems((cur) => [...fresh.filter((f) => !cur.some((c) => c.id === f.id)), ...cur])).catch(() => {})
  }), [])

  const visible = items.filter(FILTERS[filter])
  return (
    <>
      <PageHeader title={t('activity.title')} description={t('activity.subtitle')} />
      <Card>
        <div className="border-b border-line px-5 py-3">
          <Segmented size="sm" label={t('common.filter')} value={filter} onChange={setFilter} options={[
            { value: 'all', label: t('activity.filterAll') }, { value: 'docs', label: t('activity.filterDocs') }, { value: 'requests', label: t('activity.filterRequests') },
            { value: 'signatures', label: t('activity.filterSignatures') }, { value: 'messages', label: t('activity.filterMessages') },
          ]} />
        </div>
        <CardBody className="pt-5">
          {error && !items.length ? <ErrorState onRetry={() => load()} /> : loading && !items.length ? <Skeleton className="h-64" /> : visible.length === 0 ? (
            <EmptyState compact icon={<ActivityIcon />} title={t('activity.empty')} description={t('activity.emptyHint')} />
          ) : <ActivityFeed items={visible} />}
          {more && items.length > 0 && (
            <div className="mt-6 text-center"><Button loading={loading} onClick={() => load(items[items.length - 1].timestamp)}>{t('activity.loadMore')}</Button></div>
          )}
        </CardBody>
      </Card>
    </>
  )
}
