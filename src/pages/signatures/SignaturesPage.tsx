import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '@/contexts/I18nContext'
import { useAuth } from '@/contexts/AuthContext'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { SearchInput } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { cn, formatDate } from '@/lib/utils'
import { useRealtimeData } from '@/hooks/useRealtimeData'
import { getSignatureRequests, cancelSignatureRequest, deleteSignatureRequest } from '@/services/signaturesService'
import { useApp } from '@/contexts/AppContext'
import {
  PenLine, Plus, FileText, Copy, Eye, Trash2,
  XCircle, CheckCircle2, Clock, AlertTriangle, Loader2, Send,
} from 'lucide-react'
import type { SignatureRequestStatus } from '@/types'

type SigFilter = 'all' | SignatureRequestStatus

const statusConfig: Record<SignatureRequestStatus, { color: string; icon: typeof CheckCircle2 }> = {
  draft: { color: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300', icon: FileText },
  pending: { color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400', icon: Clock },
  viewed: { color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400', icon: Eye },
  signed: { color: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400', icon: CheckCircle2 },
  declined: { color: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400', icon: XCircle },
  expired: { color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400', icon: AlertTriangle },
  cancelled: { color: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400', icon: XCircle },
}

export function SignaturesPage() {
  const { t, direction } = useI18n()
  const navigate = useNavigate()
  const { user, workspace } = useAuth()
  const wsId = workspace?.id || user?.workspaceId || ''
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<SigFilter>('all')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [cancelId, setCancelId] = useState<string | null>(null)
  const [acting, setActing] = useState(false)
  const { addToast } = useApp()

  const { data: requests, refetch } = useRealtimeData(
    () => getSignatureRequests(wsId),
    [],
    [wsId],
    { tables: ['signature_requests', 'signature_fields'] }
  )

  const filtered = requests.filter(r => {
    if (search) {
      const q = search.toLowerCase()
      if (!r.title.toLowerCase().includes(q) && !r.clientName.toLowerCase().includes(q)) return false
    }
    if (filter !== 'all' && r.status !== filter) return false
    return true
  })

  const stats = {
    total: requests.length,
    pending: requests.filter(r => ['pending', 'viewed'].includes(r.status)).length,
    signed: requests.filter(r => r.status === 'signed').length,
  }

  const filters: { key: SigFilter; labelKey: string; count: number }[] = [
    { key: 'all', labelKey: 'common.all', count: requests.length },
    { key: 'pending', labelKey: 'signatures.pending', count: requests.filter(r => r.status === 'pending').length },
    { key: 'viewed', labelKey: 'signatures.viewed', count: requests.filter(r => r.status === 'viewed').length },
    { key: 'signed', labelKey: 'signatures.signed', count: requests.filter(r => r.status === 'signed').length },
    { key: 'expired', labelKey: 'signatures.expired', count: requests.filter(r => r.status === 'expired').length },
    { key: 'cancelled', labelKey: 'signatures.cancelled', count: requests.filter(r => r.status === 'cancelled').length },
  ]

  const handleCopyLink = (token: string) => {
    const url = `${window.location.origin}/sign/${token}`
    navigator.clipboard.writeText(url)
    addToast({ title: t('signatures.linkCopied'), type: 'success' })
  }

  const handleCancel = async () => {
    if (!cancelId) return
    setActing(true)
    try {
      await cancelSignatureRequest(cancelId)
      refetch()
      setCancelId(null)
    } catch { /* ignore */ } finally { setActing(false) }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    setActing(true)
    try {
      await deleteSignatureRequest(deleteId)
      refetch()
      setDeleteId(null)
    } catch { /* ignore */ } finally { setActing(false) }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('signatures.title')}</h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">{t('signatures.subtitle')}</p>
        </div>
        <Button onClick={() => navigate('/signatures/create')} icon={<Plus className="w-4 h-4" />}>
          {t('signatures.newRequest')}
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: t('signatures.totalRequests'), value: stats.total, icon: FileText, color: 'text-indigo-500' },
          { label: t('signatures.pendingSignatures'), value: stats.pending, icon: Clock, color: 'text-amber-500' },
          { label: t('signatures.completedSignatures'), value: stats.signed, icon: CheckCircle2, color: 'text-green-500' },
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

      <SearchInput value={search} onChange={setSearch} placeholder={t('signatures.searchRequests')} className="max-w-sm" />

      {/* List */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<PenLine className="w-6 h-6" />}
          title={t('signatures.noRequests')}
          description={t('signatures.noRequestsDesc')}
          action={<Button onClick={() => navigate('/signatures/create')} icon={<Plus className="w-4 h-4" />}>{t('signatures.newRequest')}</Button>}
        />
      ) : (
        <div className="space-y-3">
          {filtered.map(req => {
            const sc = statusConfig[req.status]
            const StatusIcon = sc.icon
            const filledFields = req.fields.filter(f => f.value).length
            const totalFields = req.fields.length

            return (
              <Card
                key={req.id}
                className="p-4 hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => navigate(`/signatures/${req.id}`)}
              >
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  {/* Icon */}
                  <div className="hidden sm:flex shrink-0 w-10 h-10 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 items-center justify-center">
                    <PenLine className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-sm truncate">{req.title}</h3>
                      <Badge className={cn('text-[10px] px-2 py-0.5 rounded-full', sc.color)}>
                        <StatusIcon className="w-3 h-3 me-1 inline" />
                        {t(`signatures.${req.status}`)}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-[var(--text-tertiary)]">
                      <span>{req.clientName}</span>
                      <span>{req.documentFileName}</span>
                      <span>{formatDate(req.createdAt)}</span>
                      {totalFields > 0 && (
                        <span>{filledFields}/{totalFields} {t('signatures.fieldsFilled')}</span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                    {req.status === 'pending' && (
                      <button
                        onClick={() => handleCopyLink(req.publicToken)}
                        className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
                        title={t('signatures.copyLink')}
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                    )}
                    {(req.status === 'pending' || req.status === 'viewed') && (
                      <button
                        onClick={() => setCancelId(req.id)}
                        className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors text-amber-500"
                        title={t('signatures.cancel')}
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    )}
                    {(req.status === 'signed' || req.status === 'cancelled' || req.status === 'expired') && (
                      <button
                        onClick={() => setDeleteId(req.id)}
                        className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors text-red-500"
                        title={t('signatures.delete')}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* Cancel modal */}
      {cancelId && (
        <Modal open onClose={() => setCancelId(null)} title={t('signatures.cancel')}>
          <p className="text-sm text-[var(--text-secondary)] mb-4">{t('signatures.cancelConfirm')}</p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setCancelId(null)}>{t('common.cancel')}</Button>
            <Button variant="danger" onClick={handleCancel} disabled={acting}>
              {acting ? <Loader2 className="w-4 h-4 animate-spin" /> : t('common.confirm')}
            </Button>
          </div>
        </Modal>
      )}

      {/* Delete modal */}
      {deleteId && (
        <Modal open onClose={() => setDeleteId(null)} title={t('signatures.delete')}>
          <p className="text-sm text-[var(--text-secondary)] mb-4">{t('signatures.deleteConfirm')}</p>
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
