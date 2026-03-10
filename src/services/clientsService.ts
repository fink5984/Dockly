/**
 * Clients service — CRUD operations against Supabase
 */
import { supabase } from '@/lib/supabase'
import { mapClient } from '@/lib/mappers'
import type { Client } from '@/types'

export async function getClients(workspaceId: string): Promise<Client[]> {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []).map(mapClient)
}

export async function getClientById(id: string): Promise<Client | null> {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw error
  }
  return data ? mapClient(data) : null
}

export async function createClient(
  workspaceId: string,
  input: {
    name: string
    email: string
    phone?: string
    company?: string
    notes?: string
    assignedOwner?: string
  }
): Promise<Client> {
  const { data, error } = await supabase
    .from('clients')
    .insert({
      workspace_id: workspaceId,
      name: input.name,
      email: input.email,
      phone: input.phone ?? '',
      company: input.company ?? null,
      notes: input.notes ?? null,
      assigned_owner: input.assignedOwner ?? '',
      status: 'active',
    })
    .select()
    .single()

  if (error) throw error
  return mapClient(data)
}

export async function updateClient(
  id: string,
  input: Partial<{
    name: string
    email: string
    phone: string
    company: string | null
    notes: string | null
    status: string
    assignedOwner: string
  }>
): Promise<Client> {
  const updateData: Record<string, unknown> = {}
  if (input.name !== undefined) updateData.name = input.name
  if (input.email !== undefined) updateData.email = input.email
  if (input.phone !== undefined) updateData.phone = input.phone
  if (input.company !== undefined) updateData.company = input.company
  if (input.notes !== undefined) updateData.notes = input.notes
  if (input.status !== undefined) updateData.status = input.status
  if (input.assignedOwner !== undefined) updateData.assigned_owner = input.assignedOwner

  const { data, error } = await supabase
    .from('clients')
    .update(updateData)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return mapClient(data)
}

export async function deleteClient(id: string): Promise<void> {
  const { error } = await supabase
    .from('clients')
    .delete()
    .eq('id', id)

  if (error) throw error
}
