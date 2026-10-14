/**
 * Typed wrappers around the Dockly API. Pages call these; they never build
 * URLs themselves.
 */
import { api, uploadFile } from '@/lib/api'
import type {
  User, Workspace, Client, DocumentType, RequestTemplate, DocRequest, RequestList, FileVersion, Delivery,
  ActivityEvent, SupportRequest, SignatureRequest, SignatureEvent, Notification, TeamMember, Invite,
  AutomationSettings, ChannelStatus, Dashboard, LibraryItem, SearchResults, Language, Role, TemplateItem,
} from '@/types'
import type { BillingState, CheckoutSession, ChangeResult, Invoice, BillingSummary } from '@/types/billing'
import type { Catalog, Interval, QuoteLine } from '@shared/billing/pricing.mjs'

const qs = (params: Record<string, string | number | undefined | null>) => {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v))
  const str = s.toString()
  return str ? `?${str}` : ''
}

export interface Me { user: User | null; workspace: Workspace | null; billing?: BillingSummary | null }

export const authApi = {
  me: () => api.get<Me>('/api/auth/me'),
  signIn: (email: string, password: string) => api.post<Me>('/api/auth/signin', { email, password }),
  signUp: (d: { email: string; password: string; name: string; phone?: string; language?: Language; attribution?: Record<string, string> }) => api.post<Me>('/api/auth/signup', d),
  signOut: () => api.post<{ ok: boolean }>('/api/auth/signout'),
  signOutAll: () => api.post<{ ok: boolean }>('/api/auth/signout-all'),
  updateProfile: (d: { name?: string; phone?: string }) => api.patch<Me>('/api/auth/me', d),
  changePassword: (currentPassword: string, newPassword: string) => api.post<{ ok: boolean }>('/api/auth/change-password', { currentPassword, newPassword }),
  invite: (token: string) => api.get<{ email: string; name: string; role: Role; workspaceName: string }>(`/api/auth/invite/${encodeURIComponent(token)}`),
  acceptInvite: (token: string, name: string, password: string) => api.post<Me>(`/api/auth/invite/${encodeURIComponent(token)}/accept`, { name, password }),
}

export const workspaceApi = {
  get: () => api.get<Workspace>('/api/workspace'),
  update: (d: Partial<{ name: string; businessType: string; contactPerson: string; phone: string; email: string; defaultLanguage: Language; timezone: string; brandColor: string | null; portalMessage: string; logoUrl: null }>) =>
    api.patch<Workspace>('/api/workspace', d),
  uploadLogo: (file: File) => uploadFile<Workspace>('/api/workspace/logo', file).promise,
  automation: () => api.get<{ settings: AutomationSettings; channels: ChannelStatus; schedulerEnabled: boolean }>('/api/automation'),
  saveAutomation: (s: AutomationSettings) => api.put<{ settings: AutomationSettings; channels: ChannelStatus; schedulerEnabled: boolean }>('/api/automation', s),
  integrations: () => api.get<ChannelStatus>('/api/integrations'),
  team: () => api.get<{ members: TeamMember[]; invites: Invite[] }>('/api/team'),
  invite: (d: { email: string; name?: string; role: Exclude<Role, 'owner'> }) => api.post<{ id: string; link: string; expiresAt: string; emailed: boolean }>('/api/team/invites', d),
  revokeInvite: (id: string) => api.del<{ ok: boolean }>(`/api/team/invites/${id}`),
  setRole: (id: string, role: Role) => api.patch<{ ok: boolean }>(`/api/team/members/${id}`, { role }),
  removeMember: (id: string) => api.del<{ ok: boolean }>(`/api/team/members/${id}`),
}

export const notificationsApi = {
  list: () => api.get<Notification[]>('/api/notifications'),
  readAll: () => api.post<{ ok: boolean }>('/api/notifications/read-all'),
  read: (id: string) => api.post<{ ok: boolean }>(`/api/notifications/${id}/read`),
}

export type ClientInput = { name: string; email?: string; phone?: string; company?: string | null; notes?: string | null; status?: Client['status'] }

export interface ClientOverview {
  client: Client
  requests: { id: string; title: string; status: DocRequest['status']; deadline?: string; createdAt: string; lastActivityDate?: string; progress: DocRequest['progress'] }[]
  signatures: { id: string; title: string; status: SignatureRequest['status']; createdAt: string; signedAt?: string; expiresAt?: string }[]
  documents: { id: string; requestId: string; name: string; status: string; fileName: string; fileType: string; fileSize: number; uploadedAt: string }[]
  messages: { id: string; direction: 'inbound' | 'outbound'; type: string; content: string; status: string; createdAt: string }[]
}

export const clientsApi = {
  list: (p: { search?: string; status?: string } = {}) => api.get<Client[]>(`/api/clients${qs(p)}`),
  get: (id: string) => api.get<Client>(`/api/clients/${id}`),
  overview: (id: string) => api.get<ClientOverview>(`/api/clients/${id}/overview`),
  create: (d: ClientInput) => api.post<Client>('/api/clients', d),
  update: (id: string, d: Partial<ClientInput>) => api.patch<Client>(`/api/clients/${id}`, d),
  remove: (id: string) => api.del<{ ok: boolean }>(`/api/clients/${id}`),
}

export type DocumentTypeInput = Partial<Pick<DocumentType, 'name' | 'category' | 'description' | 'helperText' | 'allowedFormats' | 'maxSizeMB' | 'status' | 'sortOrder'>>

export const libraryApi = {
  documentTypes: () => api.get<DocumentType[]>('/api/document-types'),
  createDocumentType: (d: DocumentTypeInput & { name: string }) => api.post<DocumentType>('/api/document-types', d),
  updateDocumentType: (id: string, d: DocumentTypeInput) => api.patch<DocumentType>(`/api/document-types/${id}`, d),
  deleteDocumentType: (id: string) => api.del<{ ok: boolean; archived: boolean }>(`/api/document-types/${id}`),
  templates: () => api.get<RequestTemplate[]>('/api/request-templates'),
  createTemplate: (d: Omit<RequestTemplate, 'id' | 'createdAt' | 'updatedAt'>) => api.post<RequestTemplate>('/api/request-templates', d),
  updateTemplate: (id: string, d: Omit<RequestTemplate, 'id' | 'createdAt' | 'updatedAt'>) => api.put<RequestTemplate>(`/api/request-templates/${id}`, d),
  duplicateTemplate: (id: string) => api.post<RequestTemplate>(`/api/request-templates/${id}/duplicate`),
  deleteTemplate: (id: string) => api.del<{ ok: boolean }>(`/api/request-templates/${id}`),
  starters: () => api.get<{ key: string; en: string; he: string; docs: [string, string][] }[]>('/api/request-templates/starters'),
  installStarter: (key: string, language: Language) => api.post<RequestTemplate>(`/api/request-templates/starters/${key}`, { language }),
}

export interface CreateRequestInput {
  clientId?: string
  newClient?: { name: string; phone?: string; email?: string }
  title: string
  instructions?: string
  notes?: string
  deadline?: string | null
  language?: Language | null
  remindersEnabled?: boolean
  items: TemplateItem[]
  send?: { channel: 'whatsapp' | 'email' } | null
}

export interface SendResult { ok: boolean; deliveryId?: string; simulated?: boolean; code?: string; error?: string }

export const requestsApi = {
  list: (p: { status?: string; clientId?: string; search?: string; sort?: string; page?: number; pageSize?: number; include?: 'documents' } = {}) =>
    api.get<RequestList>(`/api/requests${qs(p)}`),
  get: (id: string) => api.get<DocRequest>(`/api/requests/${id}`),
  create: (d: CreateRequestInput) => api.post<{ request: DocRequest; send: SendResult | null }>('/api/requests', d),
  update: (id: string, d: Partial<{ title: string; instructions: string; notes: string | null; deadline: string | null; language: Language | null; remindersEnabled: boolean; action: 'close' | 'reopen' }>) =>
    api.patch<DocRequest>(`/api/requests/${id}`, d),
  remove: (id: string) => api.del<{ ok: boolean }>(`/api/requests/${id}`),
  duplicate: (id: string, clientId?: string) => api.post<DocRequest>(`/api/requests/${id}/duplicate`, clientId ? { clientId } : {}),
  saveAsTemplate: (id: string, name: string) => api.post<RequestTemplate>(`/api/requests/${id}/save-as-template`, { name }),
  addDocument: (id: string, d: { documentTypeId: string; required: boolean; note?: string }) => api.post<DocRequest>(`/api/requests/${id}/documents`, d),
  updateDocument: (id: string, docId: string, d: Partial<{ required: boolean; clientNote: string | null; notes: string | null; customName: string | null }>) =>
    api.patch<DocRequest>(`/api/requests/${id}/documents/${docId}`, d),
  removeDocument: (id: string, docId: string) => api.del<DocRequest>(`/api/requests/${id}/documents/${docId}`),
  review: (id: string, docId: string, d: { action: 'approve' | 'reject' | 'reopen'; reason?: string; notifyClient?: boolean; channel?: 'whatsapp' | 'email' }) =>
    api.post<{ request: DocRequest; notify: SendResult | null }>(`/api/requests/${id}/documents/${docId}/review`, d),
  uploadDocument: (id: string, docId: string, file: File, onProgress?: (f: number) => void) =>
    uploadFile<DocRequest>(`/api/requests/${id}/documents/${docId}/upload`, file, onProgress),
  fileUrl: (id: string, docId: string, opts: { version?: string; disposition?: 'inline' | 'attachment' } = {}) =>
    api.get<{ url: string; fileName: string; mimeType?: string }>(`/api/requests/${id}/documents/${docId}/file${qs(opts)}`),
  versions: (id: string, docId: string) => api.get<FileVersion[]>(`/api/requests/${id}/documents/${docId}/versions`),
  send: (id: string, channel: 'whatsapp' | 'email', kind: 'initial' | 'reminder') => api.post<SendResult>(`/api/requests/${id}/send`, { channel, kind }),
  markSent: (id: string) => api.post<DocRequest>(`/api/requests/${id}/mark-sent`),
  portalLink: (id: string, action: 'regenerate' | 'enable' | 'disable') => api.post<DocRequest>(`/api/requests/${id}/portal-link`, { action }),
  communications: (id: string) => api.get<{ deliveries: Delivery[]; messages: { id: string; direction: string; type: string; content: string; status: string; error?: string; createdAt: string }[] }>(`/api/requests/${id}/communications`),
  addNote: (id: string, text: string) => api.post<{ ok: boolean }>(`/api/requests/${id}/notes`, { text }),
  downloadAllUrl: (id: string) => `/api/requests/${id}/download-all`,
}

export interface UploadedSignatureDoc { key: string; fileName: string; fileType: string; fileSize: number; pages: number; sha256: string }

export const signaturesApi = {
  list: (p: { clientId?: string } = {}) => api.get<SignatureRequest[]>(`/api/signatures${qs(p)}`),
  get: (id: string) => api.get<SignatureRequest>(`/api/signatures/${id}`),
  upload: (file: File, onProgress?: (f: number) => void) => uploadFile<UploadedSignatureDoc>('/api/signatures/uploads', file, onProgress),
  uploadUrl: (key: string) => api.get<{ url: string }>(`/api/signatures/uploads/url${qs({ key })}`),
  create: (d: {
    clientId: string; caseId?: string | null; title: string; description?: string | null
    document: UploadedSignatureDoc; extraDocuments?: UploadedSignatureDoc[]; canvasWidth: number
    fields: { type: string; label: string; page: number; x: number; y: number; width: number; height: number; required: boolean; docIndex: number }[]
    expiresAt?: string | null; language?: Language | null; send?: { channel: 'email' | 'whatsapp' } | null
  }) => api.post<{ request: SignatureRequest; send: SendResult | null }>('/api/signatures', d),
  fileUrl: (id: string, opts: { doc?: string; variant?: 'original' | 'signed'; disposition?: 'inline' | 'attachment' } = {}) =>
    api.get<{ url: string; fileName: string }>(`/api/signatures/${id}/file${qs(opts)}`),
  events: (id: string) => api.get<{ intact: boolean; events: SignatureEvent[] }>(`/api/signatures/${id}/events`),
  certificateUrl: (id: string, lang: Language, disposition: 'inline' | 'attachment' = 'attachment') => `/api/signatures/${id}/certificate?lang=${lang}&disposition=${disposition}`,
  send: (id: string, channel: 'email' | 'whatsapp', kind: 'request' | 'reminder') => api.post<SendResult>(`/api/signatures/${id}/send`, { channel, kind }),
  cancel: (id: string) => api.post<SignatureRequest>(`/api/signatures/${id}/cancel`),
  archive: (id: string) => api.del<{ ok: boolean }>(`/api/signatures/${id}`),
}

export const supportApi = {
  list: (p: { caseId?: string; open?: boolean } = {}) => api.get<SupportRequest[]>(`/api/support${qs({ caseId: p.caseId, open: p.open ? 'true' : undefined })}`),
  start: (caseId: string) => api.post<{ id: string }>('/api/support', { caseId }),
  reply: (id: string, content: string) => api.post<SendResult>(`/api/support/${id}/reply`, { content }),
  setStatus: (id: string, status: 'open' | 'resolved' | 'closed', notifyClient = false) => api.post<{ ok: boolean }>(`/api/support/${id}/status`, { status, notifyClient }),
  markRead: (id: string) => api.post<{ ok: boolean }>(`/api/support/${id}/mark-read`),
}

export const insightsApi = {
  dashboard: () => api.get<Dashboard>('/api/dashboard'),
  search: (q: string, signal?: AbortSignal) => api.get<SearchResults>(`/api/search${qs({ q })}`, { signal }),
  activity: (p: { caseId?: string; clientId?: string; before?: string; limit?: number; type?: string } = {}) => api.get<ActivityEvent[]>(`/api/activity${qs(p)}`),
  documents: (p: { search?: string; clientId?: string; source?: string; status?: string; type?: string; from?: string; to?: string } = {}) =>
    api.get<{ items: LibraryItem[]; usage: { bytes: number; versions: number } }>(`/api/documents${qs(p)}`),
}

const newIdempotencyKey = () => (crypto.randomUUID ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2)}`)

/**
 * Billing. Money-moving calls carry an Idempotency-Key so a double click or a
 * retried request returns the same checkout instead of opening a second one.
 */
export const billingApi = {
  state: () => api.get<BillingState>('/api/billing'),
  catalog: () => api.get<Catalog & { savings: Record<string, number> }>('/api/public/billing/catalog'),
  checkout: (d: { planCode: string; interval: Interval; addons?: Record<string, number> }, key = newIdempotencyKey()) =>
    api.post<{ sessionId: string; redirectUrl: string }>('/api/billing/checkout', d, { 'Idempotency-Key': key }),
  change: (d: { planCode: string; interval: Interval; addons?: Record<string, number> }, key = newIdempotencyKey()) =>
    api.post<ChangeResult>('/api/billing/change', d, { 'Idempotency-Key': key }),
  clearPending: () => api.del<{ ok: boolean }>('/api/billing/pending'),
  buyPack: (packCode: string, key = newIdempotencyKey()) => api.post<ChangeResult>('/api/billing/packs', { packCode }, { 'Idempotency-Key': key }),
  updatePaymentMethod: (key = newIdempotencyKey()) => api.post<{ sessionId: string; redirectUrl: string }>('/api/billing/payment-method', {}, { 'Idempotency-Key': key }),
  cancel: (reason?: string) => api.post<{ effectiveAt: string }>('/api/billing/cancel', reason ? { reason } : {}),
  resume: () => api.post<{ ok: boolean }>('/api/billing/resume'),
  saveDetails: (d: { name: string; email: string; taxId: string }) => api.put<{ ok: boolean }>('/api/billing/details', d),
  setInterest: (interest: 'collect' | 'sign' | 'both') => api.patch<{ ok: boolean }>('/api/billing/interest', { interest }),
  session: (id: string) => api.get<CheckoutSession>(`/api/billing/checkout/${id}`),
  syncSession: (id: string) => api.post<CheckoutSession>(`/api/billing/checkout/${id}/sync`),
  invoice: (id: string) => api.get<Invoice & { billedTo: { name: string; taxId: string }; provider: string }>(`/api/billing/invoices/${id}`),
  sandboxPage: (ref: string) => api.get<{ amount: number; currency: string; operation: string; status: string; kind: string; lines: QuoteLine[]; subtotal: number; vat: number; workspace: string; cards: string[] }>(`/api/public/billing/sandbox/${encodeURIComponent(ref)}`),
  sandboxComplete: (ref: string, card: string) => api.post<{ returnUrl: string }>(`/api/public/billing/sandbox/${encodeURIComponent(ref)}/complete`, { card }),
}
