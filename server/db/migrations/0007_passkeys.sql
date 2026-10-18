-- ============================================================
-- 0007 — Passkeys (fingerprint / face / device-lock sign-in)
--
-- Additive only. A user may register WebAuthn credentials on their
-- devices and sign in with them instead of a password. Passwords keep
-- working; removing every passkey returns the account to password-only.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.webauthn_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- base64url credential ID chosen by the authenticator; globally unique.
  credential_id TEXT NOT NULL UNIQUE,
  public_key BYTEA NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  transports TEXT[] NOT NULL DEFAULT '{}',
  -- 'multiDevice' = synced passkey (iCloud / Google), 'singleDevice' = bound to one device.
  device_type TEXT NOT NULL DEFAULT 'singleDevice',
  backed_up BOOLEAN NOT NULL DEFAULT false,
  -- Label shown in settings (derived from the browser at registration).
  name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS webauthn_credentials_user_idx ON public.webauthn_credentials (user_id);

-- One-time challenges for an in-progress registration or sign-in ceremony.
-- Consumed (deleted) on first use; expired rows are swept when new ones are made.
CREATE TABLE IF NOT EXISTS public.webauthn_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('register','signin')),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS webauthn_challenges_expires_idx ON public.webauthn_challenges (expires_at);

ALTER TABLE public.webauthn_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webauthn_challenges ENABLE ROW LEVEL SECURITY;
