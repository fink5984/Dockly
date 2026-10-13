/**
 * Workspace-scoped change notifications, delivered to browsers over SSE.
 * Replaces Supabase Realtime (which required the database to be readable
 * by the public anon role). Events carry only the topic and ids — never
 * row contents — and clients refetch through the authorized API.
 */
import { EventEmitter } from 'events'

const bus = new EventEmitter()
bus.setMaxListeners(1000)

/**
 * @param {string} workspaceId
 * @param {string} topic e.g. 'requests' | 'clients' | 'signatures' | 'activity' | 'support' | 'notifications'
 * @param {object} [data] small, non-sensitive payload (ids)
 */
export function publish(workspaceId, topic, data = {}) {
  if (!workspaceId) return
  bus.emit(`ws:${workspaceId}`, { topic, ...data, at: Date.now() })
}

export function subscribe(workspaceId, listener) {
  const channel = `ws:${workspaceId}`
  bus.on(channel, listener)
  return () => bus.off(channel, listener)
}
