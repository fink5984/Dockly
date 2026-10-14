/**
 * Payment provider abstraction.
 *
 * Every provider implements the same contract and returns normalised,
 * sanitised results (amounts in minor units, never raw card data):
 *
 *   createCheckout({ session, customer, lines, language, urls, operation })
 *       → { ref, redirectUrl }
 *     Hosted payment page. `ref` (e.g. Cardcom LowProfileId) is stored on the
 *     checkout session and must match any later callback.
 *
 *   getCheckoutResult(ref)
 *       → { status: 'approved'|'declined'|'pending', ref, returnValue, amount, currency,
 *           transactionId, token?, card?, documentNumber?, documentUrl?, failureCode?, summary }
 *     Authoritative, server-to-server. Callbacks and redirects only tell us
 *     WHEN to call this; they are never trusted for the outcome.
 *
 *   chargeToken({ token, card, amount, currency, idempotencyKey, customer, lines, language })
 *       → { status: 'approved'|'declined'|'error', transactionId?, amount?, documentNumber?, documentUrl?, failureCode?, summary }
 *     'error' means the outcome is UNKNOWN (timeout, 5xx): callers must call
 *     findCharge(idempotencyKey) before retrying with a new key.
 *
 *   findCharge(idempotencyKey) → same shape as chargeToken, or { status: 'not_found' }
 *
 *   listTransactions({ from, to }) → [{ transactionId, amount, currency, createdAt, externalId }]
 *
 *   parseCallback(req) → { ref } | null   (identifies the session only)
 */
import { config } from '../../config.mjs'
import { cardcomProvider } from './cardcom.mjs'
import { sandboxProvider } from './sandbox.mjs'
import { disabledProvider } from './disabled.mjs'

const providers = { cardcom: cardcomProvider, sandbox: sandboxProvider, disabled: disabledProvider }

let override = null

export function getProvider(name = override || config.billing.provider) {
  const p = providers[name]
  if (!p) throw new Error(`Unknown payment provider ${name}`)
  return p
}

/** Tests only: switch the active provider. */
export function __setProvider(name) {
  if (!config.isTest) throw new Error('__setProvider is only available in tests')
  override = name
}

export function providerInfo() {
  const p = getProvider()
  return { name: p.name, live: p.live, available: p.available, sandbox: p.name === 'sandbox' }
}

export { documentLines } from "./util.mjs"
