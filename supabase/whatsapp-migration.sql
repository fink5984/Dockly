-- ============================================================
-- WhatsApp Bot Integration — Additional Tables
-- Run this in the Supabase SQL Editor after schema.sql
-- ============================================================

-- Client upload tokens: secure, time-limited tokens sent via WhatsApp
-- so clients can upload documents without logging in.
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

CREATE INDEX IF NOT EXISTS idx_upload_tokens_token ON public.client_upload_tokens(token);
CREATE INDEX IF NOT EXISTS idx_upload_tokens_case ON public.client_upload_tokens(case_id);

-- WhatsApp message log: track every message sent/received
CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  case_id UUID REFERENCES public.cases(id) ON DELETE SET NULL,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  direction TEXT NOT NULL DEFAULT 'outbound',          -- 'outbound' | 'inbound'
  phone_number TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text',            -- 'text' | 'template' | 'media' | 'document'
  content TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',               -- 'pending' | 'sent' | 'delivered' | 'read' | 'failed'
  wa_message_id TEXT,                                   -- WhatsApp API message ID
  template_name TEXT,
  error_message TEXT,
  metadata JSONB,                                       -- extra data (upload token, document IDs, etc.)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_messages_workspace ON public.whatsapp_messages(workspace_id);
CREATE INDEX IF NOT EXISTS idx_wa_messages_case ON public.whatsapp_messages(case_id);
CREATE INDEX IF NOT EXISTS idx_wa_messages_client ON public.whatsapp_messages(client_id);
CREATE INDEX IF NOT EXISTS idx_wa_messages_created ON public.whatsapp_messages(created_at DESC);

-- Storage policy: allow public uploads for client portal (token-based)
CREATE POLICY "Client portal can upload files" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'documents'
  );
