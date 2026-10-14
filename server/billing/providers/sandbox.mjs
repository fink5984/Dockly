/**
 * SANDBOX payment provider — simulates a hosted payment page and recurring
 * token charges so the full billing lifecycle can be developed, demoed and
 * tested without a real terminal. No money moves and no card is collected.
 *
 * Refused in production by config unless BILLING_SANDBOX_IN_PRODUCTION=true
 * (staging only). The UI labels every sandbox screen as a simulation.
 *
 * Behaves like Cardcom where it matters: the "hosted page" outcome is only
 * observable through getCheckoutResult (server-to-server), callbacks carry
 * just a reference, and token charges are idempotent per key.
 *
 * Test cards (chosen on the sandbox page):
 *   success          approves now and on renewals
 *   decline          declines at checkout
 *   renewal_decline  approves at checkout, declines every later token charge
 */
import { randomBytes } from 'crypto'
import { config } from '../../config.mjs'

const sessions = new Map() // ref → { amount, currency, returnValue, operation, status, token, card, transactionId }
const charges = new Map()  // idempotencyKey → result
let nextChargeOutcome = null

const id = (p) => `${p}_${randomBytes(9).toString('base64url')}`

export const SANDBOX_CARDS = ['success', 'decline', 'renewal_decline']

export const sandboxProvider = {
  name: 'sandbox',
  live: false,
  available: true,

  async createCheckout({ session, operation }) {
    const ref = id('sbxlp')
    sessions.set(ref, {
      amount: operation === 'CreateTokenOnly' ? 0 : session.amount_total,
      currency: session.currency,
      returnValue: session.id,
      operation: operation === 'CreateTokenOnly' ? 'CreateTokenOnly' : 'ChargeAndCreateToken',
      status: 'pending',
    })
    return { ref, redirectUrl: `${config.appBaseUrl}/billing/sandbox/${ref}` }
  },

  async getCheckoutResult(ref) {
    const s = sessions.get(ref)
    if (!s) return { status: 'pending', ref, summary: { unknownRef: true } }
    return {
      status: s.status,
      ref,
      returnValue: s.returnValue,
      operation: s.operation,
      amount: s.operation === 'CreateTokenOnly' ? null : s.amount,
      currency: s.currency,
      transactionId: s.transactionId || null,
      token: s.token || null,
      card: s.card || null,
      documentNumber: s.transactionId ? `SBX-${s.transactionId.slice(-6)}` : null,
      documentUrl: null,
      failureCode: s.status === 'declined' ? 'sandbox_declined' : null,
      summary: { sandbox: true, status: s.status, amount: s.amount },
    }
  },

  async chargeToken({ token, amount, currency, idempotencyKey }) {
    if (charges.has(idempotencyKey)) return charges.get(idempotencyKey)
    let outcome = nextChargeOutcome || (String(token).startsWith('sbx_renewal_decline_') ? 'decline' : 'approve')
    nextChargeOutcome = null
    if (!String(token).startsWith('sbx_')) outcome = 'decline'
    const approved = { status: 'approved', transactionId: id('sbxtx'), amount, currency, documentNumber: null, documentUrl: null, failureCode: null, summary: { sandbox: true } }
    if (outcome === 'timeout') {
      // The charge went through but the response was "lost".
      charges.set(idempotencyKey, approved)
      return { status: 'error', failureCode: 'timeout', summary: { sandbox: true } }
    }
    const result = outcome === 'approve' ? approved : { status: 'declined', failureCode: 'sandbox_declined', summary: { sandbox: true } }
    charges.set(idempotencyKey, result)
    return result
  },

  async findCharge(idempotencyKey) {
    const r = charges.get(idempotencyKey)
    return r && r.status === 'approved' ? r : { status: 'not_found', summary: { sandbox: true } }
  },

  async listTransactions() {
    return [...charges.values()].filter((c) => c.status === 'approved').map((c) => ({ transactionId: c.transactionId, amount: c.amount, currency: c.currency, createdAt: null, isRefund: false }))
  },

  parseCallback(req) {
    const ref = req.body?.ref || req.body?.LowProfileId
    return ref ? { ref: String(ref) } : null
  },
}

/** Public info for the sandbox "hosted page". */
export function sandboxSession(ref) {
  const s = sessions.get(ref)
  return s ? { amount: s.amount, currency: s.currency, operation: s.operation, status: s.status } : null
}

/** The simulated card holder completes (or abandons) the sandbox page. */
export function completeSandboxSession(ref, card) {
  const s = sessions.get(ref)
  if (!s || s.status !== 'pending') return false
  if (card === 'decline') {
    s.status = 'declined'
    return true
  }
  s.status = 'approved'
  s.transactionId = s.operation === 'CreateTokenOnly' ? null : id('sbxtx')
  s.token = `sbx_${card === 'renewal_decline' ? 'renewal_decline' : 'ok'}_${randomBytes(12).toString('hex')}`
  s.card = { last4: card === 'renewal_decline' ? '0002' : '4242', expMonth: 12, expYear: new Date().getUTCFullYear() + 3, brand: 'Sandbox' }
  return true
}

/** Tests only. */
export const sandboxControls = {
  failNextCharge(outcome = 'decline') { nextChargeOutcome = outcome },
  tamper(ref, patch) { Object.assign(sessions.get(ref), patch) },
  reset() { sessions.clear(); charges.clear(); nextChargeOutcome = null },
}
