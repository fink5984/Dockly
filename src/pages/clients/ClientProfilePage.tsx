import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useI18n } from '@/contexts/I18nContext'
import { Card, CardHeader } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { cn, formatDate } from '@/lib/utils'
import { useSupabaseData } from '@/hooks/useSupabaseData'
import { getClients, updateClient } from '@/services/clientsService'
import { getCases } from '@/services/casesService'
import { getSignatureRequests } from '@/services/signaturesService'
import { useAuth } from '@/contexts/AuthContext'
import {
  ArrowLeft, ArrowRight, Phone, Mail, Building2, Calendar,
  ClipboardList, Link2, PenLine, Pencil, Hash,
  CheckCircle2, Clock, FileText, XCircle, Eye, StickyNote, Loader2,
} from 'lucide-react'

export function ClientProfilePage() {
  const { id } = useParams()
  const { t, direction } = useI18n()
  const navigate = useNavigate()
  const { user, workspace } = useAuth()
  const wsId = workspace?.id || user?.workspaceId || ''
  const isRtl = direction === 'rtl'
  const BackArrow = isRtl ? ArrowRight : ArrowLeft

  const { data: allClients, loading, refetch } = useSupabaseData(() => getClients(wsId), [], [wsId])
  const { data: allCases } = useSupabaseData(() => getCases(wsId), [], [wsId])
  const { data: allSignatures } = useSupabaseData(() => getSignatureRequests(wsId), [], [wsId])

  const client = allClients.find(c => c.id === id)

  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState({
    name: '', email: '', phone: '', company: '', notes: '', status: 'active' as string,
  })
  const [saving, setSaving] = useState(false)

  if (loading) return (
    <div className="flex items-center justify-center py-32">
      <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
    </div>
  )

  if (!client) return <div className="p-8 text-center">{t('common.noResults')}</div>

  const clientCases = allCases.filter(c => c.clientId === client.id)
  const clientSignatures = allSignatures.filter(s => s.clientId === client.id)

  const openEdit = () => {
    setEditForm({
      name: client.name,
      email: client.email,
      phone: client.phone,
      company: client.company || '',
      notes: client.notes || '',
      status: client.status,
    })
    setEditOpen(true)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateClient(client.id, {
        name: editForm.name,
        email: editForm.email,
        phone: editForm.phone,
        company: editForm.company || null,
        notes: editForm.notes || null,
        status: editForm.status,
      })
      await refetch()
      setEditOpen(false)
    } catch (e) {
      console.error('Failed to update client:', e)
    } finally {
      setSaving(false)
    }
  }

  const statusColors: Record<string, string> = {
    active: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
    inactive: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
    archived: 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400',
  }

  const infoItems = [
    { icon: Phone, label: t('clients.phone'), value: client.phone },
    { icon: Mail, label: t('clients.email'), value: client.email },
    { icon: Building2, label: t('clients.company'), value: client.company },
    { icon: Hash, label: t('clients.idNumber'), value: client.fullName !== client.name ? client.fullName : null },
    { icon: Calendar, label: t('clients.createdAt'), value: formatDate(client.createdAt) },
    { icon: StickyNote, label: t('clients.notes'), value: client.notes },
  ].filter(item => item.value)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/clients')} className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)]">
          <BackArrow className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold">{client.name}</h1>
          <p className="text-sm text-[var(--text-tertiary)]">{t('clients.profile')}</p>
        </div>
      </div>

      {/* Client details card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-primary-100 text-primary-700 flex items-center justify-center text-lg font-bold">
                {client.name.split(' ').map(n => n[0]).join('')}
              </div>
              <div>
                <h2 className="text-base font-semibold">{client.name}</h2>
                <Badge className={cn('text-[10px] px-2 py-0.5 rounded-full mt-0.5', statusColors[client.status])}>
                  {t(`clients.${client.status}`)}
                </Badge>
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={openEdit} icon={<Pencil className="w-3.5 h-3.5" />}>
              {t('clients.editClient')}
            </Button>
          </div>
        </CardHeader>
        <div className="px-5 pb-5 pt-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {infoItems.map((item, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-[var(--bg-secondary)]">
                <item.icon className="w-4 h-4 mt-0.5 text-[var(--text-tertiary)] shrink-0" />
                <div className="min-w-0">
                  <p className="text-[11px] text-[var(--text-tertiary)] mb-0.5">{item.label}</p>
                  <p className="text-sm font-medium break-words">{item.value}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* Edit modal */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={t('clients.editClient')} size="md">
        <div className="space-y-4 p-1">
          <Input
            label={t('clients.clientName')}
            value={editForm.name}
            onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label={t('clients.email')}
              type="email"
              value={editForm.email}
              onChange={e => setEditForm(prev => ({ ...prev, email: e.target.value }))}
            />
            <Input
              label={t('clients.phone')}
              type="tel"
              value={editForm.phone}
              onChange={e => setEditForm(prev => ({ ...prev, phone: e.target.value }))}
            />
          </div>
          <Input
            label={t('clients.company')}
            value={editForm.company}
            onChange={e => setEditForm(prev => ({ ...prev, company: e.target.value }))}
          />
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-[var(--text-primary)]">{t('clients.status')}</label>
            <select
              value={editForm.status}
              onChange={e => setEditForm(prev => ({ ...prev, status: e.target.value }))}
              className="w-full h-10 px-3 rounded-lg border text-sm bg-[var(--bg-primary)] border-[var(--border-primary)] focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500"
            >
              <option value="active">{t('clients.active')}</option>
              <option value="inactive">{t('clients.inactive')}</option>
              <option value="archived">{t('clients.archived')}</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-[var(--text-primary)]">{t('clients.notes')}</label>
            <textarea
              value={editForm.notes}
              onChange={e => setEditForm(prev => ({ ...prev, notes: e.target.value }))}
              rows={3}
              className="w-full px-3 py-2 rounded-lg border text-sm bg-[var(--bg-primary)] border-[var(--border-primary)] focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 resize-none placeholder:text-[var(--text-tertiary)]"
              placeholder={t('clients.notesPlaceholder')}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setEditOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleSave} disabled={saving || !editForm.name.trim()}>
              {saving && <Loader2 className="w-4 h-4 animate-spin me-1" />}
              {t('common.save')}
            </Button>
          </div>
        </div>
      </Modal>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Document requests */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ClipboardList className="w-4 h-4 text-primary-600" />
                <h3 className="text-sm font-semibold">{t('requests.title')} ({clientCases.length})</h3>
              </div>
              <Button size="sm" variant="ghost" onClick={() => navigate(`/requests/create?clientId=${client.id}`)} icon={<ClipboardList className="w-3.5 h-3.5" />}>
                {t('requests.newRequest')}
              </Button>
            </div>
          </CardHeader>
          <div className="divide-y divide-[var(--border-secondary)]">
            {clientCases.length === 0 ? (
              <p className="text-sm text-[var(--text-tertiary)] py-6 text-center">{t('requests.noRequests')}</p>
            ) : clientCases.map(c => {
              const submitted = c.requiredDocuments.filter(d => d.status !== 'missing').length
              const total = c.requiredDocuments.length
              return (
                <button
                  key={c.id}
                  onClick={() => navigate(`/requests/${c.id}`)}
                  className="w-full flex items-center gap-4 px-5 py-4 hover:bg-[var(--bg-secondary)] transition-colors text-start"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-medium truncate">{c.caseType}</p>
                      <Badge variant="status" status={c.status}>
                        {t(`cases.${c.status === 'waiting-for-client' ? 'waitingForClient' : c.status === 'partial-submission' ? 'partialSubmission' : c.status}`)}
                      </Badge>
                    </div>
                    <p className="text-xs text-[var(--text-tertiary)]">
                      {submitted}/{total} {t('documents.title').toLowerCase()}
                    </p>
                  </div>
                  <ProgressBar value={submitted} max={total} className="w-24" showLabel />
                </button>
              )
            })}
          </div>
        </Card>

        {/* Signature requests */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <PenLine className="w-4 h-4 text-indigo-500" />
                <h3 className="text-sm font-semibold">{t('signatures.title')} ({clientSignatures.length})</h3>
              </div>
              <Button size="sm" variant="ghost" onClick={() => navigate(`/signatures/create?clientId=${client.id}`)} icon={<PenLine className="w-3.5 h-3.5" />}>
                {t('signatures.newRequest')}
              </Button>
            </div>
          </CardHeader>
          <div className="divide-y divide-[var(--border-secondary)]">
            {clientSignatures.length === 0 ? (
              <p className="text-sm text-[var(--text-tertiary)] py-6 text-center">{t('signatures.noRequests')}</p>
            ) : clientSignatures.map(sig => {
              const statusIcon: Record<string, typeof CheckCircle2> = {
                draft: FileText,
                pending: Clock,
                viewed: Eye,
                signed: CheckCircle2,
                declined: XCircle,
                expired: Clock,
                cancelled: XCircle,
              }
              const StatusIcon = statusIcon[sig.status] || Clock
              const statusColor: Record<string, string> = {
                draft: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
                pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
                viewed: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
                signed: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
                declined: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
                expired: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400',
                cancelled: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
              }
              return (
                <button
                  key={sig.id}
                  onClick={() => navigate(`/signatures/${sig.id}`)}
                  className="w-full flex items-center gap-4 px-5 py-4 hover:bg-[var(--bg-secondary)] transition-colors text-start"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-medium truncate">{sig.title}</p>
                      <Badge className={cn('text-[10px] px-2 py-0.5 rounded-full', statusColor[sig.status])}>
                        <StatusIcon className="w-3 h-3 me-1 inline" />
                        {t(`signatures.${sig.status}`)}
                      </Badge>
                    </div>
                    <p className="text-xs text-[var(--text-tertiary)]">
                      {sig.documentFileName} · {formatDate(sig.createdAt)}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        </Card>
      </div>

      {/* Future placeholders */}
      <Card className="p-5">
        <div className="flex items-center gap-3 text-[var(--text-tertiary)]">
          <Link2 className="w-5 h-5" />
          <div>
            <p className="text-sm font-medium">{t('clients.submissionLink')}</p>
            <p className="text-xs">{t('common.comingSoon')}</p>
          </div>
        </div>
      </Card>
    </div>
  )
}
