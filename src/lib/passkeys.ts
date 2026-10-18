/**
 * Passkeys: sign in with the device's fingerprint, face or screen lock.
 * The server issues one-time challenges; the browser does the cryptography.
 */
import { browserSupportsWebAuthn, platformAuthenticatorIsAvailable, startAuthentication, startRegistration, WebAuthnError } from '@simplewebauthn/browser'
import { passkeyApi, type Me, type Passkey } from '@/services'
import { ApiError } from '@/lib/api'

export const passkeysSupported = () => browserSupportsWebAuthn()

/** True when this device has a built-in authenticator (fingerprint, face, Windows Hello). */
export async function deviceHasBiometrics(): Promise<boolean> {
  if (!passkeysSupported()) return false
  try { return await platformAuthenticatorIsAvailable() } catch { return false }
}

/** The user closed or cancelled the browser's passkey prompt (not an error to show). */
export function isPasskeyCancel(err: unknown): boolean {
  const name = err instanceof WebAuthnError ? (err.cause as Error | undefined)?.name ?? err.name : (err as Error | undefined)?.name
  return name === 'NotAllowedError' || name === 'AbortError' || (err instanceof WebAuthnError && err.code === 'ERROR_CEREMONY_ABORTED')
}

/** This device already holds a passkey for the account (registration refused by the browser). */
export const isPasskeyDuplicate = (err: unknown) => err instanceof WebAuthnError && err.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED'

/** Short technical reason for a failed passkey step, shown under the error and sent to the server log. */
export function passkeyErrorDetail(err: unknown): string {
  if (err instanceof ApiError) return [err.code, (err.details?.reason as string) || ''].filter(Boolean).join(': ')
  if (err instanceof WebAuthnError) {
    const cause = err.cause as Error | undefined
    return `${err.code}${cause ? ` (${cause.name}: ${cause.message})` : ''}`
  }
  const e = err as Error | undefined
  return e ? `${e.name}: ${e.message}` : String(err)
}

/** Best-effort: record why a passkey step failed on this device (never throws). */
export function reportPasskeyError(stage: 'register' | 'signin', err: unknown, elapsedMs?: number) {
  const timing = elapsedMs === undefined ? '' : ` after ${Math.round(elapsedMs)}ms`
  passkeyApi.reportError(stage, `${passkeyErrorDetail(err)}${timing}`.slice(0, 500)).catch(() => {})
}

export async function registerPasskey(password: string): Promise<Passkey> {
  const { challengeId, options } = await passkeyApi.registerOptions(password)
  const response = await startRegistration({ optionsJSON: options })
  return passkeyApi.registerVerify(challengeId, response)
}

/** `email` (typed, or the last one used with a passkey here) lets the server name the passkey to use. */
export async function signInWithPasskey(email?: string): Promise<Me> {
  const { challengeId, options } = await passkeyApi.signInOptions(email || rememberedPasskeyEmail() || undefined)
  const response = await startAuthentication({ optionsJSON: options })
  return passkeyApi.signInVerify(challengeId, response)
}

// ── "Turn on fingerprint sign-in?" offer after a password sign-in ──
// Remembered per user on this device only (browser storage): whether this
// device already has a passkey, or the user said "not now" recently.
const OFFER_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000
const offerKey = (userId: string) => `dockly.passkeyOffer.${userId}`

function readOffer(userId: string): { state: 'done' | 'snoozed'; at: number } | null {
  try { return JSON.parse(localStorage.getItem(offerKey(userId)) || 'null') } catch { return null }
}
function writeOffer(userId: string, state: 'done' | 'snoozed') {
  try { localStorage.setItem(offerKey(userId), JSON.stringify({ state, at: Date.now() })) } catch { /* storage unavailable */ }
}

const EMAIL_KEY = 'dockly.passkeyEmail'
export function rememberedPasskeyEmail(): string {
  try { return localStorage.getItem(EMAIL_KEY) || '' } catch { return '' }
}

/** This device holds a passkey for the user: never offer again here, and remember the email for sign-in. */
export function markPasskeyOnDevice(user: { id: string; email: string }) {
  writeOffer(user.id, 'done')
  try { localStorage.setItem(EMAIL_KEY, user.email) } catch { /* storage unavailable */ }
}
/** "Not now": ask again in 30 days. */
export const snoozePasskeyOffer = (userId: string) => writeOffer(userId, 'snoozed')

export async function shouldOfferPasskey(userId: string): Promise<boolean> {
  const seen = readOffer(userId)
  if (seen?.state === 'done') return false
  if (seen?.state === 'snoozed' && Date.now() - seen.at < OFFER_SNOOZE_MS) return false
  return deviceHasBiometrics()
}
