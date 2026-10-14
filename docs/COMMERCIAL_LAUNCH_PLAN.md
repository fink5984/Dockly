# Dockly — Commercial Launch: Audit & Implementation Plan

_Branch `feature/commercial-launch`, stacked on `feature/premium-saas-upgrade` (unmerged, undeployed). Date: 2026-10-14._

## 1. Audit — where things stand

**Production (`main`)** is the original app: Supabase-from-the-browser, plaintext passwords, dashboard at `/`. Routes customers have in bookmarks, emails and WhatsApp messages: `/`, `/requests[/:id]`, `/cases[/:id]`, `/clients[/:id]`, `/signatures[/:id]`, `/documents`, `/document-types`, `/whatsapp`, `/settings`, `/activity`, `/onboarding`, `/auth/*`, and the public token links `/p/:token`, `/upload/:token`, `/sign/:token`.

**`feature/premium-saas-upgrade`** (the base of this branch) replaces that with a secure Express API, versioned migrations (`0001`–`0003`), a premium redesigned SPA, and 90 passing unit/integration tests plus 8 E2E tests. Its cut-over plan is in `UPGRADE_ROADMAP.md`. It already maps every legacy URL above.

**Gaps against the commercial brief:**

| Area | State on the base branch |
|---|---|
| Public marketing site | None. `/` is the dashboard; an anonymous visitor is bounced to sign-in. No SEO metadata, no legal pages. |
| Plans, quotas, trials | None ("plans and limits aren't implemented, by design"). Storage usage is only displayed. |
| Payments | None. |
| Funnel analytics | None. |
| Accessibility statement (required for Israeli commercial sites) | None. |

**Constraints found in the code that shape the design:**
- Single Railway instance; the in-process scheduler uses a Postgres advisory lock, so billing jobs can safely share it.
- All tenant data is accessed server-side with explicit `workspace_id` scoping, so entitlement checks can live in one server module.
- Notification `action_url`s already stored in the database use `/requests/:id` style paths, so legacy paths must keep resolving forever.
- The Vite build is a pure SPA. SEO-grade marketing pages need prerendered HTML.

## 2. Architecture decisions

### Routing
- `/` (Hebrew) and `/en` (English) are the **marketing site**, plus `/pricing`, `/privacy`, `/terms`, `/accessibility` (and `/en/...`). They're prerendered to static HTML at build time from React components, ship almost no JS, and carry full metadata, hreflang, JSON-LD, a sitemap and robots.txt.
- The authenticated dashboard moves to **`/app/*`**. A signed-in user who opens `/` is redirected to `/app` by the server, so existing habits keep working.
- Every legacy dashboard path (`/requests/...`, `/clients/...`, `/cases/...`, `/settings/...` and so on) redirects to its `/app/...` equivalent, keeping the rest of the path and the query string. `/p/:token`, `/upload/:token`, `/sign/:token`, `/auth/*` and `/onboarding` are unchanged.

### Billing domain (server-side source of truth)
- **Catalog**: `shared/billing/catalog.json`, versioned. It holds products (Document Collection, E-Signatures), plans per product, a discounted combined Suite plan, monthly/yearly prices, quotas (requests/month, signature envelopes/month, storage, seats), recurring add-ons (storage, seats), one-time packs (requests, envelopes), VAT and trial terms. It's marked `provisional: true`, and the pricing page says so. The marketing build and the server read the same file, so they can't drift. Subscriptions snapshot the price they were bought at.
- **Workspace subscription** (one row per workspace): `trialing → active ⇄ past_due → suspended`, `canceled` (at period end), `expired` (trial ended unpaid), `legacy` (grandfathered), `comped`.
- **Existing customers are not locked out or billed.** The migration puts every existing workspace on `legacy`, with full access and no enforced quotas. Moving them to a plan is a deliberate, documented operator action with notice (`scripts/billing-admin.mjs`). New signups get a 30-day trial with no card and modest trial quotas.
- **Entitlements**, enforced server-side in one module (`server/billing/entitlements.mjs`):
  - Creating requests and signature envelopes counts against the monthly quota (an atomic counter in the same transaction).
  - Uploads are checked against storage (portal uploads get a 10% buffer so a client mid-upload isn't blocked).
  - Invites are checked against seats.
  - Product access is checked (a Collection-only plan can't create envelopes).
  - Read-only states (`expired`, `suspended`, `canceled` after the period) block creation and paid automation, but keep viewing, downloads, exports and already-sent client links working.
- **Usage**: `usage_counters(workspace, metric, period_start)` with an atomic `INSERT … ON CONFLICT … WHERE used < limit`, plus `usage_credits` for packs. The period anchor is the subscription period (or the calendar month for trial/legacy).

### Payments
- `server/billing/providers/` defines one interface: `createCheckout`, `getCheckoutResult`, `chargeToken`, `findChargeByIdempotencyKey`, `listTransactions`. There are three implementations:
  - **cardcom** — Cardcom API v11. Hosted Low Profile page with `ChargeAndCreateToken`; `GetLpResult` as the authoritative result; token charges via `Transactions/Transaction` with `ExternalUniqTranId` as the idempotency key; `GetTransactionByExternalUniqTran` to reconcile lost responses; `ListTransactions` for daily reconciliation; tax invoices issued by Cardcom (`Document`).
  - **sandbox** — a local simulated hosted page, **clearly labelled**, available only outside production (or when explicitly enabled for staging).
  - **disabled** — the production default until Cardcom credentials exist. Checkout returns `billing_unavailable`, and the UI says "contact us to upgrade". Trials keep working. **The real integration is blocked on credentials** (`CARDCOM_TERMINAL_NUMBER`, `CARDCOM_API_NAME`, `CARDCOM_API_PASSWORD`).
- **Webhook handling.** The webhook body is never trusted. Cardcom's webhook isn't signed, so the handler only extracts the `LowProfileId`, which must match a checkout session we created. It then fetches the result server-to-server and validates amount, currency, terminal and `ReturnValue` before applying anything. A unique `(provider, event_key)` row makes replays no-ops. The success redirect only triggers the same server-side fetch; a redirect alone never activates anything.
- **Card data.** The app never sees card numbers. Cardcom tokens are encrypted at rest (AES-256-GCM, `BILLING_ENCRYPTION_KEY`); only brand, last 4 digits and expiry are shown.
- **Renewals and retries.** The scheduler charges the stored token at period end: an invoice row is created first (one per workspace and period) and the charge carries `ExternalUniqTranId = invoice id + attempt`. Failures move the subscription to `past_due` with retries on days 1, 3 and 5. After a 7-day grace period it moves to `suspended` (read-only).
- **Plan changes.** Upgrades are prorated and charged immediately. Downgrades and interval changes are scheduled for period end. Cancelling sets `cancel_at_period_end`, which can be undone until then.

### Funnel analytics (privacy-first)
- Events: `landing_visit`, `pricing_viewed`, `signup`, `onboarding_completed`, `first_request`, `first_upload_completed`, `first_signature_completed`, `trial_to_paid`.
- Product milestones are recorded **server-side** at the moment they happen, once per workspace (unique index). Landing and pricing views are sent with `sendBeacon` and carry only a per-tab random session id (sessionStorage, no cookie), the page language, coarse device class and UTM parameters.
- Nothing is collected when Do Not Track or Global Privacy Control is on. No IP addresses, user agents, emails, names, document data or file names are stored. `scripts/funnel-report.mjs` prints conversion.

## 3. Stages

1. Audit and this plan.
2. Routing split, marketing site (landing, pricing, legal, accessibility), SEO, and trial onboarding.
3. Catalog, migration `0004`, entitlements, usage, enforcement, billing UI, upgrade prompts.
4. Payment-provider abstraction: sandbox, Cardcom, and disabled providers, webhooks, renewals, reconciliation, admin script.
5. Tests (billing math, quotas, trial expiry, entitlements, webhook replay and tampering, renewals, legacy safety, routing, funnel), E2E updates, and docs.

## 4. Out of scope / needs a human

- Final prices: provisional until pilot validation (edit `shared/billing/catalog.json`).
- Cardcom terminal, API credentials, and enabling documents (invoices) on the terminal.
- Legal review of the Terms and Privacy drafts. They're written for Israeli law (Privacy Protection Law and Amendment 13, Consumer Protection Law cancellation rights) but **are not legal advice**.
- Deploy, merge, production migration: awaiting approval.
