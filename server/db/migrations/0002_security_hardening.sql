-- ============================================================
-- 0002 — Security hardening
--
-- After this migration the browser no longer talks to Postgres.
-- All access goes through the Express API, which connects as the
-- table owner (bypasses RLS) and enforces workspace scoping itself.
--
-- RLS is enabled on every public table with NO policies, which
-- denies all access to the `anon` and `authenticated` roles used by
-- Supabase's public REST/Realtime endpoints. This closes the
-- cross-tenant read/write hole (audit S1, S2, S6, S10, S11).
--
-- ⚠ Deploy together with the new server + frontend: the old
-- frontend reads tables with the anon key and stops working once
-- this is applied. See docs/UPGRADE_ROADMAP.md → "Cut-over".
--
-- Non-destructive: no rows or columns are removed. The plaintext
-- `profiles.password` column is emptied lazily on each user's next
-- login (and by scripts/hash-legacy-passwords.mjs); dropping it is
-- a separate, manual step (server/db/manual/drop_plaintext_password.sql).
-- ============================================================

-- ── Credentials & sessions ──────────────────────────────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS failed_login_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- Case-insensitive login lookups
CREATE INDEX IF NOT EXISTS idx_profiles_email_lower ON public.profiles (lower(email));

-- ── Row Level Security: deny-by-default for public API roles ─
DO $$
DECLARE
  pol RECORD;
  tbl RECORD;
BEGIN
  -- Remove every existing policy on public tables. Several of them
  -- were `USING (true)` (e.g. "Public can update by token").
  FOR pol IN
    SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
  END LOOP;

  FOR tbl IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl.relname);
  END LOOP;
END $$;

-- ── Public RPC: the SECURITY DEFINER WhatsApp sender ─────────
-- Callable by anyone through /rest/v1/rpc → message spam (S7).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'send_whatsapp_document_request'
  ) THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.send_whatsapp_document_request(uuid, uuid, uuid, text, text, text, integer, text) FROM PUBLIC';
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE ALL ON FUNCTION public.send_whatsapp_document_request(uuid, uuid, uuid, text, text, text, integer, text) FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE 'REVOKE ALL ON FUNCTION public.send_whatsapp_document_request(uuid, uuid, uuid, text, text, text, integer, text) FROM authenticated';
    END IF;
  END IF;
END $$;

-- ── Legacy Supabase Storage bucket ──────────────────────────
-- Files moved to S3; the old bucket had anon read/insert policies (S16).
-- Dropping policies removes access, not files.
DO $$
DECLARE
  pol RECORD;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage')
     AND EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'storage' AND c.relname = 'objects') THEN
    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
        AND policyname IN (
          'Workspace members can upload files',
          'Workspace members can view files',
          'Workspace members can update files',
          'Workspace members can delete files',
          'Client portal can upload files',
          'Allow anon select for signed urls'
        )
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.policyname);
    END LOOP;
  END IF;
END $$;
