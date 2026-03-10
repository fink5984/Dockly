import { useState } from 'react'
import { useI18n } from '@/contexts/I18nContext'
import { useAuth } from '@/contexts/AuthContext'
import { Card, CardContent } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { SearchInput } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'
import { cn, formatFileSize, getStatusColor, getDocStatusKey } from '@/lib/utils'
import { useSupabaseData } from '@/hooks/useSupabaseData'
import { getCases } from '@/services/casesService'
import { FileText, Download, Eye, Filter, Grid3X3, List, CheckCircle2, XCircle, AlertTriangle, UploadCloud, Clock } from 'lucide-react'
import type { CaseDocument, DocumentStatus } from '@/types'

interface FlatDocument extends CaseDocument {
  caseId: string
  clientName: string
  caseType: string
}

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

const statusBg: Record<DocumentStatus, string> = {
  missing: 'bg-gray-100 dark:bg-gray-900',
  'pending-upload': 'bg-amber-50 dark:bg-amber-950/20',
  uploaded: 'bg-blue-50 dark:bg-blue-950/20',
  received: 'bg-blue-50 dark:bg-blue-950/20',
  'under-review': 'bg-indigo-50 dark:bg-indigo-950/20',
  approved: 'bg-green-50 dark:bg-green-950/20',
  rejected: 'bg-red-50 dark:bg-red-950/20',
  expired: 'bg-orange-50 dark:bg-orange-950/20',
  blurry: 'bg-red-50 dark:bg-red-950/20',
  'missing-pages': 'bg-red-50 dark:bg-red-950/20',
}

export function DocumentsPage() {
  const { t } = useI18n()
  const { user, workspace } = useAuth()
  const wsId = workspace?.id || user?.workspaceId || ''
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<DocumentStatus | 'all'>('all')
  const [view, setView] = useState<'grid' | 'table'>('table')

  const { data: allCases } = useSupabaseData(() => getCases(wsId), [], [wsId])

  // Flatten all documents from all cases
  const allDocs: FlatDocument[] = allCases.flatMap(c =>
    c.requiredDocuments.map(doc => ({
      ...doc,
      caseId: c.id,
      clientName: c.clientName,
      caseType: c.caseType,
    }))
  )

  const filtered = allDocs.filter(doc => {
    if (statusFilter !== 'all' && doc.status !== statusFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return doc.documentTypeName.toLowerCase().includes(q) || doc.clientName.toLowerCase().includes(q) || (doc.fileName && doc.fileName.toLowerCase().includes(q))
    }
    return true
  })

  const statusCounts: Record<string, number> = { all: allDocs.length }
  allDocs.forEach(d => { statusCounts[d.status] = (statusCounts[d.status] || 0) + 1 })

  const statuses: (DocumentStatus | 'all')[] = ['all', 'missing', 'pending-upload', 'uploaded', 'under-review', 'approved', 'rejected', 'expired']

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('documents.title')}</h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">{allDocs.length} {t('documents.documentsLabel').toLowerCase()} {t('common.total').toLowerCase()}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" icon={<Download className="w-3.5 h-3.5" />}>{t('common.export')}</Button>
          <div className="flex rounded-lg overflow-hidden border border-[var(--border-primary)]">
            <button onClick={() => setView('table')} className={cn('p-1.5 transition-colors', view === 'table' ? 'bg-primary-600 text-white' : 'bg-[var(--bg-primary)] text-[var(--text-tertiary)]')}>
              <List className="w-4 h-4" />
            </button>
            <button onClick={() => setView('grid')} className={cn('p-1.5 transition-colors', view === 'grid' ? 'bg-primary-600 text-white' : 'bg-[var(--bg-primary)] text-[var(--text-tertiary)]')}>
              <Grid3X3 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 pb-1">
        {statuses.map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap',
              statusFilter === s
                ? 'bg-primary-600 text-white'
                : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] border border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)]'
            )}
          >
            {s === 'all' ? t('common.all') : t(getDocStatusKey(s))}
            <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-bold', statusFilter === s ? 'bg-white/20' : 'bg-[var(--bg-tertiary)]')}>
              {statusCounts[s] || 0}
            </span>
          </button>
        ))}
      </div>

      <SearchInput value={search} onChange={setSearch} placeholder={t('documents.searchDocuments')} className="max-w-sm" />

      {filtered.length === 0 ? (
        <EmptyState icon={<FileText className="w-6 h-6" />} title={t('documents.noDocuments')} />
      ) : view === 'table' ? (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-primary)]">
                  <th className="text-start p-3 text-xs font-medium text-[var(--text-tertiary)]">{t('documents.documentName')}</th>
                  <th className="text-start p-3 text-xs font-medium text-[var(--text-tertiary)]">{t('cases.client')}</th>
                  <th className="text-start p-3 text-xs font-medium text-[var(--text-tertiary)]">{t('common.status')}</th>
                  <th className="text-start p-3 text-xs font-medium text-[var(--text-tertiary)]">{t('documents.fileName')}</th>
                  <th className="text-start p-3 text-xs font-medium text-[var(--text-tertiary)]">{t('documents.size')}</th>
                  <th className="text-end p-3 text-xs font-medium text-[var(--text-tertiary)]">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((doc, i) => {
                  const StatusIcon = statusIcons[doc.status]
                  return (
                    <tr key={`${doc.caseId}-${doc.documentTypeId}-${i}`} className="border-b border-[var(--border-primary)] last:border-0 hover:bg-[var(--bg-tertiary)] transition-colors">
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <StatusIcon className={cn('w-4 h-4 shrink-0', getStatusColor(doc.status).replace('bg-', 'text-').replace('-100', '-500'))} />
                          <span className="font-medium truncate max-w-[200px]">{doc.documentTypeName}</span>
                        </div>
                      </td>
                      <td className="p-3 text-[var(--text-secondary)]">{doc.clientName}</td>
                      <td className="p-3"><Badge variant="status" status={doc.status} size="sm">{t(getDocStatusKey(doc.status))}</Badge></td>
                      <td className="p-3 text-[var(--text-tertiary)] text-xs truncate max-w-[150px]">{doc.fileName || '-'}</td>
                      <td className="p-3 text-[var(--text-tertiary)] text-xs">{doc.fileSize ? formatFileSize(doc.fileSize) : '-'}</td>
                      <td className="p-3 text-end">
                        <div className="flex justify-end gap-1">
                          {doc.fileName && (
                            <>
                              <button className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)]"><Eye className="w-3.5 h-3.5" /></button>
                              <button className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)]"><Download className="w-3.5 h-3.5" /></button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map((doc, i) => {
            const StatusIcon = statusIcons[doc.status]
            return (
              <Card key={`${doc.caseId}-${doc.documentTypeId}-${i}`} hover>
                <div className={cn('p-4 border-s-4', getStatusColor(doc.status).replace('bg-', 'border-').replace('-100', '-400'))}>
                  <div className="flex items-start justify-between mb-2">
                    <StatusIcon className={cn('w-5 h-5', getStatusColor(doc.status).replace('bg-', 'text-').replace('-100', '-500'))} />
                    <Badge variant="status" status={doc.status} size="sm">{t(getDocStatusKey(doc.status))}</Badge>
                  </div>
                  <p className="text-sm font-medium truncate">{doc.documentTypeName}</p>
                  <p className="text-xs text-[var(--text-tertiary)] truncate mt-0.5">{doc.clientName}</p>
                  {doc.fileName && (
                    <div className="mt-2 p-2 bg-[var(--bg-tertiary)] rounded text-xs truncate text-[var(--text-tertiary)]">
                      {doc.fileName}
                    </div>
                  )}
                  <div className="flex gap-1 mt-3">
                    {doc.fileName && (
                      <>
                        <Button variant="ghost" size="sm" icon={<Eye className="w-3 h-3" />} className="flex-1">{t('documents.preview')}</Button>
                        <Button variant="ghost" size="sm" icon={<Download className="w-3 h-3" />} />
                      </>
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
