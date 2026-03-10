/**
 * Settings, case type configs, WhatsApp config, templates, automation rules
 */
import { supabase } from '@/lib/supabase'
import {
  mapWorkspace,
  mapCaseTypeConfig,
  mapWhatsAppConfig,
  mapMessageTemplate,
  mapAutomationRule,
  mapNotification,
} from '@/lib/mappers'
import type {
  Workspace,
  CaseTypeConfig,
  WhatsAppConfig,
  MessageTemplate,
  AutomationRule,
  Notification,
  DashboardStats,
} from '@/types'

// ---- Workspace ----

export async function getWorkspace(id: string): Promise<Workspace | null> {
  const { data, error } = await supabase
    .from('workspaces')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw error
  }
  return data ? mapWorkspace(data) : null
}

export async function updateWorkspace(
  id: string,
  input: Partial<{
    name: string
    businessType: string
    contactPerson: string
    phone: string
    email: string
    logoUrl: string | null
    defaultLanguage: string
    timezone: string
  }>
): Promise<Workspace> {
  const updateData: Record<string, unknown> = {}
  if (input.name !== undefined) updateData.name = input.name
  if (input.businessType !== undefined) updateData.business_type = input.businessType
  if (input.contactPerson !== undefined) updateData.contact_person = input.contactPerson
  if (input.phone !== undefined) updateData.phone = input.phone
  if (input.email !== undefined) updateData.email = input.email
  if (input.logoUrl !== undefined) updateData.logo_url = input.logoUrl
  if (input.defaultLanguage !== undefined) updateData.default_language = input.defaultLanguage
  if (input.timezone !== undefined) updateData.timezone = input.timezone

  const { data, error } = await supabase
    .from('workspaces')
    .update(updateData)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return mapWorkspace(data)
}

export async function createWorkspace(
  input: {
    name: string
    businessType: string
    contactPerson: string
    phone: string
    email: string
    defaultLanguage?: string
    timezone?: string
  }
): Promise<Workspace> {
  const { data, error } = await supabase
    .from('workspaces')
    .insert({
      name: input.name,
      business_type: input.businessType,
      contact_person: input.contactPerson,
      phone: input.phone,
      email: input.email,
      default_language: input.defaultLanguage ?? 'en',
      timezone: input.timezone ?? 'UTC',
    })
    .select()
    .single()

  if (error) throw error
  return mapWorkspace(data)
}

// ---- Case Type Configs ----

export async function getCaseTypeConfigs(workspaceId: string): Promise<CaseTypeConfig[]> {
  const { data, error } = await supabase
    .from('case_type_configs')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('name', { ascending: true })

  if (error) throw error
  return (data ?? []).map(mapCaseTypeConfig)
}

export async function upsertCaseTypeConfig(
  workspaceId: string,
  input: {
    id: string
    name: string
    nameHe?: string
    icon?: string
    color?: string
    defaultDocumentTypeIds?: string[]
    isActive?: boolean
  }
): Promise<CaseTypeConfig> {
  const { data, error } = await supabase
    .from('case_type_configs')
    .upsert({
      id: input.id,
      workspace_id: workspaceId,
      name: input.name,
      name_he: input.nameHe ?? '',
      icon: input.icon ?? 'FolderOpen',
      color: input.color ?? 'bg-gray-500',
      default_document_type_ids: input.defaultDocumentTypeIds ?? [],
      is_active: input.isActive ?? true,
    })
    .select()
    .single()

  if (error) throw error
  return mapCaseTypeConfig(data)
}

export async function deleteCaseTypeConfig(id: string): Promise<void> {
  const { error } = await supabase
    .from('case_type_configs')
    .delete()
    .eq('id', id)

  if (error) throw error
}

// ---- WhatsApp Config ----

export async function getWhatsAppConfig(workspaceId: string): Promise<WhatsAppConfig | null> {
  const { data, error } = await supabase
    .from('whatsapp_config')
    .select('*')
    .eq('workspace_id', workspaceId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw error
  }
  return data ? mapWhatsAppConfig(data) : null
}

export async function upsertWhatsAppConfig(
  workspaceId: string,
  input: Partial<{
    isConnected: boolean
    phoneNumber: string | null
    apiKey: string | null
  }>
): Promise<WhatsAppConfig> {
  const insertData = {
    workspace_id: workspaceId,
    is_connected: input.isConnected ?? false,
    phone_number: input.phoneNumber ?? null,
    api_key: input.apiKey ?? null,
  }

  const { data, error } = await supabase
    .from('whatsapp_config')
    .upsert(insertData, { onConflict: 'workspace_id' })
    .select()
    .single()

  if (error) throw error
  return mapWhatsAppConfig(data)
}

// ---- Message Templates ----

export async function getMessageTemplates(workspaceId: string): Promise<MessageTemplate[]> {
  const { data, error } = await supabase
    .from('message_templates')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []).map(mapMessageTemplate)
}

export async function createMessageTemplate(
  workspaceId: string,
  input: {
    key: string
    name: string
    contentEn?: string
    contentHe?: string
    variables?: string[]
    trigger?: string
    bodyTemplate?: string
    isActive?: boolean
    language?: string
  }
): Promise<MessageTemplate> {
  const { data, error } = await supabase
    .from('message_templates')
    .insert({
      workspace_id: workspaceId,
      key: input.key,
      name: input.name,
      content_en: input.contentEn ?? '',
      content_he: input.contentHe ?? '',
      variables: input.variables ?? [],
      trigger: input.trigger ?? '',
      body_template: input.bodyTemplate ?? '',
      is_active: input.isActive ?? true,
      language: input.language ?? 'en',
    })
    .select()
    .single()

  if (error) throw error
  return mapMessageTemplate(data)
}

export async function updateMessageTemplate(
  id: string,
  input: Partial<{
    name: string
    contentEn: string
    contentHe: string
    variables: string[]
    trigger: string
    bodyTemplate: string
    isActive: boolean
  }>
): Promise<MessageTemplate> {
  const updateData: Record<string, unknown> = {}
  if (input.name !== undefined) updateData.name = input.name
  if (input.contentEn !== undefined) updateData.content_en = input.contentEn
  if (input.contentHe !== undefined) updateData.content_he = input.contentHe
  if (input.variables !== undefined) updateData.variables = input.variables
  if (input.trigger !== undefined) updateData.trigger = input.trigger
  if (input.bodyTemplate !== undefined) updateData.body_template = input.bodyTemplate
  if (input.isActive !== undefined) updateData.is_active = input.isActive

  const { data, error } = await supabase
    .from('message_templates')
    .update(updateData)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return mapMessageTemplate(data)
}

export async function deleteMessageTemplate(id: string): Promise<void> {
  const { error } = await supabase
    .from('message_templates')
    .delete()
    .eq('id', id)

  if (error) throw error
}

// ---- Automation Rules ----

export async function getAutomationRules(workspaceId: string): Promise<AutomationRule[]> {
  const { data, error } = await supabase
    .from('automation_rules')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []).map(mapAutomationRule)
}

export async function createAutomationRule(
  workspaceId: string,
  input: {
    name: string
    trigger?: string
    action?: string
    enabled?: boolean
    isActive?: boolean
    delay?: string
    delayMinutes?: number
  }
): Promise<AutomationRule> {
  const { data, error } = await supabase
    .from('automation_rules')
    .insert({
      workspace_id: workspaceId,
      name: input.name,
      trigger: input.trigger ?? '',
      action: input.action ?? '',
      enabled: input.enabled ?? true,
      is_active: input.isActive ?? true,
      delay: input.delay ?? null,
      delay_minutes: input.delayMinutes ?? 0,
    })
    .select()
    .single()

  if (error) throw error
  return mapAutomationRule(data)
}

export async function updateAutomationRule(
  id: string,
  input: Partial<{
    name: string
    trigger: string
    action: string
    enabled: boolean
    isActive: boolean
    delay: string | null
    delayMinutes: number
  }>
): Promise<AutomationRule> {
  const updateData: Record<string, unknown> = {}
  if (input.name !== undefined) updateData.name = input.name
  if (input.trigger !== undefined) updateData.trigger = input.trigger
  if (input.action !== undefined) updateData.action = input.action
  if (input.enabled !== undefined) updateData.enabled = input.enabled
  if (input.isActive !== undefined) updateData.is_active = input.isActive
  if (input.delay !== undefined) updateData.delay = input.delay
  if (input.delayMinutes !== undefined) updateData.delay_minutes = input.delayMinutes

  const { data, error } = await supabase
    .from('automation_rules')
    .update(updateData)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return mapAutomationRule(data)
}

export async function deleteAutomationRule(id: string): Promise<void> {
  const { error } = await supabase
    .from('automation_rules')
    .delete()
    .eq('id', id)

  if (error) throw error
}

// ---- Notifications ----

export async function getNotifications(userId: string): Promise<Notification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) throw error
  return (data ?? []).map(mapNotification)
}

export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('id', id)

  if (error) throw error
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', userId)
    .eq('read', false)

  if (error) throw error
}

// ---- Dashboard Stats (computed from live data) ----

export async function getDashboardStats(workspaceId: string): Promise<DashboardStats> {
  const [
    { count: totalClients },
    { count: openCases },
    { count: completedCases },
    { count: delayedCases },
    { count: activeSupportRequests },
  ] = await Promise.all([
    supabase.from('clients').select('*', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('status', 'active'),
    supabase.from('cases').select('*', { count: 'exact', head: true }).eq('workspace_id', workspaceId).in('status', ['new', 'waiting-for-client', 'partial-submission', 'awaiting-review']),
    supabase.from('cases').select('*', { count: 'exact', head: true }).eq('workspace_id', workspaceId).in('status', ['completed', 'closed']),
    supabase.from('cases').select('*', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('status', 'delayed'),
    supabase.from('support_requests').select('*', { count: 'exact', head: true }).eq('workspace_id', workspaceId).in('status', ['open', 'waiting-for-staff', 'waiting-for-client']),
  ])

  return {
    totalClients: totalClients ?? 0,
    openCases: openCases ?? 0,
    completedCases: completedCases ?? 0,
    noSubmissionClients: 0,
    partialSubmissionClients: 0,
    fullyCompletedClients: 0,
    delayedCases: delayedCases ?? 0,
    activeSupportRequests: activeSupportRequests ?? 0,
  }
}
