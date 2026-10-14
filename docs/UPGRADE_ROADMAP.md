# Dockly — Upgrade Roadmap & Cut-over Plan

_Branches `feature/premium-saas-upgrade` → `feature/commercial-launch` (stacked). Nothing has been merged or deployed._

## Phase status

| Phase | Scope | Status |
|---|---|---|
| A — Audit & foundation | Audit, server API, auth, RLS lockdown, storage authz, migrations runner, test harness | ✅ Done |
| B — Premium UI | Tokens, typography, components, shell, dashboard, light/dark, RTL/LTR | ✅ Done |
| C — Core workflows | Requests list/wizard/workspace, review workflow, versions, client portal, clients, document library | ✅ Done |
| D — Signatures | Field editor, signer experience, server-side completion, hashes, audit trail, certificate | ✅ Done (single signer — see "Next") |
| E — Automation & collaboration | Reminder scheduler, delivery status, email adapter, templates, team & roles, invites | ✅ Done |
| F — Security, performance, QA | Hardening, route splitting, 90 unit/integration + 8 E2E tests, a11y fixes | ✅ Done |
| G — Production readiness | Docs, migration checks, cut-over plan | ✅ Docs done · ⏳ cut-over awaits your go-ahead |
| H — Commercial launch | Marketing site (HE/EN), /app routing, plans & trials, entitlements, billing UI, Cardcom/sandbox payments, funnel analytics | ✅ Done on `feature/commercial-launch` · ⏳ live Cardcom blocked on credentials — see `COMMERCIAL_LAUNCH_PLAN.md`, `BILLING.md` |

## Cut-over plan (production)

The new server and the RLS migration **must go live together**. The old frontend reads the database with the anon key and breaks once RLS is enabled, while the new frontend needs the new tables and columns. Expect a few minutes of downtime for the dashboard. The Railway WhatsApp bot keeps working throughout, because it connects as the database owner.

**Before (no downtime)**
1. Rotate secrets and set Railway variables (see `SECURITY_REVIEW.md` §4): `DATABASE_URL` (new password), `SESSION_SECRET`, `APP_BASE_URL`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, existing `AWS_*` and `WHATSAPP_*`/`WA_TEMPLATE_*`. Optional: `RESEND_API_KEY`, `EMAIL_FROM`. **Commercial launch:** `SITE_LEGAL_NAME`, `SITE_CONTACT_EMAIL` (shown on the legal pages), `BILLING_SALES_EMAIL`; Cardcom variables only when going live with payments (`BILLING.md` §5) — without them billing runs as `disabled` (trials work, no checkout).
2. In Meta, set the webhook verify token to the new value. (The new server needs `WHATSAPP_APP_SECRET` to accept webhooks.)
3. Add a GET CORS rule on the S3 bucket for the app origin.
4. Back up the database: `pg_dump "$DATABASE_URL" --format=custom --schema=public --no-owner -f before-upgrade.dump`.
5. `node server/db/migrate.mjs --dry-run`. Expect `0001`–`0004` pending.

**Cut-over (~5 minutes)**
6. Merge the branch and deploy to Railway (build: `npm ci && npm run build`, start: `npm start`).
7. Immediately run `node server/db/migrate.mjs`. 0001 is a no-op on production; 0002 locks the database down; 0003 adds the new tables and columns; 0004 adds billing tables and puts **every existing workspace on `legacy`** (no limits, never billed) — new signups get a 30-day trial.
8. Smoke test: `/api/health` returns `db: ok`; `/` shows the Hebrew site and `/en` the English one; staff sign-in lands on `/app`; an old bookmark such as `/requests/<id>` redirects to `/app/requests/<id>`; an existing request opens, its portal link (`/p/…`) loads, a file preview opens (exercises a legacy storage key); a WhatsApp test message is sent and its status updates; `node scripts/billing-admin.mjs list` shows existing workspaces as `legacy`.
9. Run `node scripts/hash-legacy-passwords.mjs` to remove remaining plaintext passwords.

**Rollback**
- Code: redeploy the previous Railway deployment.
- Database: re-allow the old frontend temporarily. This re-opens the exposure, so treat it as an emergency measure only:
  ```sql
  DO $$ DECLARE t text; BEGIN FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t); END LOOP; END $$;
  ```
  0001, 0003 and 0004 are additive, and the old code ignores the new tables and columns.
- Caveat: users who signed in on the new version have hashed passwords and can't log into the old version.

**After**
10. Enable reminders per workspace (Settings → Automation). They're off by default, so existing customers don't start getting messages unexpectedly.
11. Optionally drop the plaintext column: `psql "$DATABASE_URL" -f server/db/manual/drop_plaintext_password.sql`.
12. Clean up the legacy Supabase Storage bucket and the unused edge functions; remove `SUPABASE_SERVICE_ROLE_KEY` and `VITE_SUPABASE_*` from all environments.

## Local development

```bash
npm install
npm run dev:setup      # private Postgres in .data/pg, migrations, demo data, .env.local
npm run dev:server     # API on :3101 (reads .env.local first)
npm run dev            # Vite on :5173, proxies /api to :3101
# sign in: demo@dockly.local / dockly-demo-123
```
Tests: `npm test` (unit and integration; needs the local Postgres), `npm run build && PLAYWRIGHT_CHROME_PATH="…/chrome.exe" npm run test:e2e`.

## Next (prioritized)

1. **Multiple signers with signing order.** Add a `signature_recipients` table, field assignment per recipient, sequential/parallel routing, and per-recipient tokens and events. The audit model already supports multiple actors.
2. **Self-service password reset by email.** Needs an email provider (Resend adapter exists). Reset tokens would be hashed like invites.
3. **Stronger signer assurance.** Optional SMS/WhatsApp OTP before signing, recorded in the audit trail.
4. **Portal link hardening.** Optional per-link expiry and per-client OTP for sensitive workspaces.
5. **Combined workflows.** A request that includes both document collection and signature steps. The data model can reference `signature_requests.case_id`; the UI is still separate.
6. **Scale-out readiness.** Shared rate-limit store and pub/sub for SSE before running more than one instance.
7. **List virtualization.** For workspaces with thousands of requests: server pagination exists; clients and documents lists are capped at 1000/500 rows client-side.
8. **Per-language dictionary chunks.** Saves about 20 KB gzipped on first load.
9. **WhatsApp bot copy in English.** The in-chat bot replies are still Hebrew-only.
10. ~~Billing/usage~~ — done on `feature/commercial-launch` (plans, trials, quotas, payments).
11. **Commercial follow-ups:** live Cardcom verification (`BILLING.md` §5); legacy-customer transition with notice (§6); automated refunds; usage alerts by email at 80%/100%; per-workspace WhatsApp sender numbers.
