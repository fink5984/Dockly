/**
 * Browser side of push notifications and app install.
 *
 * Push: the service worker (public/sw.js, scoped to /app) shows the
 * notifications; this module subscribes/unsubscribes this device with the
 * server. Install: the web app manifest is only linked for paying
 * workspaces, so browsers offer "Install app" to them alone.
 */
import { pushApi } from '@/services'
import type { Language } from '@/types'
import type { SubscriptionStatus } from '@/types/billing'

const SW_URL = '/sw.js'
const SW_SCOPE = '/app'

export const PAID_STATUSES: ReadonlySet<SubscriptionStatus> = new Set(['active', 'past_due'])

/** Link the web app manifest only while a paying workspace is signed in. */
export function setInstallable(installable: boolean) {
  const existing = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
  if (installable && !existing) {
    const link = document.createElement('link')
    link.rel = 'manifest'
    link.href = '/site.webmanifest'
    document.head.appendChild(link)
  } else if (!installable && existing) {
    existing.remove()
  }
}

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

export const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

const keyBytes = (base64url: string) => {
  const b64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}
const sameKey = (sub: PushSubscription, publicKey: string) => {
  const current = sub.options.applicationServerKey
  if (!current) return false
  const a = new Uint8Array(current), b = keyBytes(publicKey)
  return a.length === b.length && a.every((v, i) => v === b[i])
}

async function registration() {
  return (await navigator.serviceWorker.getRegistration(SW_SCOPE)) || navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE })
}

async function existingSubscription() {
  if (!pushSupported()) return null
  const reg = await navigator.serviceWorker.getRegistration(SW_SCOPE)
  return reg ? reg.pushManager.getSubscription() : null
}

async function register(sub: PushSubscription, language: Language) {
  const json = sub.toJSON()
  await pushApi.subscribe({ endpoint: sub.endpoint, keys: { p256dh: json.keys!.p256dh, auth: json.keys!.auth }, language })
}

export async function isPushOnHere() {
  return Boolean(await existingSubscription())
}

/** Ask permission (must run from a click) and subscribe this device. */
export async function enablePush(publicKey: string, language: Language): Promise<'on' | 'denied'> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return 'denied'
  const reg = await registration()
  await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (sub && !sameKey(sub, publicKey)) { await sub.unsubscribe(); sub = null }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) })
  await register(sub, language)
  return 'on'
}

/** Stop pushes to this device (also used on sign-out). */
export async function disablePush() {
  const sub = await existingSubscription()
  if (!sub) return
  await pushApi.unsubscribe(sub.endpoint).catch(() => {})
  await sub.unsubscribe().catch(() => {})
}

/**
 * On app start: keep an existing subscription registered to the signed-in
 * user and current language, and renew it if the server's keys changed.
 */
export async function syncPush(publicKey: string, language: Language) {
  if (!pushSupported() || Notification.permission !== 'granted') return
  const sub = await existingSubscription()
  if (!sub) return
  if (sameKey(sub, publicKey)) { await register(sub, language); return }
  await sub.unsubscribe().catch(() => {})
  const reg = await registration()
  await register(await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }), language)
}
