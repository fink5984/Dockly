-- ============================================================
-- MANUAL, DESTRUCTIVE — not run by the migration runner.
--
-- Drops the legacy plaintext password column once every account has a
-- hash. Run only after:
--   1. migration 0002 is applied and the new server is deployed
--   2. scripts/hash-legacy-passwords.mjs reports "plaintext remaining: 0"
--   3. a database backup exists
-- The guard below aborts if any plaintext password is still present.
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE password <> '') THEN
    RAISE EXCEPTION 'Plaintext passwords still present — run scripts/hash-legacy-passwords.mjs first';
  END IF;
END $$;

ALTER TABLE public.profiles DROP COLUMN IF EXISTS password;
