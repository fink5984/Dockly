/**
 * Activity events service
 */
import { supabase } from '@/lib/supabase'
import { mapActivityEvent } from '@/lib/mappers'
import type { ActivityEvent, ActivityType } from '@/types'

export async function getActivities(limit = 100): Promise<ActivityEvent[]> {
  const { data, error } = await supabase
    .from('activity_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return (data ?? []).map(mapActivityEvent)
}

export async function getActivitiesByCaseId(caseId: string): Promise<ActivityEvent[]> {
  const { data, error } = await supabase
    .from('activity_events')
    .select('*')
    .eq('case_id', caseId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []).map(mapActivityEvent)
}

export async function getActivitiesByClientId(clientId: string): Promise<ActivityEvent[]> {
  const { data, error } = await supabase
    .from('activity_events')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []).map(mapActivityEvent)
}

export async function createActivity(
  workspaceId: string,
  input: {
    type: ActivityType
    description: string
    userId: string
    userName: string
    clientId?: string
    clientName?: string
    caseId?: string
    documentId?: string
    metadata?: Record<string, string>
  }
): Promise<ActivityEvent> {
  const { data, error } = await supabase
    .from('activity_events')
    .insert({
      workspace_id: workspaceId,
      type: input.type,
      description: input.description,
      user_id: input.userId,
      user_name: input.userName,
      client_id: input.clientId ?? null,
      client_name: input.clientName ?? null,
      case_id: input.caseId ?? null,
      document_id: input.documentId ?? null,
      metadata: (input.metadata as any) ?? null,
    })
    .select()
    .single()

  if (error) throw error
  return mapActivityEvent(data)
}
