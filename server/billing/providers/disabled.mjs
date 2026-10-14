/**
 * No payment provider configured (production default until Cardcom
 * credentials are set). Trials and existing access keep working; anything
 * that would take a payment fails with `billing_unavailable`, and the UI
 * offers to contact sales instead.
 */
import { HttpError } from '../../lib/http.mjs'

const unavailable = () => {
  throw new HttpError(503, 'billing_unavailable', 'Online payment is not available yet. Contact us to upgrade.')
}

export const disabledProvider = {
  name: 'disabled',
  live: false,
  available: false,
  createCheckout: unavailable,
  getCheckoutResult: async (ref) => ({ status: 'pending', ref, summary: { disabled: true } }),
  chargeToken: async () => ({ status: 'error', failureCode: 'billing_unavailable', summary: {} }),
  findCharge: async () => ({ status: 'not_found', summary: {} }),
  listTransactions: async () => null,
  parseCallback: () => null,
}
