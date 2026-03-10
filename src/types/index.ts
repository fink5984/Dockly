export type Language = 'en' | 'he'
export type Direction = 'ltr' | 'rtl'
export type Theme = 'light' | 'dark' | 'system'

export interface User {
  id: string
  email: string
  name: string
  role: UserRole
  avatar?: string
  phone?: string
  workspaceId: string
  workspace?: Workspace
}

export type UserRole = 'owner' | 'admin' | 'manager' | 'staff' | 'viewer'

export interface Workspace {
  id: string
  name: string
  businessType: string
  contactPerson: string
  phone: string
  email: string
  logo?: string
  defaultLanguage: Language
  timezone: string
  createdAt: string
}

export interface Client {
  id: string
  workspaceId: string
  name: string
  fullName: string
  email: string
  phone: string
  company?: string
  notes?: string
  status: ClientStatus
  assignedOwner: string
  createdAt: string
  updatedAt: string
}

export type ClientStatus = 'active' | 'inactive' | 'archived'

export interface DocumentType {
  id: string
  workspaceId: string
  name: string
  category: string
  description: string
  helperText: string
  defaultRequired: boolean
  isRequired: boolean
  allowedFormats: string[]
  maxSizeMB: number
  status: 'active' | 'archived'
  applicableCaseTypes: string[]
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface DocumentPreset {
  id: string
  workspaceId: string
  name: string
  caseType: string
  documentTypeIds: string[]
  description: string
  createdAt: string
}

export interface Case {
  id: string
  workspaceId: string
  clientId: string
  clientName: string
  caseType: string
  status: CaseStatus
  assignedOwner: string
  assignedOwnerName: string
  requiredDocuments: CaseDocument[]
  deadline?: string
  notes?: string
  supportRequestId?: string
  lastActivityDate?: string
  createdAt: string
  updatedAt: string
}

export type CaseStatus =
  | 'new'
  | 'waiting-for-client'
  | 'partial-submission'
  | 'awaiting-review'
  | 'completed'
  | 'closed'
  | 'delayed'

export interface CaseDocument {
  id: string
  caseId: string
  documentTypeId: string
  documentTypeName: string
  category: string
  isRequired: boolean
  status: DocumentStatus
  caseNotes?: string
  notes?: string
  fileName?: string
  fileType?: string
  fileSize?: number
  storagePath?: string
  storageStatus?: 'uploaded' | 'processing' | 'ready' | 'error'
  uploadedBy?: string
  uploadedAt?: string
  reviewedBy?: string
  reviewedByName?: string
  reviewedAt?: string
  rejectionReason?: string
  versionCount: number
  sortOrder: number
}

export type DocumentStatus =
  | 'missing'
  | 'pending-upload'
  | 'uploaded'
  | 'received'
  | 'under-review'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'blurry'
  | 'missing-pages'

export interface SupportRequest {
  id: string
  caseId: string
  clientId: string
  clientName: string
  subject: string
  status: SupportStatus
  assignedStaff?: string
  assignedStaffName?: string
  openedAt: string
  closedAt?: string
  issueDescription: string
  messages: SupportMessage[]
}

export type SupportStatus =
  | 'open'
  | 'waiting-for-staff'
  | 'waiting-for-client'
  | 'resolved'
  | 'closed'

export interface SupportMessage {
  id: string
  requestId: string
  sender: 'client' | 'staff' | 'system'
  senderType: 'client' | 'staff' | 'system'
  senderName: string
  content: string
  body: string
  timestamp: string
  sentAt: string
  attachments?: MessageAttachment[]
  isRead: boolean
}

export interface MessageAttachment {
  id: string
  fileName: string
  fileType: string
  fileSize: number
  url: string
}

export interface ActivityEvent {
  id: string
  workspaceId: string
  type: ActivityType
  description: string
  userId: string
  userName: string
  performedByName: string
  clientId?: string
  clientName?: string
  caseId?: string
  documentId?: string
  timestamp: string
  metadata?: Record<string, string>
}

export type ActivityType =
  | 'client-created'
  | 'case-opened'
  | 'case-closed'
  | 'document-uploaded'
  | 'document-approved'
  | 'document-rejected'
  | 'reminder-sent'
  | 'note-added'
  | 'support-opened'
  | 'support-closed'
  | 'document-type-created'
  | 'document-type-edited'
  | 'assignment-updated'
  | 'staff-added'
  | 'case_created'
  | 'document_uploaded'
  | 'document_approved'
  | 'document_rejected'
  | 'reminder_sent'
  | 'case_completed'
  | 'client_created'
  | 'support_request'
  | 'status_changed'
  | 'note_added'
  | 'document_downloaded'
  | 'case_archived'

export interface WhatsAppConfig {
  connected: boolean
  isConnected: boolean
  phoneNumber?: string
  lastSync?: string
  apiKey?: string
  connectedAt?: string
  messagesSent: number
  messagesReceived: number
}

export interface MessageTemplate {
  id: string
  key: string
  name: string
  contentEn: string
  contentHe: string
  variables: string[]
  trigger: string
  bodyTemplate: string
  isActive: boolean
  language: string
}

export interface AutomationRule {
  id: string
  name: string
  trigger: string
  action: string
  enabled: boolean
  isActive: boolean
  delay?: string
  delayMinutes: number
}

export interface Notification {
  id: string
  type: 'info' | 'warning' | 'success' | 'error'
  title: string
  message: string
  timestamp: string
  read: boolean
  actionUrl?: string
}

export interface DashboardStats {
  totalClients: number
  openCases: number
  completedCases: number
  noSubmissionClients: number
  partialSubmissionClients: number
  fullyCompletedClients: number
  delayedCases: number
  activeSupportRequests: number
}

export interface CaseTypeConfig {
  id: string
  name: string
  nameHe: string
  icon: string
  color: string
  defaultDocumentTypeIds: string[]
  isActive: boolean
}

export interface WhatsAppMessage {
  id: string
  workspaceId: string
  caseId?: string | null
  clientId?: string | null
  direction: 'outbound' | 'inbound'
  phoneNumber: string
  messageType: string
  content: string
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed'
  waMessageId?: string | null
  templateName?: string | null
  errorMessage?: string | null
  metadata?: Record<string, unknown>
  createdAt: string
}

export interface ClientUploadToken {
  id: string
  workspaceId: string
  caseId: string
  clientId: string
  token: string
  expiresAt: string
  isUsed: boolean
  createdAt: string
}
