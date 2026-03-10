import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 11)
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    completed: 'bg-success/10 text-success',
    approved: 'bg-success/10 text-success',
    active: 'bg-info/10 text-info',
    'in-progress': 'bg-info/10 text-info',
    'waiting-for-client': 'bg-warning/10 text-warning',
    'partial-submission': 'bg-warning/10 text-warning',
    pending: 'bg-warning/10 text-warning',
    'under-review': 'bg-warning/10 text-warning',
    'awaiting-review': 'bg-warning/10 text-warning',
    new: 'bg-primary-100 text-primary-700',
    rejected: 'bg-danger/10 text-danger',
    delayed: 'bg-danger/10 text-danger',
    missing: 'bg-surface-100 text-surface-500',
    closed: 'bg-surface-100 text-surface-600',
    resolved: 'bg-success/10 text-success',
    blurry: 'bg-warning/10 text-warning',
    'missing-pages': 'bg-danger/10 text-danger',
    received: 'bg-info/10 text-info',
    open: 'bg-info/10 text-info',
    'no-submission': 'bg-surface-200 text-surface-600',
    'waiting-for-staff': 'bg-warning/10 text-warning',
  }
  return colors[status] || 'bg-surface-100 text-surface-600'
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const DOC_STATUS_KEYS: Record<string, string> = {
  missing: 'documents.statusMissing',
  'pending-upload': 'documents.statusPendingUpload',
  uploaded: 'documents.statusUploaded',
  'under-review': 'documents.statusUnderReview',
  approved: 'documents.statusApproved',
  rejected: 'documents.statusRejected',
  expired: 'documents.statusExpired',
  received: 'cases.received',
  blurry: 'cases.blurry',
  'missing-pages': 'cases.missingPages',
}

export function getDocStatusKey(status: string): string {
  return DOC_STATUS_KEYS[status] || 'common.noData'
}

const CASE_STATUS_KEYS: Record<string, string> = {
  new: 'cases.new',
  'waiting-for-client': 'cases.waitingForClient',
  'partial-submission': 'cases.partialSubmission',
  'awaiting-review': 'cases.awaitingReview',
  completed: 'cases.completed',
  closed: 'cases.closed',
  delayed: 'cases.delayed',
  pending: 'cases.pending',
}

export function getCaseStatusKey(status: string): string {
  return CASE_STATUS_KEYS[status] || 'common.noData'
}

const DOC_CATEGORY_KEYS: Record<string, string> = {
  identity: 'documentTypes.catIdentity',
  financial: 'documentTypes.catFinancial',
  legal: 'documentTypes.catLegal',
  general: 'documentTypes.catGeneral',
  employment: 'documentTypes.catEmployment',
  property: 'documentTypes.catProperty',
  insurance: 'documentTypes.catInsurance',
  tax: 'documentTypes.catTax',
}

export function getDocCategoryKey(category: string): string {
  return DOC_CATEGORY_KEYS[category] || category
}
