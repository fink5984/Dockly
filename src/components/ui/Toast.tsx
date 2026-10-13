import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react'
import { useApp } from '@/contexts/AppContext'
import { useI18n } from '@/contexts/I18nContext'
import { cn } from '@/lib/utils'

const icons = {
  success: <CheckCircle2 className="size-5 text-success" />,
  error: <AlertCircle className="size-5 text-danger" />,
  warning: <AlertTriangle className="size-5 text-warning" />,
  info: <Info className="size-5 text-info" />,
}

/** Toasts are announced politely (errors assertively) to screen readers. */
export function ToastViewport() {
  const { toasts, dismissToast } = useApp()
  const { t } = useI18n()
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[300] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:end-0 sm:items-end">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.tone === 'error' ? 'alert' : 'status'}
          aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
          className={cn(
            'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border border-line bg-surface p-3.5 shadow-lg animate-slide-up',
          )}
        >
          <span className="mt-px shrink-0">{icons[toast.tone]}</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-fg">{toast.title}</p>
            {toast.message && <p className="mt-0.5 text-sm text-fg-3">{toast.message}</p>}
            {toast.action && (
              <button
                type="button"
                onClick={() => { toast.action!.onClick(); dismissToast(toast.id) }}
                className="mt-2 text-sm font-semibold text-brand-600 hover:text-brand-700"
              >
                {toast.action.label}
              </button>
            )}
          </div>
          <button type="button" onClick={() => dismissToast(toast.id)} className="shrink-0 rounded p-0.5 text-fg-4 hover:bg-surface-3 hover:text-fg-2" aria-label={t('common.dismiss')}>
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
