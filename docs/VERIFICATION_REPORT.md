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
