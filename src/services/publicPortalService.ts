/**
 * Public Portal Service
 * Handles fetching case data and uploading documents via the permanent public link.
 * No authentication required — access is controlled by the public_token.
 */
import { supabase } from '@/lib/supabase'

// ---- Types ----

export interface PublicCaseInfo {
  caseId: string
  workspaceId: string
  clientId: string
  clientName: string
  caseType: string
  status: string
  workspaceName: string
  workspaceLogo?: string
}

export interface PublicDocument {
  id: string
  documentTypeId: string
  documentTypeName: string
  category: string
  status: string
  isRequired: boolean
  helperText: string
  allowedFormats: string[]
  maxSizeMB: number
  fileName?: string
  fileType?: string
  fileSize?: number
  storagePath?: string
  uploadedAt?: string
}

// ---- Fetch case by public token ----

export async function getCaseByPublicToken(
  token: string
): Promise<PublicCaseInfo | null> {
  const { data, error } = await supabase
    .from('cases')
    .select(`
      id, workspace_id, client_id, case_type, status,
      clients!inner ( name ),
      workspaces!cases_workspace_id_fkey ( name, logo_url )
    `)
    .eq('public_token', token)
    .single()

  if (error || !data) return null

  return {
    caseId: data.id,
    workspaceId: data.workspace_id,
    clientId: data.client_id,
    clientName: (data as any).clients?.name ?? '',
    caseType: data.case_type,
    status: data.status,
    workspaceName: (data as any).workspaces?.name ?? '',
    workspaceLogo: (data as any).workspaces?.logo_url ?? undefined,
  }
}

// ---- Fetch documents for the public portal ----

export async function getPublicDocuments(
  caseId: string
): Promise<PublicDocument[]> {
  const { data: caseDocs, error } = await supabase
    .from('case_documents')
    .select('id, document_type_id, status, is_required, file_name, file_type, file_size, storage_path, uploaded_at')
    .eq('case_id', caseId)
    .order('sort_order', { ascending: true })

  if (error || !caseDocs) return []

  const docTypeIds = caseDocs.map(d => d.document_type_id)
  const { data: docTypes } = await supabase
    .from('document_types')
    .select('id, name, category, description, helper_text, allowed_formats, max_size_mb')
    .in('id', docTypeIds)

  const typeMap = new Map((docTypes ?? []).map(dt => [dt.id, dt]))

  return caseDocs.map(doc => {
    const dt = typeMap.get(doc.document_type_id)
    return {
      id: doc.id,
      documentTypeId: doc.document_type_id,
      documentTypeName: dt?.name || 'Document',
      category: dt?.category || '',
      status: doc.status,
      isRequired: doc.is_required,
      helperText: dt?.helper_text || dt?.description || '',
      allowedFormats: dt?.allowed_formats || ['pdf', 'jpg', 'png'],
      maxSizeMB: dt?.max_size_mb || 10,
      fileName: doc.file_name ?? undefined,
      fileType: doc.file_type ?? undefined,
      fileSize: doc.file_size ?? undefined,
      storagePath: doc.storage_path ?? undefined,
      uploadedAt: doc.uploaded_at ?? undefined,
    }
  })
}

// ---- Upload file from public portal ----

export async function uploadFromPublicPortal(
  workspaceId: string,
  caseId: string,
  documentId: string,
  file: File,
  clientId: string
): Promise<void> {
  const storagePath = `${workspaceId}/${caseId}/${documentId}/${file.name}`

  // Upload file to storage
  const { error: uploadErr } = await supabase.storage
    .from('documents')
    .upload(storagePath, file, {
      cacheControl: '3600',
      upsert: true,
      contentType: file.type,
    })

  if (uploadErr) throw uploadErr

  // Update case_document record
  const { error: updateErr } = await supabase
    .from('case_documents')
    .update({
      status: 'uploaded',
      file_name: file.name,
      file_type: file.type,
      file_size: file.size,
      storage_path: storagePath,
      storage_status: 'ready',
      uploaded_by: `public:${clientId}`,
      uploaded_at: new Date().toISOString(),
    })
    .eq('id', documentId)

  if (updateErr) throw updateErr

  // Recalculate case status
  const { data: allDocs } = await supabase
    .from('case_documents')
    .select('status')
    .eq('case_id', caseId)

  if (allDocs) {
    const total = allDocs.length
    const uploaded = allDocs.filter(d =>
      !['missing', 'pending-upload'].includes(d.status)
    ).length
    const missing = allDocs.filter(d =>
      ['missing', 'pending-upload'].includes(d.status)
    ).length

    let newStatus: string
    if (uploaded >= total) {
      newStatus = 'completed'
    } else if (uploaded > 0 && missing > 0) {
      newStatus = 'partial-submission'
    } else {
      newStatus = 'waiting-for-client'
    }

    await supabase
      .from('cases')
      .update({ status: newStatus })
      .eq('id', caseId)
  }
}

// ---- Get signed URL for preview ----

export async function getPublicSignedUrl(
  storagePath: string,
  expiresInSeconds = 3600
): Promise<string> {
  const { data, error } = await supabase.storage
    .from('documents')
    .createSignedUrl(storagePath, expiresInSeconds)

  if (error) throw error
  return data.signedUrl
}
