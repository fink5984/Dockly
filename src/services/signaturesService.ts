/**
 * Signatures service — CRUD operations for digital signature requests
 */
import { supabase } from '@/lib/supabase'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { uploadBuffer as s3UploadBuffer, downloadFile as s3DownloadFile, getSignedUrl as s3GetSignedUrl } from './storageService'
import type { SignatureRequest, SignatureField } from '@/types'

// ---- Mappers ----

function mapSignatureField(row: any): SignatureField {
  return {
    id: row.id,
    requestId: row.request_id,
    type: row.type,
    label: row.label,
    page: row.page,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    required: row.required,
    value: row.value ?? undefined,
    sortOrder: row.sort_order,
    docIndex: row.doc_index ?? 0,
  }
}

function mapSignatureRequest(row: any, clientName?: string, fields?: SignatureField[]): SignatureRequest {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    clientId: row.client_id,
    clientName: clientName ?? row.clients?.name ?? '',
    title: row.title,
    description: row.description ?? undefined,
    status: row.status,
    publicToken: row.public_token,
    documentFileName: row.document_file_name,
    documentStoragePath: row.document_storage_path,
    documentFileType: row.document_file_type,
    documentFileSize: row.document_file_size,
    canvasWidth: row.canvas_width ?? undefined,
    fields: fields ?? [],
    signedAt: row.signed_at ?? undefined,
    signedIp: row.signed_ip ?? undefined,
    signedDocumentPath: row.signed_document_path ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ---- Queries ----

export async function getSignatureRequests(workspaceId: string): Promise<SignatureRequest[]> {
  const { data, error } = await supabase
    .from('signature_requests')
    .select(`
      *,
      clients ( name ),
      signature_fields (*)
    `)
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })

  if (error) throw error

  return (data ?? []).map((row: any) => {
    const fields = (row.signature_fields ?? []).map(mapSignatureField)
    return mapSignatureRequest(row, row.clients?.name, fields)
  })
}

export async function getSignatureRequestById(id: string): Promise<SignatureRequest | null> {
  const { data, error } = await supabase
    .from('signature_requests')
    .select(`
      *,
      clients ( name ),
      signature_fields (*)
    `)
    .eq('id', id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw error
  }

  const fields = ((data as any).signature_fields ?? []).map(mapSignatureField)
  return mapSignatureRequest(data, (data as any).clients?.name, fields)
}

export async function getSignatureRequestByToken(token: string): Promise<SignatureRequest | null> {
  const { data, error } = await supabase
    .from('signature_requests')
    .select(`
      *,
      clients ( name ),
      signature_fields (*)
    `)
    .eq('public_token', token)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw error
  }

  const fields = ((data as any).signature_fields ?? []).map(mapSignatureField)
  return mapSignatureRequest(data, (data as any).clients?.name, fields)
}

export async function getSignatureRequestsByClient(clientId: string): Promise<SignatureRequest[]> {
  const { data, error } = await supabase
    .from('signature_requests')
    .select(`
      *,
      clients ( name ),
      signature_fields (*)
    `)
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })

  if (error) throw error

  return (data ?? []).map((row: any) => {
    const fields = (row.signature_fields ?? []).map(mapSignatureField)
    return mapSignatureRequest(row, row.clients?.name, fields)
  })
}

// ---- Mutations ----

export async function createSignatureRequest(
  workspaceId: string,
  input: {
    clientId: string
    title: string
    description?: string
    documentFileName: string
    documentStoragePath: string
    documentFileType: string
    documentFileSize: number
    canvasWidth?: number
    fields: Omit<SignatureField, 'id' | 'requestId'>[]
    expiresAt?: string
    createdBy: string
  }
): Promise<SignatureRequest> {
  const publicToken = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')

  const { data: row, error } = await supabase
    .from('signature_requests')
    .insert({
      workspace_id: workspaceId,
      client_id: input.clientId,
      title: input.title,
      description: input.description ?? null,
      status: 'pending',
      public_token: publicToken,
      document_file_name: input.documentFileName,
      document_storage_path: input.documentStoragePath,
      document_file_type: input.documentFileType,
      document_file_size: input.documentFileSize,
      canvas_width: input.canvasWidth ?? null,
      expires_at: input.expiresAt ?? null,
      created_by: input.createdBy,
    })
    .select('*, clients ( name )')
    .single()

  if (error) throw error

  // Insert fields
  if (input.fields.length > 0) {
    const fieldsToInsert = input.fields.map((f, i) => ({
      request_id: (row as any).id,
      type: f.type,
      label: f.label,
      page: f.page,
      x: f.x,
      y: f.y,
      width: f.width,
      height: f.height,
      required: f.required,
      sort_order: f.sortOrder ?? i,
      doc_index: f.docIndex ?? 0,
    }))

    const { error: fieldsErr } = await supabase
      .from('signature_fields')
      .insert(fieldsToInsert)

    if (fieldsErr) throw fieldsErr
  }

  return (await getSignatureRequestById((row as any).id))!
}

export async function updateSignatureRequest(
  id: string,
  input: Partial<{
    status: string
    signedAt: string
    signedIp: string
    signedDocumentPath: string
    title: string
    description: string | null
  }>
): Promise<void> {
  const updateData: Record<string, unknown> = {}
  if (input.status !== undefined) updateData.status = input.status
  if (input.signedAt !== undefined) updateData.signed_at = input.signedAt
  if (input.signedIp !== undefined) updateData.signed_ip = input.signedIp
  if (input.signedDocumentPath !== undefined) updateData.signed_document_path = input.signedDocumentPath
  if (input.title !== undefined) updateData.title = input.title
  if (input.description !== undefined) updateData.description = input.description

  const { error } = await supabase
    .from('signature_requests')
    .update(updateData)
    .eq('id', id)

  if (error) throw error
}

export async function updateSignatureFieldValue(
  fieldId: string,
  value: string
): Promise<void> {
  const { error } = await supabase
    .from('signature_fields')
    .update({ value })
    .eq('id', fieldId)

  if (error) throw error
}

export async function deleteSignatureRequest(id: string): Promise<void> {
  const { error } = await supabase
    .from('signature_requests')
    .delete()
    .eq('id', id)

  if (error) throw error
}

export async function cancelSignatureRequest(id: string): Promise<void> {
  await updateSignatureRequest(id, { status: 'cancelled' })
}

/**
 * Submit a public signature — saves field values, generates signed PDF, updates status
 */
export async function submitPublicSignature(
  token: string,
  fieldValues: { fieldId: string; value: string }[],
  clientIp?: string
): Promise<void> {
  // Fetch the request by token
  const request = await getSignatureRequestByToken(token)
  if (!request) throw new Error('Signature request not found')
  if (request.status === 'signed') throw new Error('Already signed')
  if (request.status === 'cancelled') throw new Error('Request was cancelled')
  if (request.status === 'expired') throw new Error('Request has expired')

  // Update each field value
  for (const fv of fieldValues) {
    await updateSignatureFieldValue(fv.fieldId, fv.value)
  }

  // Build a map of field values for PDF generation
  const valuesMap = new Map(fieldValues.map(fv => [fv.fieldId, fv.value]))

  // Generate signed PDF with overlaid fields — only main doc fields (docIndex === 0)
  const mainDocFields = request.fields.filter(f => (f.docIndex ?? 0) === 0)
  try {
    const signedPdfBytes = await generateSignedPdf(request, valuesMap, undefined, mainDocFields)

    // Upload signed PDF to S3
    const signedPath = request.documentStoragePath.replace(/\.pdf$/i, '_signed.pdf')
    let uploadSuccess = true
    try {
      await s3UploadBuffer(signedPath, signedPdfBytes, 'application/pdf')
    } catch { uploadSuccess = false }

    if (uploadSuccess) {
      // Save signed document path
      await updateSignatureRequest(request.id, {
        status: 'signed',
        signedAt: new Date().toISOString(),
        signedIp: clientIp ?? 'unknown',
        signedDocumentPath: signedPath,
      })
    } else {
      console.error('Failed to upload signed PDF, saving without it')
      await updateSignatureRequest(request.id, {
        status: 'signed',
        signedAt: new Date().toISOString(),
        signedIp: clientIp ?? 'unknown',
      })
    }
  } catch (err) {
    console.error('Failed to generate signed PDF, saving without it:', err)
    await updateSignatureRequest(request.id, {
      status: 'signed',
      signedAt: new Date().toISOString(),
      signedIp: clientIp ?? 'unknown',
    })
  }

  // Generate signed PDFs for extra documents that have fields
  try {
    const extraDocs = await getSignatureDocuments(request.id)
    for (let i = 0; i < extraDocs.length; i++) {
      const doc = extraDocs[i]
      const docIndex = i + 1 // Extra docs start at docIndex 1
      const docFields = request.fields.filter(f => (f.docIndex ?? 0) === docIndex)
      if (docFields.length === 0) continue

      try {
        const signedBytes = await generateSignedPdf(request, valuesMap, doc.storagePath, docFields)
        const signedDocPath = doc.storagePath.replace(/\.pdf$/i, '_signed.pdf')
        let docUploadOk = true
        try { await s3UploadBuffer(signedDocPath, signedBytes, 'application/pdf') } catch { docUploadOk = false }
        if (docUploadOk) {
          // Update the extra doc record with signed path
          await supabase
            .from('signature_documents')
            .update({ signed_storage_path: signedDocPath })
            .eq('id', doc.id)
        }
      } catch (docErr) {
        console.error(`Failed to generate signed PDF for extra doc ${doc.id}:`, docErr)
      }
    }
  } catch (extraErr) {
    console.error('Failed to process extra documents:', extraErr)
  }
}

/**
 * Generate a PDF with signature fields overlaid on the original document.
 *
 * Field positions (x, y, width, height) are stored in pixels relative to
 * the placement container (which renders the PDF fit-to-width).
 * `canvasWidth` (stored on the request) is the actual pixel width of that
 * container at the time the fields were placed. The scale factor is then
 * simply  pageW / canvasWidth  and applies to both x and y axes because
 * the PDF is rendered proportionally.
 *
 * Fallback for legacy records without canvasWidth: approximate 750 px.
 */
async function generateSignedPdf(
  request: SignatureRequest,
  valuesMap: Map<string, string>,
  storagePath?: string,
  fieldsSubset?: SignatureField[]
): Promise<Uint8Array> {
  const docPath = storagePath ?? request.documentStoragePath
  const fields = fieldsSubset ?? request.fields

  // Download the original PDF via S3 API
  const blob = await s3DownloadFile(docPath)
  if (!blob) throw new Error('Could not download original PDF')

  const pdfBytes = await blob.arrayBuffer()
  const pdfDoc = await PDFDocument.load(pdfBytes)
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const pages = pdfDoc.getPages()

  // Canvas width recorded during field placement (fallback for old data)
  const canvasW = request.canvasWidth ?? 750

  for (const field of fields) {
    const value = valuesMap.get(field.id)
    if (!value) continue

    const pageIndex = Math.max(0, (field.page || 1) - 1)
    if (pageIndex >= pages.length) continue
    const page = pages[pageIndex]

    const { width: pageW, height: pageH } = page.getSize()

    // Uniform scale: the PDF was rendered fit-to-width inside the canvas
    const scale = pageW / canvasW

    // PDF y-axis is bottom-up, field y is top-down from container top
    const pdfX = field.x * scale
    const pdfY = pageH - (field.y + field.height) * scale
    const pdfW = field.width * scale
    const pdfH = field.height * scale

    if (field.type === 'signature' && value.startsWith('data:image')) {
      try {
        const base64 = value.split(',')[1]
        const imgBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
        const pngImage = await pdfDoc.embedPng(imgBytes)
        page.drawImage(pngImage, {
          x: pdfX,
          y: pdfY,
          width: pdfW,
          height: pdfH,
        })
      } catch (err) {
        console.warn('Could not embed signature image:', err)
      }
    } else if (field.type === 'checkbox') {
      const text = value === 'true' ? '✓' : ''
      if (text) {
        const fontSize = Math.min(pdfH * 0.8, 14)
        page.drawText('X', {
          x: pdfX + 2,
          y: pdfY + 2,
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
        })
      }
    } else {
      // Text / date / name / initials
      const fontSize = Math.min(pdfH * 0.6, 12)
      page.drawText(value, {
        x: pdfX + 2,
        y: pdfY + (pdfH - fontSize) / 2,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
        maxWidth: pdfW - 4,
      })
    }
  }

  return pdfDoc.save()
}

/**
 * Ensure a signed PDF exists for a signed request.
 * If signedDocumentPath is already set, returns the request as-is.
 * Otherwise generates, uploads and saves the signed PDF (requires
 * authenticated storage access, i.e. called from the detail page).
 */
export async function ensureSignedPdfExists(
  request: SignatureRequest
): Promise<SignatureRequest> {
  if (request.status !== 'signed') return request
  if (request.signedDocumentPath) return request

  // Build values map from saved field values — only main doc fields
  const mainDocFields = request.fields.filter(f => (f.docIndex ?? 0) === 0)
  const valuesMap = new Map(
    mainDocFields.filter(f => f.value).map(f => [f.id, f.value!])
  )
  if (valuesMap.size === 0) return request

  const signedPdfBytes = await generateSignedPdf(request, valuesMap, undefined, mainDocFields)

  // Upload to S3
  const signedPath = request.documentStoragePath.replace(/\.pdf$/i, '_signed.pdf')
  await s3UploadBuffer(signedPath, signedPdfBytes, 'application/pdf')

  // Save path to request
  await updateSignatureRequest(request.id, { signedDocumentPath: signedPath })

  return { ...request, signedDocumentPath: signedPath }
}

/**
 * Generate a signed PDF and trigger a browser download.
 * Called from the business detail page (authenticated context).
 */
export async function generateAndDownloadSignedPdf(request: SignatureRequest): Promise<void> {
  const mainDocFields = request.fields.filter(f => (f.docIndex ?? 0) === 0)
  const valuesMap = new Map(mainDocFields.filter(f => f.value).map(f => [f.id, f.value!]))
  const pdfBytes = await generateSignedPdf(request, valuesMap, undefined, mainDocFields)

  // Trigger browser download
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blob = new Blob([pdfBytes as any], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = request.documentFileName.replace(/\.pdf$/i, '_signed.pdf')
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * get document signed URL for public access
 */
export async function getSignatureDocumentUrl(storagePath: string): Promise<string> {
  return s3GetSignedUrl(storagePath, 3600)
}

// ---- Signature Documents (multi-doc support) ----

export interface SignatureDocumentRow {
  id: string
  requestId: string
  fileName: string
  storagePath: string
  fileType: string
  fileSize: number
  sortOrder: number
  signedStoragePath?: string
  createdAt: string
}

export async function getSignatureDocuments(requestId: string): Promise<SignatureDocumentRow[]> {
  const { data, error } = await supabase
    .from('signature_documents')
    .select('*')
    .eq('request_id', requestId)
    .order('sort_order')

  if (error) throw error

  return (data ?? []).map((row: any) => ({
    id: row.id,
    requestId: row.request_id,
    fileName: row.file_name,
    storagePath: row.storage_path,
    fileType: row.file_type,
    fileSize: row.file_size,
    sortOrder: row.sort_order,
    signedStoragePath: row.signed_storage_path ?? undefined,
    createdAt: row.created_at,
  }))
}

export async function addSignatureDocument(
  requestId: string,
  input: {
    fileName: string
    storagePath: string
    fileType: string
    fileSize: number
    sortOrder: number
  }
): Promise<void> {
  const { error } = await supabase
    .from('signature_documents')
    .insert({
      request_id: requestId,
      file_name: input.fileName,
      storage_path: input.storagePath,
      file_type: input.fileType,
      file_size: input.fileSize,
      sort_order: input.sortOrder,
    })

  if (error) throw error
}

export async function removeSignatureDocument(id: string): Promise<void> {
  const { error } = await supabase
    .from('signature_documents')
    .delete()
    .eq('id', id)

  if (error) throw error
}
