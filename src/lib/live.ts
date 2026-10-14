/**
 * One shared Server-Sent Events connection per tab. Components subscribe to
 * topics ('requests', 'clients', …) and refetch through the API when a change
 * is announced. Events carry ids only, never data.
 */
type Handler = (evt: { topic: string; [k: string]: unknown }) => void

let source: EventSource | null = null
const handlers = new Set<Handler>()
let connected = false
const statusListeners = new Set<(c: boolean) => void>()

function ensureConnection() {
  if (source || typeof EventSource === 'undefined') return
  source = new EventSource('/api/events', { withCredentials: true })
  source.addEventListener('change', (e) => {
    try {
      const data = JSON.parse((e as MessageEvent).data)
      handlers.forEach((h) => h(data))
    } catch { /* ignore malformed */ }
  })
  source.onopen = () => { connected = true; statusListeners.forEach((l) => l(true)) }
  source.onerror = () => { connected = false; statusListeners.forEach((l) => l(false)) }
}

export function startLive() {
  ensureConnection()
}

export function stopLive() {
  source?.close()
  source = null
  connected = false
}

/** `connect: false` listens without opening the connection (e.g. while signed out). */
export function subscribeLive(handler: Handler, { connect = true }: { connect?: boolean } = {}) {
  handlers.add(handler)
  if (connect) ensureConnection()
  return () => { handlers.delete(handler) }
}

export function isLiveConnected() {
  return connected
}

export function onLiveStatus(fn: (c: boolean) => void) {
  statusListeners.add(fn)
  return () => { statusListeners.delete(fn) }
}
