-- ============================================================
-- 0008 — Passkeys per address
--
-- Additive only. The app is served from more than one address (its own
-- domain and the Railway one) and a passkey only works on the domain it
-- was created on, so each passkey records that domain (its RP ID) for the
-- settings list.
-- ============================================================

ALTER TABLE public.webauthn_credentials ADD COLUMN IF NOT EXISTS rp_id TEXT NOT NULL DEFAULT '';
