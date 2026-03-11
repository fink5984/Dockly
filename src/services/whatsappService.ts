/**
 * WhatsApp Bot Service
 * Handles sending interactive WhatsApp messages to clients for document collection.
 * The full conversation (document list, file upload) happens within WhatsApp.
 */
import { supabase } from '@/lib/supabase'
import type { WhatsAppMessage } from '@/types'

// ---- Send document request via WhatsApp ----

export interface SendDocumentRequestParams {
  workspaceId: string
  caseId: string
  clientId: string
  phoneNumber: string
  language: 'en' | 'he'
  messageType?: 'initial' | 'reminder' | 'document_invalid'
}

export interface SendDocumentRequestResult {
  success: boolean
  messageId?: string
  status: 'sent' | 'pending' | 'failed'
  pendingDocuments: number
  error?: string
}

/**
 * Send an interactive WhatsApp message to a client.
 * The message includes a button to view and upload required documents — all within WhatsApp.
 */
export async function sendDocumentRequest(
  params: SendDocumentRequestParams
): Promise<SendDocumentRequestResult> {
  // 1. Count pending documents
  const { count } = await supabase
    .from('case_documents')
    .select('*', { count: 'exact', head: true })
    .eq('case_id', params.caseId)
    .in('status', ['pending', 'missing', 'rejected'])

  // 2. Get case type (used as title in message)
  const { data: caseRow } = await supabase
    .from('cases')
    .select('case_type')
    .eq('id', params.caseId)
    .single()

  // 3. Call the server endpoint (uses ENV token, not DB)
  try {
    const response = await fetch('/api/whatsapp/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: params.workspaceId,
        caseId: params.caseId,
        clientId: params.clientId,
        phoneNumber: params.phoneNumber,
        language: params.language || 'he',
        caseTitle: caseRow?.case_type || '',
        pendingCount: count ?? 0,
        messageType: params.messageType || 'initial',
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      return {
        success: false,
        status: 'failed',
        pendingDocuments: count ?? 0,
        error: `Server error: ${response.status} - ${text}`,
      }
    }

    const result = await response.json()

    return {
      success: result.success,
      messageId: result.messageId,
      status: result.success ? 'sent' : 'failed',
      pendingDocuments: count ?? 0,
      error: result.error,
    }
  } catch (err: any) {
    return {
      success: false,
      status: 'failed',
      pendingDocuments: count ?? 0,
      error: err.message || 'Network error',
    }
  }
}

// ---- Generate upload link without sending WhatsApp ----

/**
 * Create an upload token and get the URL, without sending a WhatsApp message.
 * Useful for copying the link manually.
 */
export async function generateUploadLink(
  workspaceId: string,
  caseId: string,
  clientId: string
): Promise<{ uploadUrl: string; token: string }> {
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  const { error } = await supabase
    .from('client_upload_tokens')
    .insert({
      workspace_id: workspaceId,
      case_id: caseId,
      client_id: clientId,
      token,
      expires_at: expiresAt,
    })

  if (error) throw error

  const baseUrl = window.location.origin
  return {
    uploadUrl: `${baseUrl}/upload/${token}`,
    token,
  }
}

// ---- Validate upload token (for the public upload portal) ----

export interface UploadTokenInfo {
  valid: boolean
  expired: boolean
  used: boolean
  caseId: string
  clientId: string
  workspaceId: string
}

export async function validateUploadToken(token: string): Promise<UploadTokenInfo> {
  const { data, error } = await supabase
    .from('client_upload_tokens')
    .select('*')
    .eq('token', token)
    .single()

  if (error || !data) {
    return { valid: false, expired: false, used: false, caseId: '', clientId: '', workspaceId: '' }
  }

  const isExpired = new Date(data.expires_at) < new Date()

  return {
    valid: !isExpired && !data.is_used,
    expired: isExpired,
    used: data.is_used,
    caseId: data.case_id,
    clientId: data.client_id,
    workspaceId: data.workspace_id,
  }
}

// ---- Get case documents for upload portal ----

export interface UploadPortalDocument {
  id: string
  documentTypeId: string
  documentTypeName: string
  status: string
  isRequired: boolean
  helperText: string
  allowedFormats: string[]
  maxSizeMB: number
}

export async function getPortalDocuments(caseId: string): Promise<UploadPortalDocument[]> {
  const { data: caseDocs, error: caseErr } = await supabase
    .from('case_documents')
    .select('id, document_type_id, status, is_required')
    .eq('case_id', caseId)
    .order('sort_order', { ascending: true })

  if (caseErr || !caseDocs) return []

  const docTypeIds = caseDocs.map(d => d.document_type_id)
  const { data: docTypes } = await supabase
    .from('document_types')
    .select('id, name, description, helper_text, allowed_formats, max_size_mb')
    .in('id', docTypeIds)

  const typeMap = new Map((docTypes ?? []).map(dt => [dt.id, dt]))

  return caseDocs.map(doc => {
    const dt = typeMap.get(doc.document_type_id)
    return {
      id: doc.id,
      documentTypeId: doc.document_type_id,
      documentTypeName: dt?.name || 'Document',
      status: doc.status,
      isRequired: doc.is_required,
      helperText: dt?.helper_text || '',
      allowedFormats: dt?.allowed_formats || ['pdf', 'jpg', 'png'],
      maxSizeMB: dt?.max_size_mb || 10,
    }
  })
}

// ---- Upload file from portal ----

export async function uploadFromPortal(
  workspaceId: string,
  caseId: string,
  documentId: string,
  file: File,
  clientId: string
): Promise<void> {
  const storagePath = `${workspaceId}/${caseId}/${documentId}/${file.name}`

  // Upload file
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
      uploaded_by: `portal:${clientId}`,
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
    const uploaded = allDocs.filter(d => d.status === 'uploaded').length
    const missing = allDocs.filter(d => ['missing', 'pending-upload'].includes(d.status)).length

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

// ---- Mark token as used ----

export async function markTokenUsed(token: string): Promise<void> {
  await supabase
    .from('client_upload_tokens')
    .update({ is_used: true })
    .eq('token', token)
}

// ---- Get WhatsApp messages log ----

export async function getWhatsAppMessages(
  workspaceId: string,
  caseId?: string
): Promise<WhatsAppMessage[]> {
  let query = supabase
    .from('whatsapp_messages')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(100)

  if (caseId) {
    query = query.eq('case_id', caseId)
  }

  const { data, error } = await query

  if (error) throw error

  return (data ?? []).map(row => ({
    id: row.id,
    workspaceId: row.workspace_id,
    caseId: row.case_id,
    clientId: row.client_id,
    direction: row.direction as 'outbound' | 'inbound',
    phoneNumber: row.phone_number,
    messageType: row.message_type,
    content: row.content,
    status: row.status as 'pending' | 'sent' | 'delivered' | 'read' | 'failed',
    waMessageId: row.wa_message_id,
    templateName: row.template_name,
    errorMessage: row.error_message,
    metadata: row.metadata as Record<string, unknown> | undefined,
    createdAt: row.created_at,
  }))
}
