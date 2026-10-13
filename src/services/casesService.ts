/**
 * Cases service — CRUD operations against Supabase
 */
import { supabase } from '@/lib/supabase'
import { mapCase, mapCaseDocument } from '@/lib/mappers'
import type { Case, CaseDocument } from '@/types'

/**
 * Fetch all cases for the current workspace, joined with client name and documents.
 */
export async function getCases(workspaceId: string): Promise<Case[]> {
  const { data, error } = await supabase
    .from('cases')
    .select(`
      *,
      clients!inner ( name ),
      case_documents (
        *,
        document_types ( name, category )
      )
    `)
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })

  if (error) throw error

  return (data ?? []).map((row: any) => {
    const docs: CaseDocument[] = (row.case_documents ?? []).map((d: any) =>
      mapCaseDocument(d, d.document_types?.name ?? '', d.document_types?.category ?? '')
    )
    return mapCase(row, row.clients?.name ?? '', docs)
  })
}

/**
 * Fetch a single case by ID with full details.
 */
export async function getCaseById(id: string): Promise<Case | null> {
  const { data, error } = await supabase
    .from('cases')
    .select(`
      *,
      clients!inner ( name ),
      case_documents (
        *,
        document_types ( name, category )
      )
    `)
    .eq('id', id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw error
  }

  const docs: CaseDocument[] = ((data as any).case_documents ?? []).map((d: any) =>
    mapCaseDocument(d, d.document_types?.name ?? '', d.document_types?.category ?? '')
  )
  return mapCase(data as any, (data as any).clients?.name ?? '', docs)
}

/**
 * Create a new case with its required documents.
 */
export async function createCase(
  workspaceId: string,
  input: {
    clientId: string
    caseType: string
    assignedOwner?: string
    deadline?: string
    notes?: string
    documentTypeIds?: string[]
  }
): Promise<Case> {
  // 1. Insert the case
  // Generate a permanent public token for sharing
  const publicToken = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')

  const { data: caseRow, error: caseErr } = await supabase
    .from('cases')
    .insert({
      workspace_id: workspaceId,
      client_id: input.clientId,
      case_type: input.caseType,
      status: 'new',
      assigned_owner: input.assignedOwner ?? '',
      deadline: input.deadline ?? null,
      notes: input.notes ?? null,
      public_token: publicToken,
    })
    .select('*, clients!inner ( name )')
    .single()

  if (caseErr) throw caseErr

  // 2. Insert case documents if documentTypeIds provided
  if (input.documentTypeIds && input.documentTypeIds.length > 0) {
    const docsToInsert = input.documentTypeIds.map((dtId, i) => ({
      case_id: (caseRow as any).id as string,
      document_type_id: dtId,
      is_required: true,
      status: 'missing',
      sort_order: i,
    }))

    const { error: docsErr } = await supabase
      .from('case_documents')
      .insert(docsToInsert)

    if (docsErr) throw docsErr
  }

  // 3. Fetch the full case with docs
  return (await getCaseById((caseRow as any).id))!
}

/**
 * Update a case.
 */
export async function updateCase(
  id: string,
  input: Partial<{
    status: string
    assignedOwner: string
    deadline: string | null
    notes: string | null
    lastActivityDate: string
    caseType: string
  }>
): Promise<Case> {
  const updateData: Record<string, unknown> = {}
  if (input.status !== undefined) updateData.status = input.status
  if (input.assignedOwner !== undefined) updateData.assigned_owner = input.assignedOwner
  if (input.deadline !== undefined) updateData.deadline = input.deadline
  if (input.notes !== undefined) updateData.notes = input.notes
  if (input.lastActivityDate !== undefined) updateData.last_activity_date = input.lastActivityDate
  if (input.caseType !== undefined) updateData.case_type = input.caseType

  const { error } = await supabase
    .from('cases')
    .update(updateData)
    .eq('id', id)

  if (error) throw error
  return (await getCaseById(id))!
}

/**
 * Delete a case: remove S3 files for all uploaded documents, then delete from DB.
 */
export async function deleteCase(id: string): Promise<void> {
  // 1. Fetch the case with its documents to get storage paths
  const caseData = await getCaseById(id)
  if (caseData) {
    // Collect all storage paths from uploaded documents
    const storagePaths = caseData.requiredDocuments
      .map(d => d.storagePath)
      .filter((p): p is string => !!p)

    // Delete individual files from S3
    if (storagePaths.length > 0) {
      try {
        const { deleteFiles } = await import('@/services/storageService')
        await deleteFiles(storagePaths)
      } catch (err) {
        console.warn('Failed to delete some S3 files:', err)
      }
    }
  }

  // 2. Delete from DB (cascade will remove case_documents)
  const { error } = await supabase
    .from('cases')
    .delete()
    .eq('id', id)

  if (error) throw error
}

// ---- Case Documents ----

export async function updateCaseDocument(
  id: string,
  input: Partial<{
    status: string
    notes: string | null
    caseNotes: string | null
    fileName: string
    fileType: string
    fileSize: number
    storagePath: string
    storageStatus: string
    uploadedBy: string
    uploadedAt: string
    reviewedBy: string
    reviewedAt: string
    rejectionReason: string | null
  }>
): Promise<void> {
  const updateData: Record<string, unknown> = {}
  if (input.status !== undefined) updateData.status = input.status
  if (input.notes !== undefined) updateData.notes = input.notes
  if (input.caseNotes !== undefined) updateData.case_notes = input.caseNotes
  if (input.fileName !== undefined) updateData.file_name = input.fileName
  if (input.fileType !== undefined) updateData.file_type = input.fileType
  if (input.fileSize !== undefined) updateData.file_size = input.fileSize
  if (input.storagePath !== undefined) updateData.storage_path = input.storagePath
  if (input.storageStatus !== undefined) updateData.storage_status = input.storageStatus
  if (input.uploadedBy !== undefined) updateData.uploaded_by = input.uploadedBy
  if (input.uploadedAt !== undefined) updateData.uploaded_at = input.uploadedAt
  if (input.reviewedBy !== undefined) updateData.reviewed_by = input.reviewedBy
  if (input.reviewedAt !== undefined) updateData.reviewed_at = input.reviewedAt
  if (input.rejectionReason !== undefined) updateData.rejection_reason = input.rejectionReason

  const { error } = await supabase
    .from('case_documents')
    .update(updateData)
    .eq('id', id)

  if (error) throw error
}

export async function addCaseDocument(
  caseId: string,
  documentTypeId: string,
  isRequired = true,
): Promise<void> {
  const { error } = await supabase
    .from('case_documents')
    .insert({
      case_id: caseId,
      document_type_id: documentTypeId,
      is_required: isRequired,
      status: 'missing',
      sort_order: 0,
    })

  if (error) throw error
}

export async function removeCaseDocument(id: string): Promise<void> {
  const { error } = await supabase
    .from('case_documents')
    .delete()
    .eq('id', id)

  if (error) throw error
}
