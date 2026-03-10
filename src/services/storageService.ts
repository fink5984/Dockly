/**
 * File storage service — upload, download, delete files via Supabase Storage
 */
import { supabase } from '@/lib/supabase'

const BUCKET = 'documents'

/**
 * Build a storage path: {workspaceId}/{caseId}/{documentId}/{fileName}
 */
function buildPath(
  workspaceId: string,
  caseId: string,
  documentId: string,
  fileName: string
): string {
  return `${workspaceId}/${caseId}/${documentId}/${fileName}`
}

/**
 * Upload a file to the documents bucket.
 * Returns the storage path on success.
 */
export async function uploadFile(
  workspaceId: string,
  caseId: string,
  documentId: string,
  file: File
): Promise<{ storagePath: string; fileSize: number }> {
  const path = buildPath(workspaceId, caseId, documentId, file.name)

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: true,
      contentType: file.type,
    })

  if (error) throw error

  return {
    storagePath: path,
    fileSize: file.size,
  }
}

/**
 * Get a signed URL for a private file (valid for 1 hour).
 * Returns null if the file doesn't exist in storage.
 */
export async function getSignedUrl(
  storagePath: string,
  expiresInSeconds = 3600
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds)

  if (error) throw error
  return data.signedUrl
}

/**
 * Get a public URL for a file (works for public buckets).
 */
export function getPublicUrl(storagePath: string): string {
  const { data } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(storagePath)
  return data.publicUrl
}

/**
 * Download a file blob directly.
 */
export async function downloadFile(storagePath: string): Promise<Blob> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(storagePath)

  if (error) throw error
  return data
}

/**
 * Delete a file from storage.
 */
export async function deleteFile(storagePath: string): Promise<void> {
  const { error } = await supabase.storage
    .from(BUCKET)
    .remove([storagePath])

  if (error) throw error
}

/**
 * Replace a file (upsert): deletes old and uploads new.
 */
export async function replaceFile(
  workspaceId: string,
  caseId: string,
  documentId: string,
  file: File,
  oldPath?: string
): Promise<{ storagePath: string; fileSize: number }> {
  // Delete old file if exists and path differs
  const newPath = buildPath(workspaceId, caseId, documentId, file.name)
  if (oldPath && oldPath !== newPath) {
    try {
      await deleteFile(oldPath)
    } catch {
      // Ignore deletion errors for missing files
    }
  }

  return uploadFile(workspaceId, caseId, documentId, file)
}

/**
 * List all files in a document folder.
 */
export async function listFiles(
  workspaceId: string,
  caseId: string,
  documentId: string
): Promise<{ name: string; size: number; createdAt: string }[]> {
  const folder = `${workspaceId}/${caseId}/${documentId}`
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list(folder)

  if (error) throw error
  return (data ?? []).map((f) => ({
    name: f.name,
    size: (f.metadata as any)?.size ?? 0,
    createdAt: f.created_at ?? new Date().toISOString(),
  }))
}

/**
 * Upload a workspace-level asset (e.g. logo).
 */
export async function uploadWorkspaceAsset(
  workspaceId: string,
  fileName: string,
  file: File
): Promise<string> {
  const path = `${workspaceId}/_assets/${fileName}`

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: true,
      contentType: file.type,
    })

  if (error) throw error

  // Get public URL for assets
  const { data } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(path)

  return data.publicUrl
}
