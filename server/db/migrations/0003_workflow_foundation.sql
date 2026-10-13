-- ============================================================
-- 0003 — Workflow foundation
-- Additive only: new nullable columns, new tables, new indexes.
-- Existing rows keep working without backfill.
-- ============================================================

-- ── Workspaces: branding & automation settings ──────────────
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS brand_color TEXT;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS portal_message TEXT;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS logo_storage_key TEXT;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS automation_settings JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ── Requests (cases) ────────────────────────────────────────
-- `case_type` has always been used as the request title; `title`
-- lets new requests separate the two without migrating old rows.
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS instructions TEXT;          -- client-facing
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS language TEXT;              -- portal language override
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS portal_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS reminders_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS last_reminder_at TIMESTAMPTZ;
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS reminder_count INTEGER NOT NULL DEFAULT 0;

-- ── Request documents ───────────────────────────────────────
-- case_notes = client-facing instruction for this item (existing semantics)
-- notes      = internal note
ALTER TABLE public.case_documents ADD COLUMN IF NOT EXISTS current_file_id UUID;
ALTER TABLE public.case_documents ADD COLUMN IF NOT EXISTS custom_name TEXT;

-- Every uploaded file is kept as an immutable version. The slot
-- (case_documents) points at the current one. Fixes overwrite bug B1.
CREATE TABLE IF NOT EXISTS public.case_document_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  case_document_id UUID NOT NULL REFERENCES public.case_documents(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  sha256 TEXT,
  uploaded_via TEXT NOT NULL DEFAULT 'portal',   -- portal | staff | whatsapp | legacy
  uploaded_by TEXT,
  review_status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | superseded
  review_reason TEXT,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cdf_document ON public.case_document_files(case_document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cdf_workspace ON public.case_document_files(workspace_id, created_at DESC);

-- ── Request templates ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.request_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  default_title TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  due_in_days INTEGER,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{documentTypeId, required, note}]
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_request_templates_ws ON public.request_templates(workspace_id);

-- ── Signatures: integrity & audit ───────────────────────────
ALTER TABLE public.signature_requests ADD COLUMN IF NOT EXISTS signer_name TEXT;
ALTER TABLE public.signature_requests ADD COLUMN IF NOT EXISTS signer_email TEXT;
ALTER TABLE public.signature_requests ADD COLUMN IF NOT EXISTS original_sha256 TEXT;
ALTER TABLE public.signature_requests ADD COLUMN IF NOT EXISTS signed_sha256 TEXT;
ALTER TABLE public.signature_requests ADD COLUMN IF NOT EXISTS consent_text TEXT;
ALTER TABLE public.signature_requests ADD COLUMN IF NOT EXISTS consented_at TIMESTAMPTZ;
ALTER TABLE public.signature_requests ADD COLUMN IF NOT EXISTS signed_user_agent TEXT;
ALTER TABLE public.signature_requests ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMPTZ;
ALTER TABLE public.signature_requests ADD COLUMN IF NOT EXISTS declined_at TIMESTAMPTZ;
ALTER TABLE public.signature_requests ADD COLUMN IF NOT EXISTS decline_reason TEXT;
ALTER TABLE public.signature_requests ADD COLUMN IF NOT EXISTS audit_report_path TEXT;
ALTER TABLE public.signature_requests ADD COLUMN IF NOT EXISTS language TEXT;
ALTER TABLE public.signature_requests ADD COLUMN IF NOT EXISTS last_reminder_at TIMESTAMPTZ;
ALTER TABLE public.signature_requests ADD COLUMN IF NOT EXISTS reminder_count INTEGER NOT NULL DEFAULT 0;
-- Signature requests are archived, never hard-deleted, so the audit trail survives.
ALTER TABLE public.signature_requests ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.signature_documents ADD COLUMN IF NOT EXISTS original_sha256 TEXT;
ALTER TABLE public.signature_documents ADD COLUMN IF NOT EXISTS signed_sha256 TEXT;

-- Append-only event log. UPDATE/DELETE are rejected by trigger so
-- the trail can't be rewritten through the application.
CREATE TABLE IF NOT EXISTS public.signature_events (
  id BIGSERIAL PRIMARY KEY,
  request_id UUID NOT NULL REFERENCES public.signature_requests(id),
  workspace_id UUID NOT NULL,
  event TEXT NOT NULL,           -- created | sent | viewed | consented | signed | declined | cancelled | reminder_sent | completed_pdf | downloaded
  actor TEXT NOT NULL,           -- 'signer' | 'user:<uuid>' | 'system'
  ip TEXT,
  user_agent TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  prev_hash TEXT,
  hash TEXT NOT NULL,            -- sha256(prev_hash || canonical event) → tamper-evident chain
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_signature_events_request ON public.signature_events(request_id, id);

CREATE OR REPLACE FUNCTION public.reject_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'signature_events_append_only') THEN
    CREATE TRIGGER signature_events_append_only
      BEFORE UPDATE OR DELETE ON public.signature_events
      FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();
  END IF;
END $$;

-- ── Outbound message deliveries (WhatsApp / email) ──────────
-- `idempotency_key` makes scheduled sends safe to retry.
CREATE TABLE IF NOT EXISTS public.message_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,                -- whatsapp | email
  kind TEXT NOT NULL,                   -- request_initial | request_reminder | document_rejected | signature_request | signature_reminder | support_reply
  case_id UUID REFERENCES public.cases(id) ON DELETE SET NULL,
  signature_request_id UUID REFERENCES public.signature_requests(id) ON DELETE SET NULL,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  recipient TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', -- queued | accepted | sent | delivered | read | failed | skipped
  provider_message_id TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT UNIQUE,
  triggered_by TEXT NOT NULL DEFAULT 'user', -- user | automation
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deliveries_ws ON public.message_deliveries(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deliveries_case ON public.message_deliveries(case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deliveries_provider ON public.message_deliveries(provider_message_id);
CREATE INDEX IF NOT EXISTS idx_wa_messages_wa_id ON public.whatsapp_messages(wa_message_id);

-- ── Team invites ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workspace_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'member',
  token_hash TEXT NOT NULL UNIQUE,
  invited_by UUID,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invites_ws ON public.workspace_invites(workspace_id);

-- ── Activity: actor type ────────────────────────────────────
ALTER TABLE public.activity_events ADD COLUMN IF NOT EXISTS actor_type TEXT NOT NULL DEFAULT 'user';

-- ── Query-shape indexes ─────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_cases_ws_created ON public.cases(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cases_ws_status ON public.cases(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_case_documents_case_status ON public.case_documents(case_id, status);
CREATE INDEX IF NOT EXISTS idx_activity_ws_created ON public.activity_events(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_case ON public.activity_events(case_id);
CREATE INDEX IF NOT EXISTS idx_activity_client ON public.activity_events(client_id);
CREATE INDEX IF NOT EXISTS idx_signature_requests_ws_created ON public.signature_requests(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON public.notifications(user_id, created_at DESC);

-- New tables follow the same deny-by-default rule as 0002.
ALTER TABLE public.case_document_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signature_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_invites ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['request_templates', 'message_deliveries'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgrelid = format('public.%I', tbl)::regclass AND tgname = 'set_updated_at'
    ) THEN
      EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();', tbl);
    END IF;
  END LOOP;
END $$;
