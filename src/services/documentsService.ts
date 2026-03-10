/**
 * Document types & presets service
 */
import { supabase } from '@/lib/supabase'
import { mapDocumentType, mapDocumentPreset } from '@/lib/mappers'
import type { DocumentType, DocumentPreset } from '@/types'

// ---- Document Types ----

export async function getDocumentTypes(): Promise<DocumentType[]> {
  const { data, error } = await supabase
    .from('document_types')
    .select('*')
    .order('sort_order', { ascending: true })

  if (error) throw error
  return (data ?? []).map(mapDocumentType)
}

export async function getDocumentTypeById(id: string): Promise<DocumentType | null> {
  const { data, error } = await supabase
    .from('document_types')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw error
  }
  return data ? mapDocumentType(data) : null
}

export async function createDocumentType(
  workspaceId: string,
  input: {
    name: string
    category?: string
    description?: string
    helperText?: string
    defaultRequired?: boolean
    isRequired?: boolean
    allowedFormats?: string[]
    maxSizeMB?: number
    applicableCaseTypes?: string[]
  }
): Promise<DocumentType> {
  const { data, error } = await supabase
    .from('document_types')
    .insert({
      workspace_id: workspaceId,
      name: input.name,
      category: input.category ?? 'general',
      description: input.description ?? '',
      helper_text: input.helperText ?? '',
      default_required: input.defaultRequired ?? false,
      is_required: input.isRequired ?? false,
      allowed_formats: input.allowedFormats ?? ['pdf', 'jpg', 'png'],
      max_size_mb: input.maxSizeMB ?? 10,
      applicable_case_types: input.applicableCaseTypes ?? [],
      status: 'active',
    })
    .select()
    .single()

  if (error) throw error
  return mapDocumentType(data)
}

export async function updateDocumentType(
  id: string,
  input: Partial<{
    name: string
    category: string
    description: string
    helperText: string
    defaultRequired: boolean
    isRequired: boolean
    allowedFormats: string[]
    maxSizeMB: number
    status: string
    applicableCaseTypes: string[]
    sortOrder: number
  }>
): Promise<DocumentType> {
  const updateData: Record<string, unknown> = {}
  if (input.name !== undefined) updateData.name = input.name
  if (input.category !== undefined) updateData.category = input.category
  if (input.description !== undefined) updateData.description = input.description
  if (input.helperText !== undefined) updateData.helper_text = input.helperText
  if (input.defaultRequired !== undefined) updateData.default_required = input.defaultRequired
  if (input.isRequired !== undefined) updateData.is_required = input.isRequired
  if (input.allowedFormats !== undefined) updateData.allowed_formats = input.allowedFormats
  if (input.maxSizeMB !== undefined) updateData.max_size_mb = input.maxSizeMB
  if (input.status !== undefined) updateData.status = input.status
  if (input.applicableCaseTypes !== undefined) updateData.applicable_case_types = input.applicableCaseTypes
  if (input.sortOrder !== undefined) updateData.sort_order = input.sortOrder

  const { data, error } = await supabase
    .from('document_types')
    .update(updateData)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return mapDocumentType(data)
}

export async function deleteDocumentType(id: string): Promise<void> {
  const { error } = await supabase
    .from('document_types')
    .delete()
    .eq('id', id)

  if (error) throw error
}

// ---- Document Presets ----

export async function getDocumentPresets(): Promise<DocumentPreset[]> {
  const { data, error } = await supabase
    .from('document_presets')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []).map(mapDocumentPreset)
}

export async function createDocumentPreset(
  workspaceId: string,
  input: {
    name: string
    caseType: string
    documentTypeIds: string[]
    description?: string
  }
): Promise<DocumentPreset> {
  const { data, error } = await supabase
    .from('document_presets')
    .insert({
      workspace_id: workspaceId,
      name: input.name,
      case_type: input.caseType,
      document_type_ids: input.documentTypeIds,
      description: input.description ?? '',
    })
    .select()
    .single()

  if (error) throw error
  return mapDocumentPreset(data)
}

export async function updateDocumentPreset(
  id: string,
  input: Partial<{
    name: string
    caseType: string
    documentTypeIds: string[]
    description: string
  }>
): Promise<DocumentPreset> {
  const updateData: Record<string, unknown> = {}
  if (input.name !== undefined) updateData.name = input.name
  if (input.caseType !== undefined) updateData.case_type = input.caseType
  if (input.documentTypeIds !== undefined) updateData.document_type_ids = input.documentTypeIds
  if (input.description !== undefined) updateData.description = input.description

  const { data, error } = await supabase
    .from('document_presets')
    .update(updateData)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return mapDocumentPreset(data)
}

export async function deleteDocumentPreset(id: string): Promise<void> {
  const { error } = await supabase
    .from('document_presets')
    .delete()
    .eq('id', id)

  if (error) throw error
}
