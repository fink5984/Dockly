-- ============================================================
-- Migration: Switch from Supabase Auth to custom email/password
-- ============================================================

-- 1. Drop the auto-signup trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- 2. Drop ALL RLS policies (they depend on auth.uid())
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname, tablename, schemaname
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  END LOOP;
END $$;

-- 3. Disable RLS on all public tables
ALTER TABLE public.workspaces DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_types DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_presets DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.cases DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_documents DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_requests DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_events DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_type_configs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_config DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_templates DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_rules DISABLE ROW LEVEL SECURITY;

-- 4. Drop the helper function that used auth.uid()
DROP FUNCTION IF EXISTS public.get_user_workspace_id() CASCADE;

-- 5. Remove the FK from profiles.id → auth.users(id)
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_pkey CASCADE;
ALTER TABLE public.profiles ADD PRIMARY KEY (id);
ALTER TABLE public.profiles ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- 6. Add password column to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS password TEXT NOT NULL DEFAULT '';

-- 7. Add unique constraint on email for login lookups
ALTER TABLE public.profiles ADD CONSTRAINT profiles_email_unique UNIQUE (email);

-- 8. Delete old auth.users data (optional cleanup)
-- DELETE FROM auth.users;

SELECT 'Migration complete: custom auth enabled' AS result;
