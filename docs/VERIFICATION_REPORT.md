# Dockly — Verification Report

_Branch `feature/premium-saas-upgrade` · 2026-10-13 · not merged, not deployed_

## What was verified (and how)

| Check | Result | How |
|---|---|---|
| TypeScript | ✅ passes | `tsc --noEmit` |
| Production build | ✅ passes | `npm run build`; each screen is its own chunk |
| Unit + integration tests | ✅ 90/90 | `npm test`: throwaway database on local Postgres 17 per run |
| Browser E2E | ✅ 8/8 | Playwright + Chrome against the production build on an isolated database |
| Migrations on a production-like DB | ✅ | Original `schema.sql` + scripts + stub Supabase roles, seeded legacy rows; all 3 migrations applied, re-run was a no-op, data intact |
| Anon exposure closed | ✅ | Before: `anon` read plaintext passwords. After: 0 rows; RPC `permission denied` |
| Tenant isolation | ✅ | 404/400 on every cross-workspace read/write/file/attach; no leakage in lists, search, dashboard, library, activity |
| Hebrew in signed PDFs | ✅ | Text extracted from the generated PDF contains the visual-order Hebrew name, the date and the reference stamp |
| Audit chain integrity | ✅ | Chain verifies; `UPDATE`/`DELETE` rejected by trigger |
| Auth without the legacy column | ✅ | Manual drop SQL applied to a scratch DB; signup, sign-in and password change all work |
| Hebrew RTL on mobile | ✅ | E2E: `dir=rtl`, no horizontal overflow at 390 px; screenshots reviewed (portal, signer, dark-mode workspace) |
| English LTR | ✅ | The full E2E journey runs in English |

### Tests by area
- **Server unit (27):** password hashing and legacy upgrade, session signing, tampering and expiry, file-type detection (disguised executables rejected), filename and header sanitization, status rules, review transitions, bidi text layout, PDF rotation mapping, ZIP/CRC, phone normalization, quiet hours.
- **Auth (13):** signup/sign-in/sign-out, generic errors, lockout, legacy password migration, forged cookies, CSRF, session revocation, removed endpoints, security headers, invites, roles, removed members.
- **Tenancy (5)**, **requests workflow (20)**, **signatures (11)**, **WhatsApp webhook (7)**, **automation (4)**.
- **i18n (3):** EN/HE key parity, every literal key exists, plural and dual forms.
- **E2E (8):** signup → onboarding → request with new client → portal upload → reject with reason → replacement → approve → signature request → signing → signed PDF and certificate → activity; invalid links; unauthorized redirects; RTL mobile; reference screenshots.

The E2E run found and fixed: the unsaved-changes guard blocking the post-create redirect, the signer seeing "already signed" instead of a thank-you, labels merging into screen-reader names, and RTL-garbled filenames and sizes.

## What could not be verified

- **Production.** I was not given access to the production database (correctly blocked), so migrations were verified on a production-like reconstruction, not on the real schema. The dry run (`node server/db/migrate.mjs --dry-run`) is the first step of the cut-over.
- **Real WhatsApp delivery.** Ran in log mode; the Cloud API request shape, template contract, signature verification and status callbacks are covered by tests, but no live message was sent.
- **Email delivery.** No Resend key; the adapter correctly reports "not configured".
- **AWS S3.** All tests use the local storage driver. The S3 driver uses the same SDK calls as before, plus `ResponseContentDisposition`/`ResponseContentType` and SSE-S3. Presigned GETs from the in-app PDF viewer need a CORS rule on the bucket.
- **Safari/iOS and Firefox.** Only Chrome was automated; the code avoids engine-specific APIs (pointer events, `accept`/`capture` inputs).
- **Screen-reader walkthrough.** Semantics were checked via Playwright's accessibility snapshot, not with NVDA or VoiceOver.

## Known remaining problems

See "Known limitations" in `UPGRADE_CHANGELOG.md`. Most relevant: single signer only; no email-based password reset; WhatsApp bot copy is Hebrew-only; the main JS chunk is about 145 KB gzipped.

## Required environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Supabase Postgres connection string (**rotated** password) |
| `SESSION_SECRET` | yes | ≥32 random characters |
| `APP_BASE_URL` | yes | Public URL, used in client links |
| `AWS_S3_BUCKET`, `AWS_S3_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | yes | Existing values |
| `WHATSAPP_PHONE_ID`, `WHATSAPP_ACCESS_TOKEN` (rotated) | for WhatsApp | Without them, WhatsApp runs in log mode |
| `WHATSAPP_APP_SECRET` | for WhatsApp | **New**: webhook signature verification |
| `WHATSAPP_VERIFY_TOKEN` | for WhatsApp | New random value; update in Meta |
| `WA_TEMPLATE_*` | for WhatsApp | Existing; optional new `WA_TEMPLATE_SIGNATURE_REQUEST` |
| `RESEND_API_KEY`, `EMAIL_FROM` | optional | Enables email channel and emailed invites |
| `AUTOMATION_ENABLED`, `AUTOMATION_INTERVAL_MS` | optional | Scheduler on by default (5 min); reminders are opt-in per workspace |
| `VITE_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY` | **remove** | No longer used |

## Required database migrations

`server/db/migrations/0001_baseline.sql` (no-op on production), `0002_security_hardening.sql` (RLS lockdown, hashing columns, RPC revoke), `0003_workflow_foundation.sql` (new tables and columns, indexes). Run them with `node server/db/migrate.mjs` right after deploying. Optional and manual: `server/db/manual/drop_plaintext_password.sql`.

## Deployment considerations

Follow the cut-over plan in `UPGRADE_ROADMAP.md`: back up, deploy, migrate, smoke test, hash legacy passwords. Expect brief dashboard downtime between deploy and migration. The Railway start command is unchanged (`npm start`). The repository's `dist/` is built by Railway as before.

---

# Addendum — Commercial launch (`feature/commercial-launch`, 2026-10-14)

## Verified

| Check | Result | How |
|---|---|---|
| TypeScript + production build | ✅ | `npm run build` (tsc, Vite client, Vite SSR, prerender of 12 marketing pages) |
| Unit + integration tests | ✅ 150/150 | `npm test` on a throwaway database (90 existing + 60 new) |
| Browser E2E | ✅ 14/14 | Playwright + Chrome on the production build: the original journey (now through legacy URLs), the full trial → paid funnel, pricing toggles, legal pages, Hebrew RTL on a phone |
| Existing workspaces untouched | ✅ | Migration on a database with pre-existing workspaces → all `legacy`, no limits, no invoices; new workspace → 30-day trial; re-run is a no-op |
| No activation from a redirect | ✅ | Integration test: return page sync before payment leaves the trial unchanged; E2E confirms with the server before showing success |
| Webhook forgery and replay | ✅ | Forged signature, valid signature with unpaid session, foreign reference, 3× replay → one invoice, one event row |
| Price tampering | ✅ | Client-sent amounts ignored; provider amount ≠ quote → session failed, `payment_mismatch` audited, plan unchanged |
| No double charges | ✅ | Lost charge response resolved by lookup (`attempt_count` stays 1); parallel on-demand charges blocked by a unique index; renewal invoice unique per period |
| Quotas under concurrency | ✅ | 3 parallel creates at 24/25 → exactly one succeeds |
| Dunning | ✅ | Decline → `past_due` + 7-day grace → retries → `suspended` (read-only) → card update charges the outstanding invoice → `active` |
| Marketing site quality | ✅ | No console errors, no horizontal overflow at 390 px (HE) and 1440 px; one `h1`; every image has `alt`; ~2 KB JS + 8.4 KB CSS gzipped; correct `lang`/`dir`, canonical, hreflang, JSON-LD (no ratings), robots, sitemap, 404 status |
| Screenshots are real | ✅ | Captured from the running app with fictional data (`e2e/marketing-capture.spec.ts`) |
| Funnel privacy | ✅ | Tests: only whitelisted props stored (an email passed in attribution is dropped); DNT/GPC respected; no IP/user agent columns exist |

## Could not be verified

- **Live Cardcom.** No terminal credentials. The adapter follows Cardcom's published v11 OpenAPI spec and is tested against responses in that shape; the assumptions to confirm on a test terminal are listed in `BILLING.md` §5.
- **Tax documents.** Issued by Cardcom; not exercised.
- **Legal text.** Written to describe the actual system under Israeli law, but **not reviewed by a lawyer**. Set `SITE_LEGAL_NAME` and `SITE_CONTACT_EMAIL` before launch.
- **Screen-reader walkthrough and Safari/Firefox** of the new pages (same caveat as before).

## Security notes for the new surface

- Public endpoints added: `/api/public/billing/catalog` (static), `/api/public/billing/webhook/:provider` (HMAC-signed session id in the URL + reference match + server-to-server fetch; rate-limited), `/api/public/events` (whitelisted, rate-limited, DNT/GPC), `/api/public/site`, and sandbox endpoints that return 404 unless the sandbox provider is active (refused in production by config).
- Billing management is owner-only; admins can view. All state-changing billing calls go through the existing CSRF protection.
- Payment tokens are AES-256-GCM encrypted; card numbers never reach Dockly; logs redact token fields.
- Marketing pages are static; deployment values are HTML-escaped on substitution; JSON-LD escapes `<`.

## New required/optional environment variables

`SITE_LEGAL_NAME`, `SITE_CONTACT_EMAIL` (required before launch, shown on legal pages) · `BILLING_SALES_EMAIL` (optional) · `CARDCOM_TERMINAL_NUMBER`, `CARDCOM_API_NAME`, `CARDCOM_API_PASSWORD`, `BILLING_ENCRYPTION_KEY` (when going live with payments). See `.env.example`.

## Required migration

`0004_billing.sql` — additive; grandfathers every existing workspace as `legacy`.
