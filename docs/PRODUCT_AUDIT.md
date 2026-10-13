# Dockly — Product & Code Audit

_Audit date: 2026-10-13 · Branch: `feature/premium-saas-upgrade` · Baseline commit: `3219406` (+ snapshot of uncommitted WIP in `135fc99`)_

This audit was performed by reading the full repository (frontend, Express server, Supabase scripts, SQL, edge functions) and type-checking the baseline. Production was **not** probed: verifying the data-exposure findings below would have meant reading real customer records and credentials. Every finding here comes from the source code, and the code makes each one unambiguous.

---

## 1. Executive summary

Dockly has a real product core: a working request (case) → client portal → upload flow, a WhatsApp bot that collects documents in-chat, and a PDF signing flow. The UI is reasonably consistent and bilingual.

But **the security model is broken at the foundation**, and that outranks every UX goal:

1. **Every table in the database is readable and writable by anyone on the internet.** Authentication is implemented in the browser by querying `profiles` with the public Supabase anon key. RLS was deliberately disabled on all tables (`supabase/migrate-custom-auth.sql`). The anon key ships in the JS bundle, so anyone can call the Supabase REST API directly.
2. **Passwords are stored in plaintext** (`profiles.password`). Combined with (1), all user emails and passwords can be downloaded with one HTTP request.
3. **Sessions are forgeable.** The "session" is just the profile UUID in `localStorage`; knowing a UUID = being that user.
4. **The file API has no authentication.** `/api/storage/*` will presign, download, list, overwrite or **delete** any S3 object (including `delete-folder` on any prefix) for any caller.
5. **Production credentials are committed to git**: the Postgres connection string with password (≈25 scripts plus a fallback in `server/whatsappBot.mjs`), the Supabase **service-role** key, and a WhatsApp Cloud API access token.
6. **The WhatsApp webhook does not verify Meta's signature**, and the bot trusts document IDs from the payload, so a forged webhook can write files into any workspace's case.
7. **Signed PDFs are generated in the signer's browser** and uploaded by the signer. The business has no integrity guarantee over what was "signed". Hebrew field values can't be encoded with the standard font, so PDF generation fails and the request is still marked `signed` without a signed PDF.

These are fixed first (Phase A), before any visual work.

---

## 2. Architecture as found

| Layer | Implementation | Notes |
|---|---|---|
| Frontend | React 19, Vite 7, Tailwind 4, React Router 7, framer-motion, lucide, recharts, dnd-kit | `recharts` and `dnd-kit` installed but barely/not used |
| Data access | **Browser → Supabase REST (anon key)** for every table | No server authorization layer at all |
| Realtime | Supabase Realtime `postgres_changes` | Only works because RLS is off |
| Auth | Custom, client-side, plaintext password match | No hashing, no server session, no rate limit |
| Server | Express 5 (`server/index.mjs`) | Serves SPA, S3 proxy, WhatsApp webhook/send |
| Storage | AWS S3 via server (recent migration) | Key = `{workspaceName}/{clientName}/documents/{fileName}` |
| DB | Supabase Postgres | Schema drift: real schema is spread across `schema.sql` plus ~10 ad-hoc `.mjs` scripts |
| Edge functions | `supabase/functions/*` | Appear unused (superseded by Express webhook) |
| Tests | **None** | No test runner configured |
| Deploy | Railway, `npm run build && npm start` | |

---

## 3. Feature inventory & status

| Area | Status | Evidence / notes |
|---|---|---|
| Sign up / sign in | ⚠️ Works, insecure | Plaintext, client-side; "Forgot password" button does nothing |
| Onboarding | ✅ Works | Writes workspace directly from browser |
| Dashboard | ⚠️ Partial | `noSubmissionClients`/`partialSubmissionClients` are hard-coded `0`; `support_requests` count filters on a column that table doesn't have |
| Clients list/profile | ✅ Works | Profile "communications" section is "Coming soon" |
| Requests list | ✅ Works | Loads **all** cases with **all** documents for every view; "Export" button is a no-op |
| Request create | ✅ Works | Multi-step page exists; no templates beyond presets; no drafts |
| Request detail | ⚠️ Partial | **Approve / Reject / Request re-upload / Duplicate / Download all are non-functional buttons**. "Mark invalid" deletes the client's file and resets the slot; no reason captured |
| Document review workflow | ❌ Missing | Statuses exist in types, no transitions implemented |
| Public case portal `/p/:token` | ✅ Works, insecure | Reads/writes DB directly from browser; anyone can mark any document uploaded |
| Token upload portal `/upload/:token` | ⚠️ Works | Expiring tokens exist, but validation is client-side only |
| Signatures: create/editor | ✅ Works | Field placement stored in pixels relative to the editor width |
| Signatures: signing | ⚠️ Works, unsafe | PDF generated client-side; Hebrew values break PDF generation; signature pad coordinates drift when the canvas is CSS-scaled; IP never recorded; UI claims "legally binding" |
| Signature audit trail | ❌ Missing | No events, no hashes, no certificate |
| Document library | ❌ Removed | `/documents` redirects to `/requests` |
| Activity | ✅ Works | Logged from the browser (forgeable) |
| WhatsApp bot | ✅ Works | Template sends, interactive list, uploads, support chat |
| WhatsApp delivery status | ❌ Missing | Webhook ignores `statuses` events; every send is logged as `sent` immediately |
| Automation / reminders | ❌ Non-functional | `automation_rules` table + UI list exist; nothing executes them; "Add rule" button is a no-op |
| Team / roles | ❌ Missing | "Invite member" button is a no-op; roles never enforced |
| Notifications | ⚠️ Plumbing only | Table + realtime subscription; nothing ever inserts notifications |
| i18n / RTL | ⚠️ Partial | Good coverage, but physical `left/right` classes, hard-coded Hebrew strings in components, public pages pick language from `navigator.language` only |
| Dark mode | ✅ Works | Token-based; public pages are hard-coded light |

---

## 4. Critical bugs & data-integrity problems

| # | Severity | Problem | Where |
|---|---|---|---|
| B1 | **Critical** | Uploads with the same filename for the same client **overwrite each other in S3** (`{ws}/{client}/documents/{fileName}`); the older DB row then points to the newer file | `server/s3Service.mjs` `buildReadablePath` |
| B2 | **Critical** | Storage keys are based on workspace **name**: two workspaces with the same name share a prefix; renaming orphans paths | same |
| B3 | High | A request is marked `signed` even when the signed PDF failed to generate or upload | `signaturesService.submitPublicSignature` |
| B4 | High | Hebrew text in name/text/date fields can't be encoded with `StandardFonts.Helvetica` → PDF generation throws | `generateSignedPdf` |
| B5 | High | Signature pad: canvas is 460px wide but displayed at 100% width; strokes are recorded in CSS pixels and drawn offset/scaled | `PublicSignaturePage` |
| B6 | High | WhatsApp bot accepts any `case_documents.id` chosen in the list reply without checking it belongs to the conversation's case | `whatsappBot.handleDocumentSelected` |
| B7 | Medium | Case status recalculation is duplicated in 4 places with **different rules** (bot treats only `uploaded` as done; portal treats anything not missing as done) | bot, portal, upload portal, detail page |
| B8 | Medium | Request detail page fetches every case in the workspace to show one | `CaseDetailPage` |
| B9 | Medium | Document preview URLs are keyed by `documentTypeId`; two slots with the same type collide | `CaseDetailPage` |
| B10 | Medium | "Mark invalid" permanently deletes the client's file (destroys evidence) | `CaseDetailPage.handleMarkInvalid` |
| B11 | Medium | Dashboard support count queries `support_requests.workspace_id`, a column that table doesn't have | `settingsService.getDashboardStats` |
| B12 | Low | `uploadBuffer` uses `String.fromCharCode(...uint8)` → stack overflow on large PDFs | `storageService.uploadBuffer` |

---

## 5. Security vulnerabilities

Ranked by exploitability × impact. Details and fixes in `docs/SECURITY_REVIEW.md`.

| ID | Severity | Vulnerability |
|---|---|---|
| S1 | **Critical** | RLS disabled on all tables + anon key in bundle → full cross-tenant read/write/delete of every table |
| S2 | **Critical** | Plaintext passwords, readable via S1 |
| S3 | **Critical** | Forgeable sessions (profile UUID in localStorage) |
| S4 | **Critical** | Unauthenticated S3 API: presign/download/list/upload/delete/delete-folder any key |
| S5 | **Critical** | Secrets committed to git (DB password, service-role key, WhatsApp token); hard-coded DB URL fallback in production code |
| S6 | **Critical** | WhatsApp access token stored in `whatsapp_config.access_token`, readable via S1 |
| S7 | High | `send_whatsapp_document_request` is a `SECURITY DEFINER` function callable through the public RPC endpoint → anyone can send WhatsApp messages at the business's cost |
| S8 | High | Unauthenticated `/api/whatsapp/send`, `/support/reply`, `/support/mark-read` → message spam / impersonation |
| S9 | High | Webhook lacks `X-Hub-Signature-256` verification; default verify token hard-coded |
| S10 | High | Signature signing performed and uploaded by the signer's browser; signature fields/requests updatable by anyone (`USING (true)` policies) |
| S11 | High | Public portals validate tokens client-side and write with the anon key |
| S12 | Medium | No rate limiting anywhere (login brute force, token guessing) |
| S13 | Medium | No security headers (CSP, HSTS, frame-ancestors, nosniff) |
| S14 | Medium | Upload validation is extension-only and client-side; MIME is client-supplied; served back with that MIME |
| S15 | Medium | Error messages from DB/S3 returned verbatim to clients |
| S16 | Low | Legacy Supabase Storage bucket had anon SELECT/INSERT policies (may still contain pre-S3 files) |
| S17 | Low | UI tells signers the signature is "legally binding" — a legal claim the product can't make for a basic e-signature |

---

## 6. UX problems

- **No information hierarchy** on the request detail page: eight equally weighted buttons in the header; the actions that matter (send, review) aren't prominent.
- **Review is impossible**: the business can see a file but can't approve, reject with a reason, or ask for a replacement. Clients never learn *why* something was rejected.
- **Client portal** is a grid of 4:3 tiles, which works poorly on phones (the dominant device for uploads). No upload progress, no cancel/retry, no explanation of why documents are needed, no contact details, no brand color.
- **Language on public pages** is taken from the browser only; a Hebrew business sending to a Hebrew client with an English phone shows English.
- **Signing UI** is a fixed two-column desktop layout (w-72 sidebar) and is unusable on a phone. No guided "next field", no typed signature, no consent step, no decline.
- **Dashboard** shows counts, not tasks. Nothing says "these 3 clients are blocking you".
- **Dead controls** erode trust (see §3).
- **Empty states** are generic; first-run users get zeros.
- Loading states are spinners or nothing; no skeletons; route changes re-fetch everything.

## 7. Architectural weaknesses

- No server-side domain layer: business rules (status transitions, audit) live in React components and are duplicated.
- No schema source of truth; production schema was evolved by one-off scripts that also contain credentials.
- Realtime coupling: every page subscribes to whole tables and refetches whole datasets on any change in any tenant.
- No tests, no CI, no migrations runner.
- Supabase JS client shipped to the browser only to reach the database directly.

## 8. Accessibility & responsiveness

- Modals lack focus trap, `role="dialog"`, `aria-modal`, Escape handling.
- Icon-only buttons lack accessible names in several places.
- Color-only status signaling in document tiles.
- Physical positioning (`left-3`, `right-0`, `ml-64`) is toggled by hand via `isRtl` rather than logical properties.
- Tables are not responsive; signing page and request detail break below ~900px.

## 9. Missing high-value functionality (by business value)

1. Document review workflow (approve / reject with reason / request replacement) — core promise.
2. Automated reminders that actually run, with delivery status.
3. Request templates (accountant, mortgage, legal onboarding…).
4. Branded, mobile-first client portal with reliable uploads.
5. Signature integrity: server-side completion, hashes, audit trail, audit certificate.
6. Document library across requests and signatures.
7. Team members & roles.

---

## 10. Priority classification & implementation sequence

| Priority | Item | Phase |
|---|---|---|
| P0 | Server-side auth (hashed passwords, signed httpOnly sessions), server API with workspace scoping, RLS lockdown migration, authenticated storage, public-token endpoints, webhook signature verification, secret removal | A |
| P0 | Storage key scheme `ws/{workspaceId}/…/{uuid}` (fixes overwrite B1/B2) with legacy-key compatibility | A |
| P0 | Server-side signature completion with Unicode/Hebrew font, hashes, audit events | A/D |
| P1 | Design tokens, components, app shell, dashboard | B |
| P1 | Review workflow, request detail redesign, request wizard with templates | C |
| P1 | Client portal redesign with resilient uploads | C |
| P1 | Signing experience (mobile, guided, typed/drawn signature, consent, decline) | D |
| P2 | Reminders scheduler + delivery status, notification adapters | E |
| P2 | Team members & roles | E |
| P2 | Document library | C |
| P2 | Automated tests: unit, integration (local Postgres), Playwright E2E | F |

### Production rollout constraint

The data-access change and the RLS lockdown **must ship together**: once RLS is enabled, the currently deployed frontend (which talks to Supabase directly) stops working. The rollout plan is in `docs/UPGRADE_ROADMAP.md`. Nothing on this branch has been deployed or applied to the production database.
