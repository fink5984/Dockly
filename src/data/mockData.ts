import type {
  Client, Case, DocumentType, DocumentPreset,
  SupportRequest, ActivityEvent, DashboardStats, Notification,
  WhatsAppConfig, MessageTemplate, AutomationRule, CaseTypeConfig
} from '@/types'

export const caseTypeConfigs: CaseTypeConfig[] = []

export const mockDocumentTypes: DocumentType[] = []

export const mockPresets: DocumentPreset[] = []
export const documentPresets = mockPresets

export const mockClients: Client[] = []

export const mockCases: Case[] = []

export const mockSupportRequests: SupportRequest[] = []

export const mockActivities: ActivityEvent[] = []

export const mockDashboardStats: DashboardStats = {
  totalClients: 0,
  openCases: 0,
  completedCases: 0,
  noSubmissionClients: 0,
  partialSubmissionClients: 0,
  fullyCompletedClients: 0,
  delayedCases: 0,
  activeSupportRequests: 0,
}

export const mockNotifications: Notification[] = []

export const mockWhatsAppConfig: WhatsAppConfig = {
  connected: false,
  isConnected: false,
  phoneNumber: '',
  lastSync: '',
  connectedAt: '',
  messagesSent: 0,
  messagesReceived: 0,
}
export const whatsappConfig = mockWhatsAppConfig

export const mockMessageTemplates: MessageTemplate[] = []
export const messageTemplates = mockMessageTemplates

export const mockAutomationRules: AutomationRule[] = []
export const automationRules = mockAutomationRules
