/**
 * Cardcom (Israel) — API v11, JSON over HTTPS.
 *
 *   Hosted page:   POST LowProfile/Create        (Operation ChargeAndCreateToken | CreateTokenOnly)
 *   Result:        POST LowProfile/GetLpResult   (authoritative; the webhook only tells us when)
 *   Recurring:     POST Transactions/Transaction (Token + CardExpirationMMYY, ExternalUniqTranId = idempotency key)
 *   Reconcile:     POST Transactions/GetTransactionByExternalUniqTran, Transactions/ListTransactions
 *
 * Field names follow Cardcom's published OpenAPI (secure.cardcom.solutions/swagger/v11).
 * Card numbers never pass through Sadir: the card is entered on Cardcom's page
 * and we only receive a token plus display data (last 4 digits, expiry, brand).
 *
 * STATUS: implemented against the published spec and unit-tested with recorded
 * response shapes; NOT yet exercised against a live terminal (no credentials).
 * See docs/BILLING.md → "Going live with Cardcom".
 */
import { config } from '../../config.mjs'
import { logger } from '../../lib/logger.mjs'
import { itemName } from '../labels.mjs'
import { documentLines } from './util.mjs'

const COIN = { ILS: 1, USD: 2 }
const COIN_NAME = { 1: 'ILS', 2: 'USD' }
const DUPLICATE_EXTERNAL_ID = 6

class CardcomUnavailable extends Error {}

// Injected in tests to replay recorded responses.
let transport = null
export function __setCardcomTransport(fn) {
  if (!config.isTest) throw new Error('test only')
  transport = fn
}

async function call(path, body) {
  const c = config.billing.cardcom
  if (transport) return transport(path, body)
  let res
  try {
    res = await fetch(`${c.baseUrl}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(c.timeoutMs),
    })
  } catch (err) {
    throw new CardcomUnavailable(err?.name === 'TimeoutError' ? 'timeout' : 'network_error')
  }
  if (res.status >= 500) throw new CardcomUnavailable(`http_${res.status}`)
  const data = await res.json().catch(() => null)
  if (!data) throw new CardcomUnavailable('invalid_response')
  return data
}

const auth = () => ({ TerminalNumber: config.billing.cardcom.terminalNumber, ApiName: config.billing.cardcom.apiName })
const toMajor = (minor) => Math.round(minor) / 100
const toMinor = (major) => (typeof major === 'number' ? Math.round(major * 100) : null)
const two = (n) => String(n ?? '').padStart(2, '0').slice(-2)

function cardFrom(tx, tokenInfo) {
  const last4 = tx?.Last4CardDigitsString || (tx?.Last4CardDigits ? String(tx.Last4CardDigits).padStart(4, '0') : null)
  const month = tokenInfo?.CardMonth ?? tx?.CardMonth ?? null
  let year = tokenInfo?.CardYear ?? tx?.CardYear ?? null
  if (year !== null && year < 100) year += 2000
  return { last4: last4 && /^\d{4}$/.test(last4) ? last4 : null, expMonth: month, expYear: year, brand: tx?.Brand ? String(tx.Brand) : null }
}

/** Sanitised fields that are safe to keep for audit (no token, no PII). */
function summarize(r) {
  if (!r) return {}
  const tx = r.TranzactionInfo || r
  return {
    responseCode: r.ResponseCode, description: r.Description?.slice(0, 200), lowProfileId: r.LowProfileId,
    transactionId: r.TranzactionId ?? tx.TranzactionId, txResponseCode: tx?.ResponseCode, amount: tx?.Amount,
    coinId: tx?.CoinId, terminal: r.TerminalNumber ?? tx?.TerminalNumber, operation: r.Operation,
    documentNumber: r.DocumentInfo?.DocumentNumber ?? tx?.DocumentNumber,
  }
}

function documentFor({ customer, lines, total, language, interval }) {
  const c = config.billing.cardcom
  if (!c.issueDocuments) return undefined
  const lang = language === 'en' ? 'en' : 'he'
  return {
    DocumentTypeToCreate: c.documentType,
    Name: customer.name?.slice(0, 100) || customer.email,
    TaxId: customer.taxId || undefined,
    Email: customer.email || undefined,
    IsSendByEmail: Boolean(customer.email),
    Language: lang,
    Products: documentLines(lines, total).map((l) => ({
      ProductID: l.code,
      Description: describe(l, lang, interval),
      Quantity: 1,
      UnitCost: toMajor(l.gross),
      TotalLineCost: toMajor(l.gross),
    })),
  }
}

function describe(l, lang, interval) {
  const name = itemName(l.code, lang)
  const suffix = l.kind === 'plan' || l.kind === 'addon'
    ? ` (${interval === 'year' ? (lang === 'en' ? 'yearly' : 'שנתי') : (lang === 'en' ? 'monthly' : 'חודשי')})`
    : ''
  return `${name}${suffix}${l.qty > 1 ? ` × ${l.qty}` : ''}`
}

function normalizeCharge(tx) {
  if (!tx) return { status: 'error', failureCode: 'invalid_response', summary: {} }
  const approved = tx.ResponseCode === 0 && tx.TranzactionId
  return {
    status: approved ? 'approved' : 'declined',
    transactionId: tx.TranzactionId ? String(tx.TranzactionId) : null,
    amount: toMinor(tx.Amount),
    currency: COIN_NAME[tx.CoinId] || null,
    documentNumber: tx.DocumentNumber ? String(tx.DocumentNumber) : null,
    documentUrl: tx.DocumentUrl || null,
    failureCode: approved ? null : `cardcom_${tx.ResponseCode}`,
    card: cardFrom(tx, null),
    summary: summarize(tx),
  }
}

export const cardcomProvider = {
  name: 'cardcom',
  live: true,
  get available() { return Boolean(config.billing.cardcom.terminalNumber && config.billing.cardcom.apiName) },

  async createCheckout({ session, customer, lines, language, urls, operation, interval }) {
    const tokenOnly = operation === 'CreateTokenOnly'
    const body = {
      ...auth(),
      Operation: tokenOnly ? 'CreateTokenOnly' : 'ChargeAndCreateToken',
      ReturnValue: session.id,
      // J2 validation for card updates: the card is checked, nothing is charged.
      Amount: tokenOnly ? 1 : toMajor(session.amount_total),
      SuccessRedirectUrl: urls.success,
      FailedRedirectUrl: urls.failed,
      CancelRedirectUrl: urls.cancel,
      WebHookUrl: urls.webhook,
      ProductName: tokenOnly ? (language === 'en' ? 'Update payment card' : 'עדכון כרטיס אשראי') : itemName(lines[0]?.code, language),
      Language: language === 'en' ? 'en' : 'he',
      ISOCoinId: COIN[session.currency] || 1,
      UIDefinition: {
        CardOwnerEmailValue: customer.email || undefined,
        CardOwnerNameValue: customer.name || undefined,
        IsHideCardOwnerPhone: true,
      },
      ...(tokenOnly ? { AdvancedDefinition: { JValidateType: 2 } } : { Document: documentFor({ customer, lines, total: session.amount_total, language, interval }) }),
    }
    const r = await call('LowProfile/Create', body).catch((err) => {
      throw Object.assign(new Error('provider_unavailable'), { code: 'provider_unavailable', cause: err })
    })
    if (r.ResponseCode !== 0 || !r.LowProfileId || !r.Url) {
      logger.error('cardcom_create_failed', { summary: summarize(r) })
      throw Object.assign(new Error('provider_rejected'), { code: 'provider_rejected' })
    }
    return { ref: String(r.LowProfileId), redirectUrl: r.Url }
  },

  async getCheckoutResult(ref) {
    const r = await call('LowProfile/GetLpResult', { ...auth(), LowProfileId: ref })
    const tx = r.TranzactionInfo
    const tokenInfo = r.TokenInfo
    const terminalOk = !r.TerminalNumber || Number(r.TerminalNumber) === Number(config.billing.cardcom.terminalNumber)
    let status = 'pending'
    if (r.ResponseCode === 0 && terminalOk) {
      if (r.Operation === 'CreateTokenOnly') status = tokenInfo?.Token ? 'approved' : 'declined'
      else if (tx) status = tx.ResponseCode === 0 && r.TranzactionId ? 'approved' : 'declined'
    } else if (tx && tx.ResponseCode !== 0) {
      status = 'declined'
    }
    return {
      status,
      ref: r.LowProfileId ? String(r.LowProfileId) : ref,
      returnValue: r.ReturnValue || null,
      operation: r.Operation || null,
      amount: tx ? toMinor(tx.Amount) : null,
      currency: tx ? COIN_NAME[tx.CoinId] || null : null,
      transactionId: r.TranzactionId ? String(r.TranzactionId) : null,
      token: tokenInfo?.Token || null,
      card: cardFrom(tx, tokenInfo),
      documentNumber: r.DocumentInfo?.DocumentNumber ? String(r.DocumentInfo.DocumentNumber) : null,
      documentUrl: r.DocumentInfo?.DocumentUrl || tx?.DocumentUrl || null,
      failureCode: status === 'declined' ? `cardcom_${tx?.ResponseCode ?? r.ResponseCode}` : null,
      terminalMismatch: !terminalOk,
      summary: summarize(r),
    }
  },

  async chargeToken({ token, card, amount, currency, idempotencyKey, customer, lines, language, interval }) {
    let tx
    try {
      tx = await call('Transactions/Transaction', {
        ...auth(),
        Amount: toMajor(amount),
        Token: token,
        CardExpirationMMYY: `${two(card.expMonth)}${two(card.expYear)}`,
        ExternalUniqTranId: idempotencyKey,
        ISOCoinId: COIN[currency] || 1,
        Document: documentFor({ customer, lines, total: amount, language, interval }),
      })
    } catch (err) {
      if (err instanceof CardcomUnavailable) return { status: 'error', failureCode: err.message, summary: {} }
      throw err
    }
    if (tx.ResponseCode === DUPLICATE_EXTERNAL_ID) {
      // Already processed under this key (e.g. our previous attempt timed out): look it up.
      return this.findCharge(idempotencyKey)
    }
    return normalizeCharge(tx)
  },

  async findCharge(idempotencyKey) {
    let tx
    try {
      tx = await call('Transactions/GetTransactionByExternalUniqTran', { ...auth(), ExternalUniqTranId: idempotencyKey })
    } catch (err) {
      if (err instanceof CardcomUnavailable) return { status: 'error', failureCode: err.message, summary: {} }
      throw err
    }
    if (!tx || tx.ResponseCode !== 0 || !tx.TranzactionId) return { status: 'not_found', summary: summarize(tx) }
    return normalizeCharge(tx)
  },

  async listTransactions({ from, to }) {
    const c = config.billing.cardcom
    if (!c.apiPassword) return null // reconciliation against Cardcom needs CARDCOM_API_PASSWORD
    const fmt = (d) => `${two(d.getUTCDate())}${two(d.getUTCMonth() + 1)}${d.getUTCFullYear()}`
    const out = []
    for (let page = 1; page <= 20; page++) {
      const r = await call('Transactions/ListTransactions', {
        ApiName: c.apiName, ApiPassword: c.apiPassword, FromDate: fmt(from), ToDate: fmt(to),
        TranStatus: 'Success', Page: page, Page_size: 500, LimitForTerminal: c.terminalNumber,
      })
      if (r.ResponseCode !== 0) throw new Error(`cardcom_list_failed_${r.ResponseCode}`)
      const rows = r.Tranzactions || []
      for (const t of rows) {
        out.push({ transactionId: String(t.TranzactionId), amount: toMinor(t.Amount), currency: COIN_NAME[t.CoinId] || null, createdAt: t.CreateDate, isRefund: Boolean(t.IsRefund) })
      }
      if (rows.length < 500) break
    }
    return out
  },

  /** Cardcom posts the LowProfile result as JSON; we only take the id from it. */
  parseCallback(req) {
    const id = req.body?.LowProfileId || req.body?.lowprofilecode || req.query?.lowprofilecode
    return id ? { ref: String(id) } : null
  },
}
