-- ============================================================
-- 0009 — Passkey failure reports
--
-- Additive only. When a passkey step fails inside the browser (the server
-- never sees a response), the page reports why. Kept 14 days for support;
-- older rows are deleted as new ones arrive.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.passkey_client_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage TEXT NOT NULL CHECK (stage IN ('register','signin')),
  detail TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT '',
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS passkey_client_errors_created_idx ON public.passkey_client_errors (created_at);

ALTER TABLE public.passkey_client_errors ENABLE ROW LEVEL SECURITY;
