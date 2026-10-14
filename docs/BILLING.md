# Dockly — Plans, Billing & Payments

How subscriptions work, what is enforced where, how payments are secured, and what's left before real payments go live. For the overall launch status see `COMMERCIAL_LAUNCH_PLAN.md`; for deployment see `UPGRADE_ROADMAP.md`.

## 1. Products, plans and pricing

The catalog lives in **`shared/billing/catalog.json`**. The server bills from it, and the marketing site and billing page render from it, so the three can't drift. Prices are **provisional** (`"provisional": true`), are stored in agorot, and exclude VAT (`vatRate`, currently 18%).

| Plan | Products | Requests/mo | Envelopes/mo | Storage | Seats | ₪/mo ex VAT |
|---|---|---|---|---|---|---|
| `collect_starter` | Collection | 40 | — | 10 GB | 3 | 89 |
| `collect_pro` | Collection | 200 | — | 50 GB | 10 | 229 |
| `sign_starter` | Signatures | — | 25 | 5 GB | 3 | 69 |
| `sign_pro` | Signatures | — | 120 | 25 GB | 10 | 179 |
| `suite_starter` | Both | 40 | 25 | 15 GB | 3 | 129 (saves 29) |
| `suite_pro` | Both | 200 | 120 | 75 GB | 10 | 339 (saves 69) |

- **Yearly** billing costs 10 months' price (`yearlyMonthsCharged`). Quotas stay **monthly**, counted in monthly windows anchored to the subscription start.
- **Recurring add-ons:** `storage_10gb` (₪19/mo each, max 20) and `extra_seat` (₪29/mo each, max 40).
- **One-time packs:** `requests_25` (₪49) and `envelopes_25` (₪59). They're valid until the current monthly window resets and are only sold to active paid plans that include the product.
- **Trial:** 30 days, no card, both products, 25 requests, 10 envelopes, 2 GB, 3 seats.
- **No unlimited plans, and no automatic overage charges.** Going over a limit is refused with a clear message. The customer chooses whether to upgrade or buy a pack.

**Changing prices.** Edit the JSON, bump `version`, then deploy. New checkouts use the new prices. Existing subscriptions renew at their **snapshot** (`period_subtotal` and `period_lines`) until they change plan. The terms promise 30 days' notice before a price change applies to an existing customer.

## 2. Subscription states

```
           signup                   checkout verified
 (new) ───────────▶ trialing ─────────────────────────▶ active ◀──────────────┐
                       │ trial ends                     │  │ renewal declined  │ card updated
                       ▼                                │  ▼                   │ & charged
                    expired ──── checkout ─────────────▶│ past_due ───────────▶┘
                    (read-only)                         │  │ 7-day grace ends
                                                        │  ▼
                       cancel at period end ──▶ canceled  suspended (read-only)
                                               (read-only)
 existing workspaces at migration time: legacy (no limits, never billed)
 operator-granted: comped (plan limits or none, never billed)
```

**Read-only** (`expired`, `suspended`, `canceled`) means:
- Customers can still view, search and download everything.
- Links already sent to clients keep working: clients can still upload, up to the storage limit plus a 10% buffer.
- New requests, new envelopes, staff uploads, outgoing WhatsApp/email messages and automated reminders all stop.

Nothing is ever deleted because of billing state.

Status is evaluated from timestamps on every check (`effectiveStatus`), so enforcement is correct even if the scheduler runs late.

## 3. What is enforced, and where

All checks are server-side in `server/billing/access.mjs`. The UI mirrors them but is never the gate.

| Limit | Enforced in | Behaviour |
|---|---|---|
| Requests/month | `POST /api/requests`, `/duplicate`, inside the create transaction | Atomic counter (`usage_counters`), so concurrent creates can't overshoot, and a failed create gives the unit back. HTTP 402 `quota_exceeded`. |
| Envelopes/month | `POST /api/signatures`, inside the transaction | Same mechanism as requests. |
| Product access | Request/signature creation, signature uploads | 402 `plan_required`. |
| Storage | Every upload (`ingestUpload`, signature uploads) | Staff uploads are blocked at 100%. Client portal and WhatsApp uploads get a 10% buffer, then a polite "contact the business" message. |
| Seats | `POST /api/team/invites` | Active members plus open invitations. 402 `seat_limit_reached`. |
| Read-only | All of the above, `send` endpoints, the messaging layer and the reminder scheduler | 402 `subscription_inactive`. |

**Not yet counted:** signed-PDF copies (they have no size column) and workspace logos. Both are small next to the originals.

## 4. Payments

### Provider abstraction (`server/billing/providers/`)

| Provider | When | Notes |
|---|---|---|
| `cardcom` | `CARDCOM_TERMINAL_NUMBER` and `CARDCOM_API_NAME` are set | Cardcom API v11. Field names follow Cardcom's published OpenAPI spec. |
| `sandbox` | Development and tests by default | A simulated hosted page at `/billing/sandbox/:ref`, labelled everywhere. Refused in production unless `BILLING_SANDBOX_IN_PRODUCTION=true` (staging only). |
| `disabled` | Production without Cardcom credentials | Trials work. Checkout answers `billing_unavailable`, and the UI offers to contact sales. |

### Flow

1. **The owner picks a plan.** The browser sends only `{planCode, interval, addons}` plus an `Idempotency-Key`. The server quotes from the catalog and stores a `checkout_session` with the exact amount.
2. **The server creates the hosted page.** For Cardcom this is `LowProfile/Create` with `Operation=ChargeAndCreateToken`, `ReturnValue=<session id>`, and `Document.Products` that add up exactly to the amount (Cardcom issues the tax invoice). The `WebHookUrl` carries the session id and an HMAC signature.
3. **The card is entered on Cardcom's page.** Card numbers never reach Dockly.
4. **The callback is treated only as a trigger.** The webhook body is never trusted. We check the URL signature and that the reference matches the session. Then we de-duplicate (`payment_events` is unique on `(provider, event_key)`) and fetch the authoritative result server-to-server (`LowProfile/GetLpResult`).
5. **The result is validated before anything is applied:**
   - reference
   - `ReturnValue`
   - terminal
   - status
   - amount and currency against the stored quote
   A mismatch fails the session, records `payment_mismatch` in the audit trail and logs an error. It never activates the subscription.
6. **Applying is once-only:**
   - The session row is locked and moves from `open` to `completed` once.
   - The invoice is unique per provider transaction.
   - The token is stored AES-256-GCM encrypted (`BILLING_ENCRYPTION_KEY`); only brand, last 4 digits and expiry are kept in clear.
7. **The return page asks the server to sync** (which asks the provider) and shows success only after that. **A success redirect alone never activates anything.**
8. **Lost callbacks:** the billing job re-checks open sessions older than 2 minutes.

### Renewals, upgrades, packs

- **Renewals:** the billing job creates one `renewal` invoice per workspace per period (unique index), then charges the token (`Transactions/Transaction`) with `ExternalUniqTranId = dk-<invoice>-<attempt>`. The attempt is marked `unknown_outcome` *before* the call. If the response is lost, the next run looks the charge up (`GetTransactionByExternalUniqTran`) before retrying, so an invoice is never charged twice.
- **Declines:** the subscription moves to `past_due`, with retries on days 1, 3 and 5 and a 7-day grace period, then `suspended`. When the owner updates the card, the outstanding invoice is charged immediately and access is restored.
- **Upgrades** (same interval, higher price) are prorated for the remaining period. They're charged immediately to the card on file, or through the hosted page if there's no card.
- **Downgrades and interval changes** are scheduled for the next renewal.
- **Cancellation** sets `cancel_at_period_end`. It can be resumed until the period ends.

### Remaining trial days

Subscribing during a trial starts the paid period now, but the first period ends at `trial end + interval`. Customers never lose trial days.

## 5. Going live with Cardcom — checklist

The real integration is **blocked on credentials**. The code was written against Cardcom's published v11 spec and unit-tested with responses shaped exactly like it, but it has **not** run against a live terminal.

1. **Terminal setup.** Ask Cardcom for:
   - API access (API name, plus an API password for listing transactions and refunds)
   - **tokenization** (טוקנים)
   - the **documents module**, so tax invoices are issued automatically
   - webhook (Low Profile `WebHookUrl`) support
2. **Staging.** Set:
   - `BILLING_PROVIDER=cardcom`
   - `CARDCOM_TERMINAL_NUMBER`, `CARDCOM_API_NAME`, `CARDCOM_API_PASSWORD`
   - `BILLING_ENCRYPTION_KEY` (≥32 random characters, **kept forever**: losing it means re-collecting every card)
   - `APP_BASE_URL` on a public HTTPS domain, so Cardcom can reach `/api/public/billing/webhook/cardcom`
3. **Verify these assumptions on the Cardcom test terminal**, and adjust `providers/cardcom.mjs` if any differ:
   - `GetLpResult` returns `ResponseCode=0` *and* `TranzactionInfo.ResponseCode=0` for an approved charge, and a non-zero code (no transaction) while the page is still open.
   - `TokenInfo.CardYear` format (2- vs 4-digit); the code accepts both.
   - `CreateTokenOnly` with `JValidateType: 2` and `Amount: 1` validates the card without charging (used for "Update card").
   - Duplicate `ExternalUniqTranId` returns `ResponseCode=6`, and `GetTransactionByExternalUniqTran` finds the original.
   - The sum of `Document.Products[].TotalLineCost` must equal `Amount` (the code guarantees this), and the generated document is a חשבונית מס/קבלה with VAT computed by Cardcom.
   - The webhook arrives as JSON with `LowProfileId`; form-encoded bodies are also accepted.
4. **End-to-end test on staging:** subscribe, renew (`node scripts/billing-admin.mjs tick --yes` after moving `current_period_end` back), decline with a test card, update card, upgrade, buy a pack, cancel. Then run `node scripts/billing-admin.mjs reconcile <from> <to>` and confirm there are no issues.
5. **Production:** set the same variables. `GET /api/billing` shows `provider.live: true`.

**Refunds** aren't automated. Issue them in the Cardcom panel (which also issues the credit document), then mark the invoice `refunded` in the database. `reconcile` reports any `duplicate_payment_needs_refund` events.

## 6. Existing customers (legacy)

Migration `0004` puts every workspace that exists at migration time on `legacy`: full access, no quotas, never billed. Nobody is locked out or charged by the deploy.

When you're ready to move legacy customers onto plans:
1. Email them about the plans **at least 30 days ahead**. Consider offering pilots a comped period: `billing-admin.mjs comp <workspace> suite_pro --yes`.
2. Set the deadline. The script refuses less than 30 days unless you pass `--short-notice`.
   ```
   node scripts/billing-admin.mjs legacy-deadline --all-legacy 2027-01-31 --yes
   ```
3. From then on, those owners see a banner with the date. If they haven't subscribed by the deadline, the workspace becomes read-only, as with an expired trial. Nothing is deleted, and they can subscribe at any time.

## 7. Operations

```
node scripts/billing-admin.mjs status <workspace-id | owner email>   # state, limits, usage, recent billing events
node scripts/billing-admin.mjs list [--status past_due]
node scripts/billing-admin.mjs extend-trial <workspace> 14 --yes
node scripts/billing-admin.mjs comp <workspace> <plan|none> --yes
node scripts/billing-admin.mjs reconcile 2026-11-01 2026-11-30       # exit code 2 if issues
node scripts/billing-admin.mjs tick --yes                            # run the billing job now
node scripts/funnel-report.mjs --days 30
```

- **Audit trail:** every billing change is in `billing_events`, which is append-only (enforced by a trigger).
- **Logs to alert on:** `billing_amount_mismatch`, `billing_result_mismatch`, `billing_duplicate_payment`, `billing_renewal_failed`, `billing_job_failed`, `checkout_create_failed`.
- **Scheduler:** runs every 10 minutes (`BILLING_TICK_INTERVAL_MS`) under its own Postgres advisory lock. It is independent of `AUTOMATION_ENABLED`.

## 8. Funnel analytics

| Event | Recorded by | When |
|---|---|---|
| `landing_visit`, `pricing_viewed` | Browser beacon (`/api/public/events`) | Once per tab session. Skipped when Do Not Track or Global Privacy Control is on. |
| `signup` | Server | Account created. Carries UTM tags, the plan picked and the tab session id. |
| `onboarding_completed` | Server | The workspace gets its business name. |
| `first_request` | Server | First request created. |
| `first_upload_completed` | Server | A **client's** first upload (portal or WhatsApp). |
| `first_signature_completed` | Server | First envelope signed. |
| `trial_to_paid` | Server | Verified first payment after a trial. |

Stored: event, time, workspace id (milestones only), a random tab-scoped session id, and whitelisted properties (`lang`, `device`, `page`, `utm_*`, `plan`, `interval`, `via`, `from`). **Not stored:** IP addresses, user agents, names, emails, phone numbers, file names or document contents.

## 9. Tests

- `server/tests/billing.test.mjs` (28): trial lifecycle, atomic quotas, legacy safety, checkout verification, forged and replayed callbacks, amount mismatch, lost-callback reconciliation, entitlements, renewals, dunning, lost-response idempotency, proration, packs, cancellation, audit trail, funnel privacy.
- `server/tests/billing.unit.test.mjs` (23): catalog invariants (no unlimited plans, tier monotonicity, Suite cheaper), VAT rounding, proration, month arithmetic, status derivation, token encryption, and Cardcom request/response mapping.
- `server/tests/site.test.mjs` (8): marketing routing, legacy URLs, 404s, robots and sitemap.
- `e2e/commercial.spec.ts`: pricing CTA → signup → onboarding → trial banner → billing → sandbox hosted page → verified activation → prorated upgrade; RTL on mobile.
