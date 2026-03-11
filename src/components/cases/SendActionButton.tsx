import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { Send, Bell, CheckCircle2, Loader2, ChevronDown, MessageCircle, Mail, Smartphone } from 'lucide-react'
import { useI18n } from '@/contexts/I18nContext'

interface SendActionButtonProps {
  caseId: string
  clientName: string
  clientPhone?: string
  workspaceId: string
  clientId: string
  language: 'en' | 'he'
  onSend: (channel: 'whatsapp') => Promise<boolean>
  onReminder: () => Promise<void>
  initialSent?: boolean
}

export function SendActionButton({
  clientPhone,
  onSend,
  onReminder,
  initialSent = false,
}: SendActionButtonProps) {
  const { t } = useI18n()
  const [hasSent, setHasSent] = useState(initialSent)
  const [sending, setSending] = useState(false)
  const [reminding, setReminding] = useState(false)
  const [sendMenuOpen, setSendMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Sync from parent
  useEffect(() => {
    if (initialSent) setHasSent(true)
  }, [initialSent])

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setSendMenuOpen(false)
      }
    }
    if (sendMenuOpen) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [sendMenuOpen])

  const handleSendViaWhatsApp = async () => {
    if (!clientPhone) return
    setSending(true)
    setSendMenuOpen(false)
    try {
      const success = await onSend('whatsapp')
      if (success) setHasSent(true)
    } finally {
      setSending(false)
    }
  }

  const handleReminder = async () => {
    setReminding(true)
    try {
      await onReminder()
    } finally {
      setReminding(false)
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      {/* Send / Sent button with dropdown */}
      <div ref={menuRef} className="relative">
        <div className="flex items-center">
          {/* Main button */}
          <button
            disabled={hasSent || sending || !clientPhone}
            onClick={() => {
              if (!hasSent && !sending && clientPhone) {
                setSendMenuOpen(!sendMenuOpen)
              }
            }}
            className={cn(
              'flex items-center gap-1.5 h-8 px-3.5 rounded-lg text-xs font-medium transition-all duration-150',
              hasSent
                ? 'bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] cursor-default opacity-60'
                : sending || !clientPhone
                ? 'bg-gray-200 dark:bg-gray-700 text-[var(--text-tertiary)] cursor-not-allowed'
                : 'text-white hover:brightness-110'
            )}
            style={hasSent || sending || !clientPhone ? {} : {
              background: 'linear-gradient(135deg, #22c55e, #16a34a)',
              boxShadow: '0 1px 8px rgba(34,197,94,0.25)',
            }}
          >
            {sending
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : hasSent
              ? <CheckCircle2 className="w-3.5 h-3.5" />
              : <Send className="w-3.5 h-3.5" />}
            <span>
              {hasSent ? t('cases.sent') : t('cases.send')}
            </span>
            {!hasSent && !sending && clientPhone && (
              <ChevronDown className={cn('w-3 h-3 transition-transform', sendMenuOpen && 'rotate-180')} />
            )}
          </button>
        </div>

        {/* Send method dropdown */}
        {sendMenuOpen && (
          <div className="absolute top-full mt-1.5 end-0 z-50 w-48 rounded-xl border border-[var(--border-primary)]
            bg-[var(--bg-primary)] shadow-xl py-1 animate-in fade-in slide-in-from-top-1 duration-150">
            <button
              onClick={handleSendViaWhatsApp}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
            >
              <MessageCircle className="w-3.5 h-3.5 text-green-500" />
              <span>{t('cases.sendViaWhatsApp')}</span>
            </button>
            <button
              disabled
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-[var(--text-tertiary)] opacity-50 cursor-not-allowed"
            >
              <Mail className="w-3.5 h-3.5" />
              <span>{t('cases.sendReminderEmail')}</span>
              <span className="ms-auto text-[10px] bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded-full">{t('common.comingSoon')}</span>
            </button>
            <button
              disabled
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-[var(--text-tertiary)] opacity-50 cursor-not-allowed"
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>SMS</span>
              <span className="ms-auto text-[10px] bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded-full">{t('common.comingSoon')}</span>
            </button>
          </div>
        )}
      </div>

      {/* Reminder button — always active after first send */}
      <button
        disabled={reminding || !hasSent}
        onClick={handleReminder}
        className={cn(
          'flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium transition-all duration-150',
          hasSent
            ? 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
            : 'bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] opacity-40 cursor-not-allowed'
        )}
        title={!hasSent ? t('cases.sendFirst') : t('cases.sendReminder')}
      >
        {reminding
          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
          : <Bell className="w-3.5 h-3.5" />}
        <span>{t('cases.sendReminder')}</span>
      </button>
    </div>
  )
}
