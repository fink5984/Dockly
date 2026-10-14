/**
 * HTTP client for the Dockly API. Cookies carry the session; every
 * state-changing request sends the CSRF header the server requires.
 */

export class ApiError extends Error {
  status: number
  code: string
  details?: Record<string, unknown>
  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
  /** Field-level validation messages, if any. */
  get fields(): Record<string, string> {
    return (this.details?.fields as Record<string, string>) || {}
  }
}

type Listener = () => void
const unauthorizedListeners = new Set<Listener>()
/** Notified when an authenticated call returns 401 (session ended elsewhere). */
export function onUnauthorized(fn: Listener) {
  unauthorizedListeners.add(fn)
  return () => { unauthorizedListeners.delete(fn) }
}

const paymentRequiredListeners = new Set<(err: ApiError) => void>()
/** Notified when the server refuses an action because of the plan (HTTP 402): drives the upgrade dialog. */
export function onPaymentRequired(fn: (err: ApiError) => void) {
  paymentRequiredListeners.add(fn)
  return () => { paymentRequiredListeners.delete(fn) }
}

async function parseError(res: Response): Promise<ApiError> {
  let body: { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null = null
  try { body = await res.json() } catch { /* not json */ }
  const code = body?.error?.code || (res.status === 0 ? 'network_error' : `http_${res.status}`)
  return new ApiError(res.status, code, body?.error?.message || res.statusText || 'Request failed', body?.error?.details)
}

async function request<T>(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (method !== 'GET') headers['X-Requested-With'] = 'dockly'
  let payload: BodyInit | undefined
  if (body instanceof FormData) payload = body
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  let res: Response
  const { headers: extraHeaders, ...rest } = init
  Object.assign(headers, extraHeaders as Record<string, string> | undefined)
  try {
    res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin', ...rest })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new ApiError(0, 'network_error', 'You appear to be offline. Check your connection and try again.')
  }
  if (!res.ok) {
    const err = await parseError(res)
    if (res.status === 401 && !path.startsWith('/api/auth/') && !path.startsWith('/api/public/')) {
      unauthorizedListeners.forEach((fn) => fn())
    }
    if (res.status === 402) paymentRequiredListeners.forEach((fn) => fn(err))
    throw err
  }
  if (res.status === 204) return undefined as T
  const type = res.headers.get('content-type') || ''
  return (type.includes('application/json') ? res.json() : (res.blob() as unknown)) as Promise<T>
}

export const api = {
  get: <T>(path: string, init?: RequestInit) => request<T>('GET', path, undefined, init),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) => request<T>('POST', path, body ?? {}, headers ? { headers } : {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
}

export interface UploadHandle<T> {
  promise: Promise<T>
  abort: () => void
}

/**
 * Upload a single file with progress (XHR — fetch has no upload progress).
 * Resolves only once the server has stored the file and responded.
 */
export function uploadFile<T>(path: string, file: File, onProgress?: (fraction: number) => void): UploadHandle<T> {
  const xhr = new XMLHttpRequest()
  const promise = new Promise<T>((resolve, reject) => {
    xhr.open('POST', path)
    xhr.withCredentials = true
    xhr.setRequestHeader('X-Requested-With', 'dockly')
    xhr.setRequestHeader('Accept', 'application/json')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.min(0.99, e.loaded / e.total))
    }
    xhr.onload = () => {
      let data: { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null = null
      try { data = JSON.parse(xhr.responseText) } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1)
        resolve(data as T)
      } else {
        const err = new ApiError(xhr.status, data?.error?.code || `http_${xhr.status}`, data?.error?.message || 'Upload failed', data?.error?.details)
        if (xhr.status === 402) paymentRequiredListeners.forEach((fn) => fn(err))
        reject(err)
      }
    }
    xhr.onerror = () => reject(new ApiError(0, 'network_error', 'Connection lost during upload'))
    xhr.onabort = () => reject(new ApiError(0, 'aborted', 'Upload cancelled'))
    xhr.ontimeout = () => reject(new ApiError(0, 'timeout', 'Upload timed out'))
    xhr.timeout = 10 * 60 * 1000
    const fd = new FormData()
    fd.append('file', file, file.name)
    xhr.send(fd)
  })
  return { promise, abort: () => xhr.abort() }
}

/** Open a short-lived file URL returned by the API in a new tab, or download it. */
export async function openFileUrl(getUrl: () => Promise<{ url: string }>, mode: 'view' | 'download' = 'view') {
  // Open the tab synchronously (popup blockers), then point it at the URL.
  // ('noopener' would make window.open return null, so detach the opener manually.)
  const win = mode === 'view' ? window.open('', '_blank') : null
  if (win) win.opener = null
  try {
    const { url } = await getUrl()
    if (win) win.location.href = url
    else {
      const a = document.createElement('a')
      a.href = url
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
    }
  } catch (err) {
    win?.close()
    throw err
  }
}
