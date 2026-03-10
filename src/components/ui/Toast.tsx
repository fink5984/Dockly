import { useApp } from '@/contexts/AppContext'
import { useI18n } from '@/contexts/I18nContext'
import { cn } from '@/lib/utils'
import { X, CheckCircle, AlertTriangle, AlertCircle, Info } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

export function ToastContainer() {
  const { toasts, removeToast } = useApp()
  const { direction } = useI18n()

  return (
    <div className={cn(
      'fixed bottom-4 z-[100] flex flex-col gap-2 max-w-sm',
      direction === 'rtl' ? 'left-4' : 'right-4'
    )}>
      <AnimatePresence>
        {toasts.map((toast) => {
          const icon = {
            success: <CheckCircle className="w-5 h-5 text-success" />,
            error: <AlertCircle className="w-5 h-5 text-danger" />,
            warning: <AlertTriangle className="w-5 h-5 text-warning" />,
            info: <Info className="w-5 h-5 text-info" />,
          }[toast.type]

          return (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              className="bg-[var(--bg-primary)] rounded-xl shadow-xl border border-[var(--border-primary)] px-4 py-3 flex items-start gap-3"
            >
              {icon}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{toast.title}</p>
                {toast.message && (
                  <p className="text-xs text-[var(--text-tertiary)] mt-0.5">{toast.message}</p>
                )}
              </div>
              <button onClick={() => removeToast(toast.id)} className="shrink-0">
                <X className="w-4 h-4 text-[var(--text-tertiary)]" />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
