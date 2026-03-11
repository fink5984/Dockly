/**
 * Mapper utilities to convert between snake_case DB rows
 * and camelCase app-level types.
 */
import type {
  User, Workspace, Client, DocumentType, DocumentPreset,
  Case, CaseDocument, SupportRequest, SupportMessage,
  ActivityEvent, Notification, CaseTypeConfig,
  WhatsAppConfig, MessageTemplate, AutomationRule,
  ActivityType, CaseStatus, ClientStatus, DocumentStatus,
} from '@/types'
import type { Database } from './database.types'

// ---- Row type aliases ----
type WsRow = Database['public']['Tables']['workspaces']['Row']
type ProfileRow = Database['public']['Tables']['profiles']['Row']
type ClientRow = Database['public']['Tables']['clients']['Row']
type DocTypeRow = Database['public']['Tables']['document_types']['Row']
type PresetRow = Database['public']['Tables']['document_presets']['Row']
type CaseRow = Database['public']['Tables']['cases']['Row']
type CaseDocRow = Database['public']['Tables']['case_documents']['Row']
type SupportReqRow = Database['public']['Tables']['support_requests']['Row']
type SupportMsgRow = Database['public']['Tables']['support_messages']['Row']
type ActivityRow = Database['public']['Tables']['activity_events']['Row']
type NotifRow = Database['public']['Tables']['notifications']['Row']
type CaseTypeRow = Database['public']['Tables']['case_type_configs']['Row']
type WaConfigRow = Database['public']['Tables']['whatsapp_config']['Row']
type MsgTplRow = Database['public']['Tables']['message_templates']['Row']
type AutoRuleRow = Database['public']['Tables']['automation_rules']['Row']

// ---- Workspace ----
export function mapWorkspace(row: WsRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    businessType: row.business_type,
    contactPerson: row.contact_person,
    phone: row.phone,
    email: row.email,
    logo: row.logo_url ?? undefined,
    defaultLanguage: row.default_language as 'en' | 'he',
    timezone: row.timezone,
    createdAt: row.created_at,
  }
}

// ---- User (from profile + workspace) ----
export function mapUser(row: ProfileRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as User['role'],
    avatar: row.avatar_url ?? undefined,
    phone: row.phone ?? undefined,
    workspaceId: row.workspace_id,
  }
}

// ---- Client ----
export function mapClient(row: ClientRow): Client {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    fullName: row.name,
    email: row.email,
    phone: row.phone,
    company: row.company ?? undefined,
    notes: row.notes ?? undefined,
    status: row.status as ClientStatus,
    assignedOwner: row.assigned_owner,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ---- DocumentType ----
export function mapDocumentType(row: DocTypeRow): DocumentType {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    category: row.category,
    description: row.description,
    helperText: row.helper_text,
    defaultRequired: row.default_required,
    isRequired: row.is_required,
    allowedFormats: row.allowed_formats,
    maxSizeMB: row.max_size_mb,
    status: row.status as 'active' | 'archived',
    applicableCaseTypes: row.applicable_case_types,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ---- DocumentPreset ----
export function mapDocumentPreset(row: PresetRow): DocumentPreset {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    caseType: row.case_type,
    documentTypeIds: row.document_type_ids,
    description: row.description,
    createdAt: row.created_at,
  }
}

// ---- CaseDocument ----
export function mapCaseDocument(row: CaseDocRow, docTypeName?: string, category?: string): CaseDocument {
  return {
    id: row.id,
    caseId: row.case_id,
    documentTypeId: row.document_type_id,
    documentTypeName: docTypeName ?? '',
    category: category ?? '',
    isRequired: row.is_required,
    status: row.status as DocumentStatus,
    caseNotes: row.case_notes ?? undefined,
    notes: row.notes ?? undefined,
    fileName: row.file_name ?? undefined,
    fileType: row.file_type ?? undefined,
    fileSize: row.file_size ?? undefined,
    storagePath: row.storage_path ?? undefined,
    storageStatus: (row.storage_status as CaseDocument['storageStatus']) ?? undefined,
    uploadedBy: row.uploaded_by ?? undefined,
    uploadedAt: row.uploaded_at ?? undefined,
    reviewedBy: row.reviewed_by ?? undefined,
    reviewedAt: row.reviewed_at ?? undefined,
    rejectionReason: row.rejection_reason ?? undefined,
    versionCount: row.version_count,
    sortOrder: row.sort_order,
  }
}

// ---- Case ----
export function mapCase(
  row: CaseRow,
  clientName?: string,
  docs?: CaseDocument[],
): Case {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    clientId: row.client_id,
    clientName: clientName ?? '',
    caseType: row.case_type,
    status: row.status as CaseStatus,
    assignedOwner: row.assigned_owner,
    assignedOwnerName: row.assigned_owner,
    requiredDocuments: docs ?? [],
    deadline: row.deadline ?? undefined,
    notes: row.notes ?? undefined,
    supportRequestId: row.support_request_id ?? undefined,
    lastActivityDate: row.last_activity_date ?? undefined,
    publicToken: (row as any).public_token ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ---- SupportMessage ----
export function mapSupportMessage(row: SupportMsgRow): SupportMessage {
  return {
    id: row.id,
    requestId: row.request_id,
    sender: row.sender_type as SupportMessage['sender'],
    senderType: row.sender_type as SupportMessage['senderType'],
    senderName: row.sender_name,
    content: row.content,
    body: row.content,
    timestamp: row.created_at,
    sentAt: row.created_at,
    isRead: row.is_read,
  }
}

// ---- SupportRequest ----
export function mapSupportRequest(
  row: SupportReqRow,
  clientName?: string,
  messages?: SupportMessage[],
): SupportRequest {
  return {
    id: row.id,
    caseId: row.case_id,
    clientId: row.client_id,
    clientName: clientName ?? '',
    subject: row.subject,
    status: row.status as SupportRequest['status'],
    assignedStaff: row.assigned_staff ?? undefined,
    openedAt: row.opened_at,
    closedAt: row.closed_at ?? undefined,
    issueDescription: row.issue_description,
    messages: messages ?? [],
  }
}

// ---- ActivityEvent ----
export function mapActivityEvent(row: ActivityRow): ActivityEvent {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    type: row.type as ActivityType,
    description: row.description,
    userId: row.user_id,
    userName: row.user_name,
    performedByName: row.user_name,
    clientId: row.client_id ?? undefined,
    clientName: row.client_name ?? undefined,
    caseId: row.case_id ?? undefined,
    documentId: row.document_id ?? undefined,
    timestamp: row.created_at,
    metadata: (row.metadata as Record<string, string>) ?? undefined,
  }
}

// ---- Notification ----
export function mapNotification(row: NotifRow): Notification {
  return {
    id: row.id,
    type: row.type as Notification['type'],
    title: row.title,
    message: row.message,
    timestamp: row.created_at,
    read: row.read,
    actionUrl: row.action_url ?? undefined,
  }
}

// ---- CaseTypeConfig ----
export function mapCaseTypeConfig(row: CaseTypeRow): CaseTypeConfig {
  return {
    id: row.id,
    name: row.name,
    nameHe: row.name_he,
    icon: row.icon,
    color: row.color,
    defaultDocumentTypeIds: row.default_document_type_ids,
    isActive: row.is_active,
  }
}

// ---- WhatsAppConfig ----
export function mapWhatsAppConfig(row: WaConfigRow): WhatsAppConfig {
  return {
    connected: row.is_connected,
    isConnected: row.is_connected,
    phoneNumber: row.phone_number ?? undefined,
    lastSync: row.last_sync ?? undefined,
    apiKey: row.api_key ?? undefined,
    connectedAt: row.connected_at ?? undefined,
    messagesSent: row.messages_sent,
    messagesReceived: row.messages_received,
  }
}

// ---- MessageTemplate ----
export function mapMessageTemplate(row: MsgTplRow): MessageTemplate {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    contentEn: row.content_en,
    contentHe: row.content_he,
    variables: row.variables,
    trigger: row.trigger,
    bodyTemplate: row.body_template,
    isActive: row.is_active,
    language: row.language,
  }
}

// ---- AutomationRule ----
export function mapAutomationRule(row: AutoRuleRow): AutomationRule {
  return {
    id: row.id,
    name: row.name,
    trigger: row.trigger,
    action: row.action,
    enabled: row.enabled,
    isActive: row.is_active,
    delay: row.delay ?? undefined,
    delayMinutes: row.delay_minutes,
  }
}
