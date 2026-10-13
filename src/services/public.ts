/** Client for the unauthenticated portal & signing endpoints. */
import { api, uploadFile } from '@/lib/api'
import type { DocStatus, Language, SignatureFieldType, SignatureStatus, Progress } from '@/types'

export interface PortalDocument {
  id: string
  name: string
  description: string
  helperText: string
  clientNote: string
  required: boolean
  status: DocStatus
  canUpload: boolean
  allowedFormats: string[]
  maxSizeMB: number
  fileName?: string
  uploadedAt?: string
  rejectionReason?: string
}

export interface PortalData {
  workspace: { name: string; logo?: string; brandColor?: string; email?: string; phone?: string; portalMessage?: string; defaultLanguage: Language }
  request: { title: string; instructions: string; deadline?: string; status: string; closed: boolean; clientName: string; language: Language }
  documents: PortalDocument[]
  progress: Progress
}

export interface SignerData {
  title: string
  description?: string
  status: SignatureStatus
  clientName: string
  signerName?: string
  signedAt?: string
  expiresAt?: string
  canvasWidth: number
  language: Language
  workspace: { name: string; logo?: string; brandColor?: string }
  documents: { id: string; fileName: string; hasSigned: boolean }[]
  fields: { id: string; type: SignatureFieldType; label: string; page: number; x: number; y: number; width: number; height: number; required: boolean; docIndex: number }[]
  consentText: Record<Language, string>
}

const t = (token: string) => encodeURIComponent(token)

export const portalApi = {
  get: (token: string) => api.get<PortalData>(`/api/public/portal/${t(token)}`),
  upload: (token: string, docId: string, file: File, onProgress?: (f: number) => void) =>
    uploadFile<{ document: PortalDocument; requestStatus: string }>(`/api/public/portal/${t(token)}/documents/${docId}`, file, onProgress),
  fileUrl: (token: string, docId: string) => api.get<{ url: string }>(`/api/public/portal/${t(token)}/documents/${docId}/file`),
}

export const signerApi = {
  get: (token: string) => api.get<SignerData>(`/api/public/sign/${t(token)}`),
  fileUrl: (token: string, doc = 'main', variant: 'original' | 'signed' = 'original', disposition: 'inline' | 'attachment' = 'inline') =>
    api.get<{ url: string }>(`/api/public/sign/${t(token)}/file?doc=${encodeURIComponent(doc)}&variant=${variant}&disposition=${disposition}`),
  view: (token: string) => api.post<{ ok: boolean }>(`/api/public/sign/${t(token)}/view`),
  submit: (token: string, d: { signerName: string; consent: boolean; language: Language; values: { fieldId: string; value: string }[] }) =>
    api.post<{ ok: boolean; signedAt: string }>(`/api/public/sign/${t(token)}/submit`, d),
  decline: (token: string, reason: string) => api.post<{ ok: boolean }>(`/api/public/sign/${t(token)}/decline`, { reason }),
}
