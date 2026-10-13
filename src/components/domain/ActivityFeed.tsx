import { Link } from 'react-router-dom'
import {
  Upload, CheckCircle2, XCircle, Send, Bell, UserPlus, FilePlus2, PenLine, MessageSquare, Trash2,
  StickyNote, Download, Settings2, Link2, RotateCcw, Users, CircleDot, FileX2, Archive, Ban,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/contexts/I18nContext'
import type { ActivityEvent } from '@/types'

const ICONS: Record<string, { icon: typeof Upload; tone: string }> = {
  document_uploaded: { icon: Upload, tone: 'bg-info-soft text-info' },
  document_approved: { icon: CheckCircle2, tone: 'bg-success-soft text-success' },
  document_rejected: { icon: XCircle, tone: 'bg-danger-soft text-danger' },
  document_reopened: { icon: RotateCcw, tone: 'bg-surface-3 text-fg-3' },
  document_added: { icon: FilePlus2, tone: 'bg-surface-3 text-fg-3' },
  document_removed: { icon: FileX2, tone: 'bg-surface-3 text-fg-3' },
  documents_downloaded: { icon: Download, tone: 'bg-surface-3 text-fg-3' },
  request_created: { icon: FilePlus2, tone: 'bg-brand-soft text-brand-600' },
  request_sent: { icon: Send, tone: 'bg-brand-soft text-brand-600' },
  request_completed: { icon: CheckCircle2, tone: 'bg-success-soft text-success' },
  request_closed: { icon: Archive, tone: 'bg-surface-3 text-fg-3' },
  request_reopened: { icon: RotateCcw, tone: 'bg-surface-3 text-fg-3' },
  request_updated: { icon: Settings2, tone: 'bg-surface-3 text-fg-3' },
  request_deleted: { icon: Trash2, tone: 'bg-danger-soft text-danger' },
  reminder_sent: { icon: Bell, tone: 'bg-warning-soft text-warning' },
  rejection_notice_sent: { icon: Send, tone: 'bg-surface-3 text-fg-3' },
  portal_link_changed: { icon: Link2, tone: 'bg-surface-3 text-fg-3' },
  client_created: { icon: UserPlus, tone: 'bg-brand-soft text-brand-600' },
  client_deleted: { icon: Trash2, tone: 'bg-danger-soft text-danger' },
  signature_created: { icon: PenLine, tone: 'bg-brand-soft text-brand-600' },
  signature_signed: { icon: PenLine, tone: 'bg-success-soft text-success' },
  signature_declined: { icon: Ban, tone: 'bg-danger-soft text-danger' },
  signature_cancelled: { icon: Ban, tone: 'bg-surface-3 text-fg-3' },
  signature_archived: { icon: Archive, tone: 'bg-surface-3 text-fg-3' },
  support_reply: { icon: MessageSquare, tone: 'bg-surface-3 text-fg-3' },
  support_opened: { icon: MessageSquare, tone: 'bg-surface-3 text-fg-3' },
  support_closed: { icon: MessageSquare, tone: 'bg-surface-3 text-fg-3' },
  note_added: { icon: StickyNote, tone: 'bg-warning-soft text-warning' },
  member_invited: { icon: Users, tone: 'bg-surface-3 text-fg-3' },
  member_joined: { icon: Users, tone: 'bg-surface-3 text-fg-3' },
  member_removed: { icon: Users, tone: 'bg-surface-3 text-fg-3' },
  member_role_changed: { icon: Users, tone: 'bg-surface-3 text-fg-3' },
  automation_updated: { icon: Settings2, tone: 'bg-surface-3 text-fg-3' },
}

/** Localized one-line summary of an activity event. */
export function useActivityText() {
  const { t } = useI18n()
  return (a: ActivityEvent) => {
    const m = (a.metadata || {}) as Record<string, unknown>
    const vars = {
      actor: a.actorType === 'system' ? t('common.system') : a.userName || t('common.client'),
      client: a.clientName || '',
      doc: (m.docName as string) || '',
      channel: m.channel ? t(`activity.channel.${m.channel}`) : '',
      reason: (m.reason as string) || '',
    }
    const key = `activity.types.${a.type}`
    const text = t(key, vars)
    return text === key ? a.description : text
  }
}

export function ActivityFeed({ items, showClient = true, compact, className }: { items: ActivityEvent[]; showClient?: boolean; compact?: boolean; className?: string }) {
  const { t, fmt } = useI18n()
  const text = useActivityText()
  return (
    <ol className={cn('relative', className)}>
      {items.map((a, i) => {
        const cfg = ICONS[a.type] || { icon: CircleDot, tone: 'bg-surface-3 text-fg-3' }
        const Icon = cfg.icon
        const note = a.type === 'note_added'
        return (
          <li key={a.id} className="relative flex gap-3 pb-5 last:pb-0">
            {i < items.length - 1 && <span className="absolute start-[15px] top-8 bottom-0 w-px bg-line" aria-hidden />}
            <span className={cn('relative z-[1] flex size-8 shrink-0 items-center justify-center rounded-full ring-4 ring-surface', cfg.tone)}><Icon className="size-4" /></span>
            <div className="min-w-0 flex-1 pt-1">
              <p className="text-sm text-fg-2">
                {note ? <><span className="font-medium text-fg">{a.userName}</span> {t('activity.addedNote')}</> : text(a)}
              </p>
              {note && <p className="mt-1.5 whitespace-pre-wrap rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-fg">{a.description}</p>}
              {a.type === 'document_rejected' && Boolean(a.metadata?.reason) && !compact && (
                <p className="mt-1 text-sm text-fg-3">“{String(a.metadata!.reason)}”</p>
              )}
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-fg-4">
                <time dateTime={a.timestamp} title={fmt.dateTime(a.timestamp)}>{fmt.relative(a.timestamp)}</time>
                {showClient && a.clientName && (
                  <>
                    <span aria-hidden>·</span>
                    {a.caseId ? <Link to={`/requests/${a.caseId}`} className="hover:text-fg-2 hover:underline">{a.clientName}</Link> : <span>{a.clientName}</span>}
                  </>
                )}
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
