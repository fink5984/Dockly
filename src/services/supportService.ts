/**
 * Support requests & messages service
 */
import { supabase } from '@/lib/supabase'
import { mapSupportRequest, mapSupportMessage } from '@/lib/mappers'
import type { SupportRequest, SupportMessage } from '@/types'

export async function getSupportRequests(workspaceId: string): Promise<SupportRequest[]> {
  const { data, error } = await supabase
    .from('support_requests')
    .select(`
      *,
      clients ( name ),
      support_messages ( * )
    `)
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })

  if (error) throw error

  return (data ?? []).map((row: any) => {
    const messages: SupportMessage[] = (row.support_messages ?? [])
      .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .map(mapSupportMessage)
    return mapSupportRequest(row, row.clients?.name ?? '', messages)
  })
}

export async function getSupportRequestsByCaseId(caseId: string): Promise<SupportRequest[]> {
  const { data, error } = await supabase
    .from('support_requests')
    .select(`
      *,
      clients ( name ),
      support_messages ( * )
    `)
    .eq('case_id', caseId)
    .order('created_at', { ascending: false })

  if (error) throw error

  return (data ?? []).map((row: any) => {
    const messages: SupportMessage[] = (row.support_messages ?? [])
      .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .map(mapSupportMessage)
    return mapSupportRequest(row, row.clients?.name ?? '', messages)
  })
}

export async function createSupportRequest(
  input: {
    caseId: string
    clientId: string
    subject: string
    issueDescription: string
    assignedStaff?: string
  }
): Promise<SupportRequest> {
  const { data, error } = await supabase
    .from('support_requests')
    .insert({
      case_id: input.caseId,
      client_id: input.clientId,
      subject: input.subject,
      issue_description: input.issueDescription,
      assigned_staff: input.assignedStaff ?? null,
      status: 'open',
      opened_at: new Date().toISOString(),
    })
    .select('*, clients ( name )')
    .single()

  if (error) throw error
  return mapSupportRequest(data as any, (data as any).clients?.name ?? '', [])
}

export async function updateSupportRequest(
  id: string,
  input: Partial<{
    status: string
    assignedStaff: string | null
    closedAt: string | null
  }>
): Promise<void> {
  const updateData: Record<string, unknown> = {}
  if (input.status !== undefined) updateData.status = input.status
  if (input.assignedStaff !== undefined) updateData.assigned_staff = input.assignedStaff
  if (input.closedAt !== undefined) updateData.closed_at = input.closedAt

  const { error } = await supabase
    .from('support_requests')
    .update(updateData)
    .eq('id', id)

  if (error) throw error
}

export async function sendSupportMessage(
  requestId: string,
  input: {
    senderType: 'client' | 'staff' | 'system'
    senderName: string
    content: string
  }
): Promise<SupportMessage> {
  const { data, error } = await supabase
    .from('support_messages')
    .insert({
      request_id: requestId,
      sender_type: input.senderType,
      sender_name: input.senderName,
      content: input.content,
    })
    .select()
    .single()

  if (error) throw error
  return mapSupportMessage(data)
}

export async function markMessageRead(id: string): Promise<void> {
  const { error } = await supabase
    .from('support_messages')
    .update({ is_read: true })
    .eq('id', id)

  if (error) throw error
}
