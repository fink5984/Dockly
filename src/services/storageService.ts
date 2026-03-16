/**
 * File storage service — upload, download, delete files via AWS S3 (through server API)
 */

const API_BASE = '/api/storage'

// ── Helper: sanitize path segment (mirrors server logic) ────────────────
function sanitizeSegment(name: string): string {
  if (!name) return '_'
  return name
    .replace(/[\/\\:*?"<>|#%&{}$!'@+`=]/g, '_')
    .replace(/\s+/g, ' ')
    .trim() || '_'
}

/**
 * Build a human-readable storage path for documents.
 * Pattern: {workspaceName}/{clientName}/{caseType}/{documentTypeName}/{fileName}
 */
export function buildReadablePath(
  workspaceName: string,
  clientName: string,
  caseType: string,
  documentTypeName: string,
  fileName: string
): string {
  return [
    sanitizeSegment(workspaceName),
    sanitizeSegment(clientName),
    sanitizeSegment(caseType),
    sanitizeSegment(documentTypeName),
    sanitizeSegment(fileName),
  ].join('/')
}

/**
 * Upload a file using presigned URL approach:
 *   1. Ask server for a presigned S3 PUT URL
 *   2. Upload file directly to S3
 * Returns the storage key (path in S3).
 */
export async function uploadFile(
  file: File,
  pathInfo: {
    type: 'document'
    workspaceName: string
    clientName: string
    caseType: string
    documentTypeName: string
    fileName: string
  }
): Promise<{ storagePath: string; fileSize: number }> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('pathInfo', JSON.stringify(pathInfo))

  const resp = await fetch(`${API_BASE}/upload`, {
    method: 'POST',
    body: formData,
  })
  const data = await resp.json()
  if (!data.success) throw new Error(data.error || 'Upload failed')

  return {
    storagePath: data.key,
    fileSize: file.size,
  }
}

/**
 * Upload using a legacy-style path (for backward compatibility).
 */
export async function uploadFileWithKey(
  key: string,
  file: File
): Promise<{ storagePath: string; fileSize: number }> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('key', key)

  const resp = await fetch(`${API_BASE}/upload`, {
    method: 'POST',
    body: formData,
  })
  const data = await resp.json()
  if (!data.success) throw new Error(data.error || 'Upload failed')

  return { storagePath: data.key, fileSize: file.size }
}

/**
 * Upload raw bytes (e.g. generated PDF) via server.
 */
export async function uploadBuffer(
  key: string,
  buffer: Uint8Array | ArrayBuffer,
  contentType: string
): Promise<string> {
  const uint8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const base64Data = btoa(String.fromCharCode(...uint8))

  const resp = await fetch(`${API_BASE}/upload-buffer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, base64Data, contentType }),
  })
  const data = await resp.json()
  if (!data.success) throw new Error(data.error || 'Failed to upload buffer')
  return data.key
}

/**
 * Get a signed URL for a private file (valid for 1 hour).
 */
export async function getSignedUrl(
  storagePath: string,
  expiresInSeconds = 3600
): Promise<string> {
  const resp = await fetch(`${API_BASE}/presign-download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: storagePath, expiresIn: expiresInSeconds }),
  })
  const data = await resp.json()
  if (!data.success) throw new Error(data.error || 'Failed to get signed URL')
  return data.url
}

/**
 * Get a public URL for a file — for S3 we use presigned URL with long expiry.
 */
export function getPublicUrl(storagePath: string): string {
  // Can't generate presigned URL synchronously — return a proxy URL
  return `${API_BASE}/download?key=${encodeURIComponent(storagePath)}`
}

/**
 * Download a file blob via server proxy.
 */
export async function downloadFile(storagePath: string): Promise<Blob> {
  const resp = await fetch(`${API_BASE}/download?key=${encodeURIComponent(storagePath)}`)
  if (!resp.ok) throw new Error(`Download failed: ${resp.statusText}`)
  return resp.blob()
}

/**
 * Delete a file from storage.
 */
export async function deleteFile(storagePath: string): Promise<void> {
  const resp = await fetch(`${API_BASE}/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: storagePath }),
  })
  const data = await resp.json()
  if (!data.success) throw new Error(data.error || 'Failed to delete file')
}

/**
 * Replace a file (delete old + upload new).
 */
export async function replaceFile(
  file: File,
  pathInfo: {
    type: 'document'
    workspaceName: string
    clientName: string
    caseType: string
    documentTypeName: string
    fileName: string
  },
  oldPath?: string
): Promise<{ storagePath: string; fileSize: number }> {
  if (oldPath) {
    try {
      await deleteFile(oldPath)
    } catch {
      // Ignore deletion errors for missing files
    }
  }
  return uploadFile(file, pathInfo)
}

/**
 * List all files in a folder (prefix).
 */
export async function listFiles(
  prefix: string
): Promise<{ name: string; size: number; lastModified: string }[]> {
  const resp = await fetch(`${API_BASE}/list`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix }),
  })
  const data = await resp.json()
  if (!data.success) throw new Error(data.error || 'Failed to list files')
  return (data.objects ?? []).map((obj: any) => ({
    name: obj.key?.split('/').pop() ?? '',
    size: obj.size ?? 0,
    lastModified: obj.lastModified ?? new Date().toISOString(),
  }))
}

/**
 * Upload a workspace-level asset (e.g. logo).
 * Returns a URL to access the asset.
 */
export async function uploadWorkspaceAsset(
  workspaceName: string,
  fileName: string,
  file: File
): Promise<string> {
  const pathInfo = {
    type: 'asset' as const,
    workspaceName,
    fileName,
  }

  const formData = new FormData()
  formData.append('file', file)
  formData.append('pathInfo', JSON.stringify(pathInfo))

  const resp = await fetch(`${API_BASE}/upload`, {
    method: 'POST',
    body: formData,
  })
  const data = await resp.json()
  if (!data.success) throw new Error(data.error || 'Upload failed')

  // Return a proxy URL for the asset
  return `${API_BASE}/download?key=${encodeURIComponent(data.key)}`
}

