/**
 * Passkeys: sign in with the device's fingerprint, face or screen lock.
 * The server issues one-time challenges; the browser does the cryptography.
 */
import { browserSupportsWebAuthn, platformAuthenticatorIsAvailable, startAuthentication, startRegistration, WebAuthnError } from '@simplewebauthn/browser'
import { passkeyApi, type Me, type Passkey } from '@/services'

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

export async function registerPasskey(password: string): Promise<Passkey> {
  const { challengeId, options } = await passkeyApi.registerOptions(password)
  const response = await startRegistration({ optionsJSON: options })
  return passkeyApi.registerVerify(challengeId, response)
}

export async function signInWithPasskey(): Promise<Me> {
  const { challengeId, options } = await passkeyApi.signInOptions()
  const response = await startAuthentication({ optionsJSON: options })
  return passkeyApi.signInVerify(challengeId, response)
}
