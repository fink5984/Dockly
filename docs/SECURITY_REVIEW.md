# Dockly — Security Review

_Branch `feature/premium-saas-upgrade` · 2026-10-13_

This review covers the application as found on `main` (commit `3219406`) and the remediation on this branch. It contains no secrets. Findings are referenced by ID from `docs/PRODUCT_AUDIT.md`.

---

## 1. Summary

| | Before | After (this branch) |
|---|---|---|
| Data access | Browser → Supabase REST with the public anon key; RLS disabled on every table | Browser → Express API only; every query scoped by the session's workspace; RLS enabled with no policies (anon/authenticated denied) |
| Passwords | Plaintext in `profiles.password`, readable by anyone | scrypt hashes; legacy plaintext upgraded on login or by script; column can be dropped |
| Sessions | Profile UUID in `localStorage` | HMAC-signed, httpOnly, SameSite=Lax cookie with expiry and server-side revocation |
| Files | Unauthenticated presign/download/list/delete API | Short-lived URLs issued only after an ownership check; no list/delete endpoints exposed |
| Public links | Validated in the browser; anon writes | Validated on the server; 256-bit tokens; regenerate/disable; rate-limited |
| Signatures | Signed PDF generated and uploaded by the signer's browser | Generated on the server; SHA-256 of original and signed files; hash-chained append-only audit log |
| WhatsApp webhook | No signature check; trusted IDs from payload | `X-Hub-Signature-256` verified (fails closed); case/document ownership checked |
| Secrets | DB password, service-role key and WhatsApp token committed to git | Removed from the tree; config validated at startup; **rotation still required** (§4) |

## 2. Findings and remediation

### Critical

**S1 — Cross-tenant read/write of every table.** Authentication was done in the browser by querying `profiles` with the anon key, so RLS had been disabled everywhere. Anyone holding the (public) anon key could read, modify or delete any workspace's clients, cases, documents, signatures and WhatsApp messages.
*Fix:* All data access moved to the server (`server/routes/*`), which connects as the table owner and filters every query by `req.user.workspaceId`. Migration `0002_security_hardening.sql` enables RLS on all public tables and drops every existing policy (including several `USING (true)` policies), so the anon and authenticated roles get nothing. Verified on a production-like database: before the migration, the `anon` role could read plaintext passwords; afterwards it sees zero rows (§5).

**S2 — Plaintext passwords.** *Fix:* scrypt (N=16384, r=8, p=1, 16-byte salt) in `server/lib/passwords.mjs`. Legacy rows are verified once in constant time, re-hashed, and the plaintext cleared. `scripts/hash-legacy-passwords.mjs` hashes all remaining rows at once; `server/db/manual/drop_plaintext_password.sql` removes the column (guarded; manual).

**S3 — Forgeable sessions.** *Fix:* `server/lib/session.mjs` signs `{sub, ws, sv, iat, exp}` with HMAC-SHA256. Cookie is `HttpOnly; SameSite=Lax; Secure` in production. `profiles.session_version` revokes all sessions on password change, "sign out everywhere", or member removal. Tested: tampered cookies and raw UUIDs are rejected.

**S4 — Unauthenticated storage API.** The old `/api/storage/*` routes would presign, download, list, overwrite or delete any S3 key, including recursive `delete-folder`. *Fix:* routes removed (they return 404). Files are reachable only through entity endpoints that check workspace ownership (`/api/requests/:id/documents/:docId/file`, `/api/signatures/:id/file`, public token endpoints), and return URLs that expire after 2–10 minutes. New keys are `ws/{workspaceId}/…/{uuid}-{slug}`, so names can't collide or cross tenants (also fixes overwrite bug B1/B2).

**S5 — Secrets in git.** About 25 scripts and the production server contained the Postgres connection string with its password; scripts also contained the Supabase service-role key and a WhatsApp access token. *Fix:* those files were removed and the hard-coded fallback deleted. `server/config.mjs` requires `DATABASE_URL` and `SESSION_SECRET` in production. **History still contains them, so they must be rotated (§4).**

**S6 — WhatsApp token readable via S1.** `whatsapp_config.access_token` is now protected by RLS. The token should still be rotated, and the column should eventually be cleared (the server reads the token from the environment).

### High

**S7 — Public RPC `send_whatsapp_document_request`** (`SECURITY DEFINER`, callable through `/rest/v1/rpc`). *Fix:* `EXECUTE` revoked from `PUBLIC`, `anon` and `authenticated` in 0002 (verified: permission denied).

**S8 — Unauthenticated send/reply endpoints.** *Fix:* replaced by authenticated, workspace-scoped, rate-limited routes (`POST /api/requests/:id/send`, `/api/support/:id/reply`).

**S9 — Webhook authenticity.** *Fix:* `X-Hub-Signature-256` is verified against `WHATSAPP_APP_SECRET` over the raw body using a constant-time comparison. Without the secret, inbound webhooks are rejected. The transitional escape hatch `WHATSAPP_ALLOW_UNSIGNED_WEBHOOKS=true` exists and logs loudly; don't use it in steady state. The verify token no longer has a hard-coded default. Button payload case IDs and list-reply document IDs are checked against the sender's conversation, which fixes B6.

**S10 — Client-side signing.** *Fix:* `server/signing/service.mjs` validates every submitted field against the request (type, length, PNG data URL format, required fields), requires explicit consent and a name, generates the signed PDF on the server, stores it under a new key (the original is never overwritten), and records SHA-256 hashes. If the original file changed after sending, signing is refused. Events go to `signature_events`, where each row hashes the previous row; a trigger rejects `UPDATE`/`DELETE`; `GET /api/signatures/:id/events` re-verifies the chain.

**S11 — Public portals.** *Fix:* `server/routes/public.mjs`. Tokens are validated server-side, unknown tokens get a uniform 404, disabled links get 410, and responses include only client-facing fields (no internal notes, storage keys, or IDs of other records). Uploads can only target documents of the token's own request. Tests verify this.

### Medium / Low

| ID | Fix |
|---|---|
| S12 Rate limiting | Per-IP and per-account limits on sign-in (plus account lockout after 8 failures for 15 min), signup, invites, password change, public portal/sign views, uploads and submissions. In-memory, which is correct for the single Railway instance; move to a shared store if scaled out. |
| S13 Headers | CSP (`script-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`), HSTS (prod), `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin` (stops portal tokens leaking via Referer), COOP, Permissions-Policy. |
| S14 Uploads | Type is detected from file content (magic bytes), not the client MIME or extension, and must match the document's allowed formats; size caps per document type (≤25 MB); display names sanitized (path components, control and bidi-override characters removed); stored with the detected MIME; `Content-Disposition` uses RFC 6266 encoding. |
| S15 Error leakage | Central error handler returns safe messages only; internals go to structured logs with sensitive keys redacted. |
| S16 Legacy Supabase bucket | Anon policies on `storage.objects` dropped in 0002. Old files may still exist in that bucket; review and delete them once confirmed migrated. |
| S17 Legal claim | "Legally binding" wording removed; the UI and signing certificate describe a simple electronic signature and state what it is not. |
| CSRF | Cookie-authenticated writes require `X-Requested-With: dockly` (needs a CORS preflight the server never grants) and, when present, a same-site `Origin`. |
| SSRF | WhatsApp media downloads are allowed only from Meta CDN hosts. |

## 3. Tenant isolation verification

`server/tests/tenancy.test.mjs` creates two workspaces and asserts workspace B gets 404/400 for every read, write, file URL, download-all, certificate and attach attempt against workspace A's records, and that A's data never appears in B's lists, search, dashboard, activity or document library. Anonymous callers get 401 on the private API. All pass.

## 4. Required manual actions (cannot be done from code)

1. **Rotate the Supabase database password** (Project Settings → Database). It's in git history. Set the new `DATABASE_URL` in Railway.
2. **Rotate the Supabase service-role key** (Settings → API). The new server doesn't use it; remove `SUPABASE_SERVICE_ROLE_KEY` from all environments afterwards.
3. **Rotate the WhatsApp Cloud API access token** (Meta Business → System users) and update `WHATSAPP_ACCESS_TOKEN`. Then clear the old copy: `UPDATE whatsapp_config SET access_token = NULL, api_key = NULL;`
4. **Set `WHATSAPP_APP_SECRET`** (Meta App → Settings → Basic → App secret) and a new random `WHATSAPP_VERIFY_TOKEN`; update the webhook verify token in Meta.
5. **Set `SESSION_SECRET`** (≥32 random characters) in Railway.
6. Consider making the GitHub repository private if it's public, and purging history with `git filter-repo` after rotation. Rotation is what actually protects you; purging only reduces exposure.
7. **S3 bucket:** keep it private with Block Public Access on, and allow `GET` CORS from the app origin (the in-app PDF viewer fetches presigned URLs).
8. After cut-over, run `scripts/hash-legacy-passwords.mjs`, then (optionally) `server/db/manual/drop_plaintext_password.sql`.

## 5. Evidence

- Production-like database (original scripts applied, stub Supabase roles): before migration, `SET ROLE anon; SELECT email, password FROM profiles` returned the seeded plaintext password; after it, `count = 0`, and calling the RPC raised `permission denied`. Owner access and row counts were unchanged; re-running the migration was a no-op.
- 90 unit/integration tests and 8 browser E2E tests pass (`docs/VERIFICATION_REPORT.md`).

## 6. Residual risks and limits

- **Permanent portal links are bearer secrets.** Anyone with the link can upload to that request and view what was uploaded through it. Mitigations: 256-bit tokens, `Referrer-Policy`, rate limits, one-click disable/regenerate. Consider adding per-link expiry or a client OTP for sensitive workspaces.
- **Simple electronic signature only.** Identity is not verified beyond possession of the link. For higher assurance, add OTP-to-phone, ID verification, or a qualified trust-service provider; that's a separate product decision.
- In-memory rate limits and SSE assume a single instance.
- Supabase Realtime is no longer used; tables can be removed from the `supabase_realtime` publication.
- The legacy `supabase/functions/*` edge functions appear unused. Delete them in Supabase if confirmed.
