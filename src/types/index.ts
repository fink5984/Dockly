/* Types mirror the JSON returned by the Dockly API (server/routes/*). */

export type Language = 'en' | 'he'
export type Direction = 'ltr' | 'rtl'
export type Theme = 'light' | 'dark' | 'system'
export type Role = 'owner' | 'admin' | 'member' | 'viewer'

export interface User {
  id: string
  email: string
  name: string
  role: Role
  phone?: string
  avatar?: string
  workspaceId: string
}

export interface Workspace {
  id: string
  name: string
  businessType: string
  contactPerson: string
  phone: string
  email: string
  logo?: string
  brandColor?: string
  portalMessage: string
  defaultLanguage: Language
  timezone: string
  createdAt: string
}

export interface ClientStats {
  requests: number
  openRequests: number
  signatures: number
  lastActivityAt?: string
}

export interface Client {
  id: string
  workspaceId: string
  name: string
  email: string
  phone: string
  phoneValid: boolean
  company?: string
  notes?: string
  status: 'active' | 'inactive' | 'archived'
  assignedOwner: string
  createdAt: string
  updatedAt: string
  stats?: ClientStats
}

export interface DocumentType {
  id: string
  name: string
  category: string
  description: string
  helperText: string
  defaultRequired: boolean
  isRequired: boolean
  allowedFormats: string[]
  maxSizeMB: number
  status: 'active' | 'archived'
  sortOrder: number
  usageCount?: number
  createdAt: string
  updatedAt: string
}

export interface TemplateItem {
  documentTypeId: string
  required: boolean
  note: string
}

export interface RequestTemplate {
  id: string
  name: string
  description: string
  defaultTitle: string
  instructions: string
  dueInDays?: number
  items: TemplateItem[]
  createdAt: string
  updatedAt: string
}

export type RequestStatus = 'new' | 'waiting-for-client' | 'partial-submission' | 'completed' | 'closed'
export type DocStatus = 'missing' | 'uploaded' | 'approved' | 'rejected'

export interface Progress {
  total: number
  required: number
  missing: number
  awaitingReview: number
  approved: number
  rejected: number
  received: number
  outstandingRequired: number
  percent: number
}

export interface RequestDocument {
  id: string
  caseId: string
  documentTypeId: string
  name: string
  category: string
  description: string
  helperText: string
  isRequired: boolean
  status: DocStatus
  clientNote: string
  notes?: string
  fileName?: string
  fileType?: string
  fileSize?: number
  hasFile: boolean
  uploadedBy?: string
  uploadedAt?: string
  reviewedBy?: string
  reviewedAt?: string
  rejectionReason?: string
  versionCount: number
  sortOrder: number
  allowedFormats: string[]
  maxSizeMB: number
}

export interface DocRequest {
  id: string
  clientId: string
  clientName: string
  clientPhone?: string
  clientEmail?: string
  title: string
  status: RequestStatus
  assignedOwner: string
  deadline?: string
  notes?: string
  instructions: string
  language?: Language
  portalEnabled: boolean
  publicToken?: string
  sentAt?: string
  completedAt?: string
  closedAt?: string
  remindersEnabled: boolean
  lastReminderAt?: string
  reminderCount: number
  lastActivityDate?: string
  createdAt: string
  updatedAt: string
  overdue: boolean
  progress: Progress
  requiredDocuments: RequestDocument[]
}

export interface RequestList {
  items: DocRequest[]
  total: number
  page: number
  pageSize: number
  counts: Partial<Record<RequestStatus, number>>
}

export interface FileVersion {
  id: string
  fileName: string
  mimeType: string
  size: number
  sha256: string
  via: 'portal' | 'staff' | 'whatsapp' | 'legacy'
  reviewStatus: 'pending' | 'approved' | 'rejected' | 'superseded'
  reviewReason?: string
  reviewedAt?: string
  reviewer?: string
  createdAt: string
  isCurrent: boolean
}

export interface Delivery {
  id: string
  channel: 'whatsapp' | 'email'
  kind: string
  recipient: string
  status: 'queued' | 'accepted' | 'sent' | 'delivered' | 'read' | 'failed' | 'skipped'
  error?: string
  triggeredBy: 'user' | 'automation'
  createdAt: string
  updatedAt: string
}

export interface ActivityEvent {
  id: string
  type: string
  description: string
  userName: string
  actorType: 'user' | 'client' | 'system'
  clientId?: string
  clientName?: string
  caseId?: string
  documentId?: string
  timestamp: string
  metadata?: Record<string, unknown>
}

export interface SupportMessage {
  id: string
  senderType: 'client' | 'staff' | 'system'
  senderName: string
  content: string
  timestamp: string
  isRead: boolean
}

export interface SupportRequest {
  id: string
  caseId: string
  clientId: string
  clientName: string
  subject: string
  status: 'open' | 'waiting-for-staff' | 'waiting-for-client' | 'resolved' | 'closed'
  openedAt: string
  closedAt?: string
  messages: SupportMessage[]
}

export type SignatureStatus = 'draft' | 'pending' | 'viewed' | 'signed' | 'declined' | 'expired' | 'cancelled'
export type SignatureFieldType = 'signature' | 'date' | 'name' | 'text' | 'initials' | 'checkbox'

export interface SignatureField {
  id: string
  type: SignatureFieldType
  label: string
  page: number
  x: number
  y: number
  width: number
  height: number
  required: boolean
  value?: string
  sortOrder: number
  docIndex: number
}

export interface SignatureRequest {
  id: string
  clientId: string
  clientName: string
  caseId?: string
  title: string
  description?: string
  status: SignatureStatus
  publicToken: string
  documentFileName: string
  documentFileType: string
  documentFileSize: number
  canvasWidth?: number
  fields: SignatureField[]
  fieldCount?: number
  documents: { id: string; fileName: string; fileType: string; fileSize: number; hasSigned: boolean }[]
  signedAt?: string
  signerName?: string
  hasSignedDocument: boolean
  viewedAt?: string
  declinedAt?: string
  declineReason?: string
  expiresAt?: string
  originalSha256?: string
  signedSha256?: string
  lastReminderAt?: string
  reminderCount: number
  language?: Language
  createdAt: string
  updatedAt: string
}

export interface SignatureEvent {
  id: number
  event: string
  actor: 'signer' | 'user' | 'system'
  actorName?: string
  ip?: string
  userAgent?: string
  details: Record<string, unknown>
  hash: string
  createdAt: string
}

export interface Notification {
  id: string
  type: 'info' | 'warning' | 'success' | 'error'
  title: string
  message: string
  read: boolean
  actionUrl?: string
  /** Localization key; the UI renders `notifications.templates.<template>` with `params`. */
  template?: string
  params?: Record<string, unknown>
  timestamp: string
}

export interface TeamMember {
  id: string
  name: string
  email: string
  role: Role
  phone?: string
  isActive: boolean
  lastLoginAt?: string
  createdAt: string
  isYou: boolean
}

export interface Invite {
  id: string
  email: string
  name: string
  role: Role
  expiresAt: string
  createdAt: string
}

export interface AutomationSettings {
  requestReminders: { enabled: boolean; firstAfterDays: number; repeatEveryDays: number; maxReminders: number; channel: 'whatsapp' | 'email' }
  deadlineReminder: { enabled: boolean; daysBefore: number }
  signatureReminders: { enabled: boolean; firstAfterDays: number; repeatEveryDays: number; maxReminders: number; channel: 'whatsapp' | 'email' }
  quietHours: { enabled: boolean; start: string; end: string }
  weekendDays: number[]
}

export interface ChannelStatus {
  whatsapp: { mode: 'cloud' | 'log'; configured: boolean; webhookVerified: boolean }
  email: { configured: boolean; provider: string }
}

export type ActionKind = 'support' | 'review' | 'overdue' | 'stalled' | 'signature' | 'unsent'

export interface Dashboard {
  kpis: {
    activeRequests: number
    awaitingClient: number
    drafts: number
    requestsNeedingReview: number
    documentsNeedingReview: number
    completedRequests: number
    completedThisMonth: number
    overdue: number
    pendingSignatures: number
    completedSignatures: number
    signedThisMonth: number
    activeClients: number
    supportWaiting: number
    avgDaysToComplete: number | null
  }
  actions: { kind: ActionKind; id: string; title: string; clientName: string; count?: number; at?: string; href: string }[]
  pipeline: Partial<Record<RequestStatus, number>>
  trend: { week: string; created: number; completed: number; uploads: number; signed: number }[]
  onboarding: { hasClient: boolean; hasRequest: boolean; hasSent: boolean; hasSignature: boolean; hasBranding: boolean; hasTemplate: boolean }
}

export interface LibraryItem {
  source: 'requests' | 'signatures'
  id: string
  parentId: string
  parentTitle: string
  label: string
  fileName: string
  mimeType: string
  size: number
  status: string
  at: string
  clientId: string
  clientName: string
  versions: number
}

export interface SearchResults {
  clients: { id: string; name: string; email: string; phone: string }[]
  requests: { id: string; title: string; status: RequestStatus; clientName: string }[]
  signatures: { id: string; title: string; status: SignatureStatus; clientName: string }[]
}
