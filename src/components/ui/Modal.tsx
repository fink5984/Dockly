import { cn } from '@/lib/utils'
import { X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { ReactNode } from 'react'

interface ModalProps {
  open?: boolean
  isOpen?: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

export function Modal({ open, isOpen, onClose, title, children, size = 'md', className }: ModalProps) {
  const isVisible = open ?? isOpen ?? false
  const sizes = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  }

  return (
    <AnimatePresence>
      {isVisible && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/50"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.15 }}
            className={cn(
              'relative w-full bg-[var(--bg-primary)] rounded-2xl shadow-2xl border border-[var(--border-primary)] overflow-hidden',
              sizes[size],
              className
            )}
          >
            {title && (
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-primary)]">
                <h2 className="text-lg font-semibold">{title}</h2>
                <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
            <div className="max-h-[80vh] overflow-y-auto">
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

interface DrawerProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  side?: 'right' | 'left'
  className?: string
}

export function Drawer({ open, onClose, title, children, side = 'right', className }: DrawerProps) {
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/50"
            onClick={onClose}
          />
          <motion.div
            initial={{ x: side === 'right' ? '100%' : '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: side === 'right' ? '100%' : '-100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 250 }}
            className={cn(
              'absolute top-0 bottom-0 w-full max-w-lg bg-[var(--bg-primary)] shadow-2xl border-[var(--border-primary)] overflow-hidden flex flex-col',
              side === 'right' ? 'right-0 border-l' : 'left-0 border-r',
              className
            )}
          >
            {title && (
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-primary)] shrink-0">
                <h2 className="text-lg font-semibold">{title}</h2>
                <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
            <div className="flex-1 overflow-y-auto">
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
