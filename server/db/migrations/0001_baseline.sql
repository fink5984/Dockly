-- ============================================================
-- 0001 — Baseline: the production schema as of commit 3219406.
--
-- Reconstructed from supabase/schema.sql, signatures-migration.sql,
-- whatsapp-migration.sql, the ad-hoc supabase/*.mjs scripts and
-- src/lib/database.types.ts.
--
-- Every statement is idempotent, so applying this to the existing
-- production database is a no-op apart from creating any index that
-- is missing. It exists so a fresh database (tests, staging) matches
-- production exactly before the forward migrations run.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  business_type TEXT NOT NULL DEFAULT 'other',
  contact_person TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  logo_url TEXT,
  default_language TEXT NOT NULL DEFAULT 'en',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',
  avatar_url TEXT,
  phone TEXT,
  password TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  company TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  assigned_owner TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.document_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  description TEXT NOT NULL DEFAULT '',
  helper_text TEXT NOT NULL DEFAULT '',
  default_required BOOLEAN NOT NULL DEFAULT false,
  is_required BOOLEAN NOT NULL DEFAULT false,
  allowed_formats TEXT[] NOT NULL DEFAULT '{"pdf","jpg","png"}',
  max_size_mb INTEGER NOT NULL DEFAULT 10,
  status TEXT NOT NULL DEFAULT 'active',
  applicable_case_types TEXT[] NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.document_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  case_type TEXT NOT NULL,
  document_type_ids TEXT[] NOT NULL DEFAULT '{}',
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  case_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  assigned_owner TEXT NOT NULL DEFAULT '',
  deadline TIMESTAMPTZ,
  notes TEXT,
  support_request_id UUID,
  last_activity_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS public_token TEXT UNIQUE;

CREATE TABLE IF NOT EXISTS public.case_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  document_type_id UUID NOT NULL REFERENCES public.document_types(id),
  is_required BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'missing',
  case_notes TEXT,
  notes TEXT,
  file_name TEXT,
  file_type TEXT,
  file_size BIGINT,
  storage_path TEXT,
  storage_status TEXT,
  uploaded_by TEXT,
  uploaded_at TIMESTAMPTZ,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  version_count INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.support_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id),
  subject TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  assigned_staff TEXT,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  issue_description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.support_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.support_requests(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL DEFAULT 'system',
  sender_name TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.support_messages ADD COLUMN IF NOT EXISTS whatsapp_message_id TEXT;

CREATE TABLE IF NOT EXISTS public.activity_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  user_id TEXT NOT NULL DEFAULT '',
  user_name TEXT NOT NULL DEFAULT '',
  client_id TEXT,
  client_name TEXT,
  case_id TEXT,
  document_id TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  read BOOLEAN NOT NULL DEFAULT false,
  action_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.case_type_configs (
  id TEXT PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_he TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT 'FolderOpen',
  color TEXT NOT NULL DEFAULT 'bg-gray-500',
  default_document_type_ids TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.whatsapp_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID UNIQUE NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  is_connected BOOLEAN NOT NULL DEFAULT false,
  phone_number TEXT,
  last_sync TIMESTAMPTZ,
  api_key TEXT,
  connected_at TIMESTAMPTZ,
  messages_sent INTEGER NOT NULL DEFAULT 0,
  messages_received INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.whatsapp_config ADD COLUMN IF NOT EXISTS phone_id TEXT;
ALTER TABLE public.whatsapp_config ADD COLUMN IF NOT EXISTS access_token TEXT;

CREATE TABLE IF NOT EXISTS public.message_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  content_en TEXT NOT NULL DEFAULT '',
  content_he TEXT NOT NULL DEFAULT '',
  variables TEXT[] NOT NULL DEFAULT '{}',
  trigger TEXT NOT NULL DEFAULT '',
  body_template TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  language TEXT NOT NULL DEFAULT 'en',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.automation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  trigger TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  delay TEXT,
  delay_minutes INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.client_upload_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  is_used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  case_id UUID REFERENCES public.cases(id) ON DELETE SET NULL,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  direction TEXT NOT NULL DEFAULT 'outbound',
  phone_number TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text',
  content TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  wa_message_id TEXT,
  template_name TEXT,
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.whatsapp_conversation_state (
  phone_number TEXT PRIMARY KEY,
  case_id UUID NOT NULL,
  client_id UUID,
  workspace_id UUID,
  awaiting_document_id UUID,
  awaiting_document_name TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.whatsapp_conversation_state ADD COLUMN IF NOT EXISTS support_mode BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.whatsapp_conversation_state ADD COLUMN IF NOT EXISTS support_request_id UUID;

CREATE TABLE IF NOT EXISTS public.signature_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  client_id     UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  case_id       UUID REFERENCES public.cases(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  description   TEXT,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('draft','pending','viewed','signed','declined','expired','cancelled')),
  public_token  TEXT NOT NULL UNIQUE,
  document_file_name    TEXT NOT NULL,
  document_storage_path TEXT NOT NULL,
  document_file_type    TEXT NOT NULL DEFAULT 'application/pdf',
  document_file_size    BIGINT NOT NULL DEFAULT 0,
  signed_at           TIMESTAMPTZ,
  signed_ip           TEXT,
  signed_document_path TEXT,
  expires_at          TIMESTAMPTZ,
  created_by          UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.signature_requests ADD COLUMN IF NOT EXISTS canvas_width DOUBLE PRECISION;

CREATE TABLE IF NOT EXISTS public.signature_fields (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  UUID NOT NULL REFERENCES public.signature_requests(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('signature','date','name','text','initials','checkbox')),
  label       TEXT NOT NULL DEFAULT '',
  page        INT NOT NULL DEFAULT 1,
  x           DOUBLE PRECISION NOT NULL DEFAULT 0,
  y           DOUBLE PRECISION NOT NULL DEFAULT 0,
  width       DOUBLE PRECISION NOT NULL DEFAULT 200,
  height      DOUBLE PRECISION NOT NULL DEFAULT 40,
  required    BOOLEAN NOT NULL DEFAULT true,
  value       TEXT,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.signature_fields ADD COLUMN IF NOT EXISTS doc_index INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.signature_documents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id          UUID NOT NULL REFERENCES public.signature_requests(id) ON DELETE CASCADE,
  file_name           TEXT NOT NULL,
  storage_path        TEXT NOT NULL,
  file_type           TEXT NOT NULL DEFAULT 'application/pdf',
  file_size           BIGINT NOT NULL DEFAULT 0,
  sort_order          INT NOT NULL DEFAULT 0,
  signed_storage_path TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Baseline indexes (all present in production scripts)
CREATE INDEX IF NOT EXISTS idx_profiles_workspace ON public.profiles(workspace_id);
CREATE INDEX IF NOT EXISTS idx_clients_workspace ON public.clients(workspace_id);
CREATE INDEX IF NOT EXISTS idx_clients_status ON public.clients(status);
CREATE INDEX IF NOT EXISTS idx_document_types_workspace ON public.document_types(workspace_id);
CREATE INDEX IF NOT EXISTS idx_cases_workspace ON public.cases(workspace_id);
CREATE INDEX IF NOT EXISTS idx_cases_client ON public.cases(client_id);
CREATE INDEX IF NOT EXISTS idx_cases_status ON public.cases(status);
CREATE INDEX IF NOT EXISTS idx_cases_public_token ON public.cases(public_token);
CREATE INDEX IF NOT EXISTS idx_case_documents_case ON public.case_documents(case_id);
CREATE INDEX IF NOT EXISTS idx_case_documents_status ON public.case_documents(status);
CREATE INDEX IF NOT EXISTS idx_support_requests_case ON public.support_requests(case_id);
CREATE INDEX IF NOT EXISTS idx_support_messages_request ON public.support_messages(request_id);
CREATE INDEX IF NOT EXISTS idx_activity_events_workspace ON public.activity_events(workspace_id);
CREATE INDEX IF NOT EXISTS idx_activity_events_created ON public.activity_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON public.notifications(read);
CREATE INDEX IF NOT EXISTS idx_upload_tokens_token ON public.client_upload_tokens(token);
CREATE INDEX IF NOT EXISTS idx_upload_tokens_case ON public.client_upload_tokens(case_id);
CREATE INDEX IF NOT EXISTS idx_wa_messages_workspace ON public.whatsapp_messages(workspace_id);
CREATE INDEX IF NOT EXISTS idx_wa_messages_case ON public.whatsapp_messages(case_id);
CREATE INDEX IF NOT EXISTS idx_wa_messages_client ON public.whatsapp_messages(client_id);
CREATE INDEX IF NOT EXISTS idx_wa_messages_created ON public.whatsapp_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signature_requests_workspace ON public.signature_requests(workspace_id);
CREATE INDEX IF NOT EXISTS idx_signature_requests_client ON public.signature_requests(client_id);
CREATE INDEX IF NOT EXISTS idx_signature_requests_case ON public.signature_requests(case_id);
CREATE INDEX IF NOT EXISTS idx_signature_requests_token ON public.signature_requests(public_token);
CREATE INDEX IF NOT EXISTS idx_signature_requests_status ON public.signature_requests(status);
CREATE INDEX IF NOT EXISTS idx_signature_fields_request ON public.signature_fields(request_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'workspaces', 'profiles', 'clients', 'document_types',
    'cases', 'case_documents', 'whatsapp_config',
    'message_templates', 'automation_rules', 'signature_requests'
  ])
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = format('public.%I', tbl)::regclass
        AND tgname IN ('set_updated_at', 'trg_signature_requests_updated_at')
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();',
        tbl
      );
    END IF;
  END LOOP;
END $$;
