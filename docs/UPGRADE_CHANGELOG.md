# Dockly — Upgrade Changelog

_Branch `feature/premium-saas-upgrade` · commits after `3219406`_

## Security (breaking: requires migrations + new environment variables)

- Removed direct database access from the browser. New Express API with workspace-scoped queries; Supabase JS client removed from the frontend.
- Hashed passwords (scrypt), signed httpOnly session cookies, revocation, lockout, rate limits, CSRF protection, security headers.
- RLS enabled on all tables with no public policies; public WhatsApp RPC revoked.
- Storage: unauthenticated S3 endpoints removed; tenant-prefixed unique keys; short-lived URLs after ownership checks; upload content validation.
- Public portal and signing endpoints validated server-side; links can be disabled or regenerated.
- WhatsApp webhook signature verification; cross-case ID checks; SSRF guard on media downloads.
- Removed committed credentials (they must still be rotated — see `SECURITY_REVIEW.md`).

## Product

- **Design system:** semantic light/dark tokens; Inter + Heebo typography (Heebo first in Hebrew); accessible dialogs, menus, tabs, tooltips, toasts with undo, data tables with mobile cards, upload zone, skeletons, empty/error states; reduced-motion support.
- **Shell:** grouped collapsible sidebar, mobile drawer, ⌘K/Ctrl+K search, quick-create, live notifications, theme and language menu, skip link, error boundary, route-level code splitting.
- **Dashboard:** real KPIs, a prioritized "Action required" queue (support replies, reviews, overdue, stalled, unsigned, unsent), pipeline, weekly completions chart with an accessible table, onboarding checklist.
- **Requests:** server-filtered, sorted and paginated list with CSV export; 4-step wizard (inline client creation, templates, per-item required/notes, inline document types, instructions, deadline, language, reminders, client preview, send via WhatsApp/email/link); request workspace with **review workflow** (approve, reject with a reason the client sees, undo, reopen), file version history with SHA-256, staff upload on the client's behalf, download-all ZIP, duplicate, save as template, close/reopen, portal link controls, delivery status per message, internal notes and timeline, support chat drawer.
- **Client portal:** branded (logo, color, message, contact details), mobile-first, progress ring, rejected items first with reasons, upload progress with cancel/retry, camera capture, several photos combined into one PDF on the device, honest status that changes only after the server confirms, clear invalid/expired/disabled states, language toggle scoped to the visitor.
- **Signatures:** zoom-independent, touch-friendly field editor (click-to-place, drag, resize, keyboard nudge, duplicate, required toggle) with multi-document support; images converted to PDF; guided signer flow with a sticky progress bar, draw or type signature (corrected pen coordinates), explicit consent, decline with reason, a copy of the signed document; server-side signed PDFs with Hebrew support, document hashes, hash-chained audit trail and a downloadable signing certificate (EN/HE); archive instead of delete.
- **Clients:** list with search, status tabs and stats; profile with requests, documents, signatures, WhatsApp messages and timeline; archive/restore; phone validity hints.
- **Document library:** every received file and signature document with filters (client, source, type, dates) and storage usage.
- **Templates:** request templates (create, edit, duplicate, delete) and six installable starter packs; document type management with format/size rules (archived instead of deleted when in use).
- **Settings:** profile and password, workspace, branding with live preview, team and invites with roles (owner/admin/member/read-only, enforced on the server), automation, integrations status with webhook URL, security (sign out everywhere).
- **Automation:** opt-in reminders for missing documents, deadline reminders, and signature reminders, with quiet hours, non-sending weekdays and time zone; idempotent sends with bounded retries; automatic signature expiry.
- **Messaging:** WhatsApp Cloud API adapter (template contract unchanged) and a Resend email adapter; delivery records with provider status callbacks (sent → delivered → read).
- **i18n:** complete Hebrew and English dictionaries with plural forms (including the Hebrew dual); logical CSS properties throughout; bidi-safe filenames; locale-aware dates, numbers and relative time.

## Engineering

- Versioned SQL migrations with checksums (`server/db/migrations`), baseline reconstructed from the production scripts.
- One source of truth for status rules (`server/domain/requestStatus.mjs`) and the upload pipeline (`server/domain/requests.mjs`).
- Structured, redacting logger; centralized safe error handling; live updates over SSE instead of Supabase Realtime.
- Tests: 87 server unit and integration tests (auth, tenancy, workflow, signatures, webhook, automation), i18n parity and key coverage, 8 Playwright E2E tests.
- Local development: `npm run dev:setup` (isolated Postgres with demo data).
- Removed unused dependencies: framer-motion, recharts, dnd-kit, cva, date-fns, serve, @supabase/supabase-js.

## Known limitations

- Single signer per signature request (multi-signer is next on the roadmap).
- No self-service password reset email yet; the reset page directs users to their admin.
- WhatsApp signature invitations need an approved template (`WA_TEMPLATE_SIGNATURE_REQUEST`); until one exists, use email or the link.
- The WhatsApp bot's in-chat replies remain Hebrew.
- Rate limits and live updates are per-instance (fine for the current single Railway service).
- Electronic signatures are simple e-signatures with an audit trail, not qualified or certified signatures.

---

## Commercial launch (`feature/commercial-launch`)

- **Public website:** prerendered Hebrew (`/`) and English (`/en`) home, pricing, privacy policy, terms, accessibility statement and 404, with real product screenshots, SEO metadata, sitemap and robots. Signed-in users opening `/` go to `/app`.
- **Routing:** the dashboard moved to `/app/*`; every older dashboard URL redirects. Client links (`/p`, `/upload`, `/sign`) are unchanged.
- **Plans:** Document Collection and E-Signatures sold separately or together (Suite, discounted); monthly/yearly; monthly quotas, storage and seats; storage/seat add-ons; one-time request/envelope packs. Pricing is provisional and lives in `shared/billing/catalog.json`.
- **Trials:** 30 days, no card, both products; read-only (never deleted) when it ends; reminders 7/3/1 days before. **Existing workspaces are grandfathered** (`legacy`) — no limits, no charges.
- **Billing page:** usage meters, plan picker with VAT/proration preview, add-ons, packs, payment method, invoice details, invoices and receipts, cancel/resume; upgrade dialog whenever the server refuses an action for plan reasons.
- **Payments:** Cardcom hosted checkout and token renewals behind a provider abstraction; verified server-side results only; idempotent everywhere; dunning with a 7-day grace period; labelled sandbox for development; `disabled` in production until credentials are set.
- **Analytics:** privacy-first funnel events from landing visit to trial-to-paid; `scripts/funnel-report.mjs`.
- **Operations:** `scripts/billing-admin.mjs` (status, list, extend trial, legacy deadline, comp, reconcile, tick).
- **Docs:** `COMMERCIAL_LAUNCH_PLAN.md`, `BILLING.md`, verification addendum.
