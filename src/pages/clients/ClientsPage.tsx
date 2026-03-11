import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '@/contexts/I18nContext'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { SearchInput } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { cn } from '@/lib/utils'
import { useRealtimeData } from '@/hooks/useRealtimeData'
import { getClients, createClient } from '@/services/clientsService'
import { getCases } from '@/services/casesService'
import { useAuth } from '@/contexts/AuthContext'
import {
  UserPlus, MoreHorizontal, Eye, ClipboardList, Send, FileText,
  CheckCircle, Clock, Users, Filter,
} from 'lucide-react'

type ClientFilter = 'all' | 'no-submission' | 'partial' | 'completed' | 'delayed' | 'active-support'

export function ClientsPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { user, workspace } = useAuth()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<ClientFilter>('all')
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [newClient, setNewClient] = useState({ name: '', email: '', phone: '', company: '', notes: '' })
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  const wsId = workspace?.id || user?.workspaceId || ''
  const { data: clients, refetch: refetchClients } = useRealtimeData(
    () => getClients(wsId),
    [],
    [wsId],
    { tables: ['clients'] }
  )
  const { data: cases } = useRealtimeData(
    () => getCases(wsId),
    [],
    [wsId],
    { tables: ['cases', 'case_documents'] }
  )

  // Compute client data with case info
  const clientsWithData = clients.map(client => {
    const clientCases = cases.filter(c => c.clientId === client.id)
    const latestCase = clientCases[0]
    const totalRequired = latestCase?.requiredDocuments.length || 0
    const totalReceived = latestCase?.requiredDocuments.filter(d => d.status !== 'missing').length || 0
    const hasSupport = !!latestCase?.supportRequestId

    let submissionStatus: string = 'no-submission'
    if (latestCase) {
      if (latestCase.status === 'completed') submissionStatus = 'completed'
      else if (latestCase.status === 'delayed') submissionStatus = 'delayed'
      else if (totalReceived > 0 && totalReceived < totalRequired) submissionStatus = 'partial'
      else if (totalReceived === 0) submissionStatus = 'no-submission'
    }

    return {
      ...client, latestCase, totalRequired, totalReceived, submissionStatus, hasSupport,
    }
  })

  const filtered = clientsWithData.filter(c => {
    if (search && !c.name.toLowerCase().includes(search.toLowerCase()) && !c.phone.includes(search)) return false
    if (filter === 'all') return true
    if (filter === 'active-support') return c.hasSupport
    return c.submissionStatus === filter
  })

  const filterTabs: { key: ClientFilter; labelKey: string; count: number }[] = [
    { key: 'all', labelKey: 'clients.all', count: clientsWithData.length },
    { key: 'no-submission', labelKey: 'clients.noSubmission', count: clientsWithData.filter(c => c.submissionStatus === 'no-submission').length },
    { key: 'partial', labelKey: 'clients.partial', count: clientsWithData.filter(c => c.submissionStatus === 'partial').length },
    { key: 'completed', labelKey: 'clients.completed', count: clientsWithData.filter(c => c.submissionStatus === 'completed').length },
    { key: 'delayed', labelKey: 'clients.delayed', count: clientsWithData.filter(c => c.submissionStatus === 'delayed').length },
    { key: 'active-support', labelKey: 'clients.activeSupport', count: clientsWithData.filter(c => c.hasSupport).length },
  ]

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('clients.title')}</h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">{clientsWithData.length} {t('common.total').toLowerCase()}</p>
        </div>
        <Button onClick={() => setAddModalOpen(true)} icon={<UserPlus className="w-4 h-4" />}>
          {t('clients.addClient')}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-1.5 overflow-x-auto pb-1">
        {filterTabs.map(ft => (
          <button
            key={ft.key}
            onClick={() => setFilter(ft.key)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap',
              filter === ft.key
                ? 'bg-primary-600 text-white'
                : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] border border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)]'
            )}
          >
            {t(ft.labelKey)}
            <span className={cn(
              'text-[10px] px-1.5 py-0.5 rounded-full font-bold',
              filter === ft.key ? 'bg-white/20' : 'bg-[var(--bg-tertiary)]'
            )}>
              {ft.count}
            </span>
          </button>
        ))}
      </div>

      {/* Search */}
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder={t('clients.searchClients')}
        className="max-w-sm"
      />

      {/* Client list */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<Users className="w-6 h-6" />}
          title={t('clients.noClients')}
          description={t('clients.noClientsDesc')}
          action={<Button onClick={() => setAddModalOpen(true)} icon={<UserPlus className="w-4 h-4" />}>{t('clients.addClient')}</Button>}
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border-primary)]">
                  <th className="text-start text-xs font-semibold text-[var(--text-tertiary)] px-5 py-3">{t('clients.clientName')}</th>
                  <th className="text-start text-xs font-semibold text-[var(--text-tertiary)] px-5 py-3 hidden md:table-cell">{t('clients.phone')}</th>
                  <th className="text-start text-xs font-semibold text-[var(--text-tertiary)] px-5 py-3">{t('clients.progress')}</th>
                  <th className="text-start text-xs font-semibold text-[var(--text-tertiary)] px-5 py-3 hidden md:table-cell">{t('clients.status')}</th>
                  <th className="text-start text-xs font-semibold text-[var(--text-tertiary)] px-5 py-3 hidden xl:table-cell">{t('clients.assignedOwner')}</th>
                  <th className="text-end text-xs font-semibold text-[var(--text-tertiary)] px-5 py-3">{t('clients.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-secondary)]">
                {filtered.map(client => (
                  <tr key={client.id} className="group hover:bg-[var(--bg-secondary)] transition-colors cursor-pointer" onClick={() => navigate(`/clients/${client.id}`)}>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-bold shrink-0">
                          {client.name.split(' ').map(n => n[0]).join('')}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{client.name}</p>
                          <p className="text-xs text-[var(--text-tertiary)] md:hidden">{client.phone}</p>
                        </div>
                        {client.hasSupport && (
                          <div className="w-2 h-2 rounded-full bg-warning animate-pulse" title="Active support" />
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 hidden md:table-cell">
                      <span className="text-sm text-[var(--text-secondary)]">{client.phone}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2 min-w-[120px]">
                        <ProgressBar value={client.totalReceived} max={client.totalRequired || 1} className="flex-1" />
                        <span className="text-xs text-[var(--text-tertiary)] tabular-nums whitespace-nowrap">{client.totalReceived}/{client.totalRequired}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 hidden md:table-cell">
                      <Badge variant="status" status={client.submissionStatus}>
                        {client.submissionStatus === 'no-submission' ? t('clients.noSubmission') :
                         client.submissionStatus === 'partial' ? t('clients.partial') :
                         client.submissionStatus === 'completed' ? t('clients.completed') :
                         client.submissionStatus === 'delayed' ? t('clients.delayed') :
                         t('clients.awaitingReview')}
                      </Badge>
                    </td>
                    <td className="px-5 py-3.5 hidden xl:table-cell">
                      <span className="text-sm text-[var(--text-secondary)]">{client.assignedOwner}</span>
                    </td>
                    <td className="px-5 py-3.5 text-end" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => navigate(`/clients/${client.id}`)} className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)]" title={t('clients.openClient')}>
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        {client.latestCase && (
                          <button onClick={() => navigate(`/requests/${client.latestCase!.id}`)} className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)]" title={t('clients.openCase')}>
                            <ClipboardList className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)]" title={t('clients.sendReminder')}>
                          <Send className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Add Client Modal */}
      <Modal open={addModalOpen} onClose={() => { setAddModalOpen(false); setCreateError('') }} title={t('clients.addClient')} size="md">
        <div className="p-6 space-y-4">
          {createError && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
              {createError}
            </div>
          )}
          <Input label={t('clients.clientName')} placeholder="John Doe" value={newClient.name} onChange={e => setNewClient(p => ({ ...p, name: e.target.value }))} />
          <div className="grid grid-cols-2 gap-4">
            <Input label={t('clients.email')} type="email" placeholder="john@mail.com" value={newClient.email} onChange={e => setNewClient(p => ({ ...p, email: e.target.value }))} />
            <Input label={t('clients.phone')} type="tel" placeholder="+972-50-000-0000" value={newClient.phone} onChange={e => setNewClient(p => ({ ...p, phone: e.target.value }))} />
          </div>
          <Input label={t('clients.company')} placeholder="Company name (optional)" value={newClient.company} onChange={e => setNewClient(p => ({ ...p, company: e.target.value }))} />
          <Textarea label={t('clients.notes')} placeholder="Internal notes..." rows={3} value={newClient.notes} onChange={e => setNewClient(p => ({ ...p, notes: e.target.value }))} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => { setAddModalOpen(false); setCreateError('') }}>{t('common.cancel')}</Button>
            <Button
              loading={creating}
              onClick={async () => {
                if (!newClient.name.trim() || !newClient.email.trim()) {
                  setCreateError(t('clients.nameEmailRequired') || 'Name and email are required')
                  return
                }
                const wsId = workspace?.id || user?.workspaceId || ''
                if (!wsId) {
                  setCreateError('No workspace found')
                  return
                }
                setCreating(true)
                setCreateError('')
                try {
                  await createClient(wsId, {
                    name: newClient.name.trim(),
                    email: newClient.email.trim(),
                    phone: newClient.phone.trim(),
                    company: newClient.company.trim() || undefined,
                    notes: newClient.notes.trim() || undefined,
                    assignedOwner: user?.name || '',
                  })
                  setNewClient({ name: '', email: '', phone: '', company: '', notes: '' })
                  setAddModalOpen(false)
                  refetchClients()
                } catch (err: any) {
                  setCreateError(err?.message || 'Failed to create client')
                } finally {
                  setCreating(false)
                }
              }}
            >
              {t('common.save')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
