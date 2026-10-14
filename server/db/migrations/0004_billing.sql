-- ============================================================
-- 0004 — Subscriptions, usage, payments, funnel analytics
--
-- Additive only. No existing table or row is changed except that every
-- EXISTING workspace gets a subscription row with status 'legacy'
-- (grandfathered: full access, no quotas, never billed). Workspaces created
-- AFTER this migration start a 30-day no-card trial via trigger.
-- ============================================================

-- ── Workspace subscription (1:1 with workspaces) ────────────
CREATE TABLE IF NOT EXISTS public.workspace_subscriptions (
  workspace_id UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('legacy','comped','trialing','expired','active','past_due','suspended','canceled')),
  plan_code TEXT,
  billing_interval TEXT CHECK (billing_interval IN ('month','year')),
  addons JSONB NOT NULL DEFAULT '[]'::jsonb,            -- [{code, qty}]
  period_subtotal INTEGER,                               -- ex-VAT price snapshot of one period (minor units)
  period_lines JSONB,                                    -- the quote lines that make up period_subtotal (renewals charge this snapshot)
  currency TEXT NOT NULL DEFAULT 'ILS',
  catalog_version TEXT,
  trial_started_at TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  canceled_at TIMESTAMPTZ,
  -- Change scheduled for the next renewal (downgrade / interval change / add-on decrease)
  pending_plan_code TEXT,
  pending_interval TEXT CHECK (pending_interval IN ('month','year')),
  pending_addons JSONB,
  -- Dunning
  past_due_since TIMESTAMPTZ,
  grace_ends_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ,
  retry_count INTEGER NOT NULL DEFAULT 0,
  -- Payment method: provider token (encrypted at rest) + display-only card info. Never a card number.
  provider TEXT,
  payment_token_enc TEXT,
  card_brand TEXT,
  card_last4 TEXT CHECK (card_last4 IS NULL OR card_last4 ~ '^[0-9]{4}$'),
  card_exp_month INTEGER,
  card_exp_year INTEGER,
  -- Invoice details
  billing_name TEXT,
  billing_email TEXT,
  billing_tax_id TEXT,
  -- Legacy transition (set by an operator, with notice, when legacy customers move to plans)
  legacy_until TIMESTAMPTZ,
  -- Onboarding: what the workspace said it needs (collect | sign | both)
  interest TEXT,
  trial_reminders_sent JSONB NOT NULL DEFAULT '[]'::jsonb,
  version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ws_subs_period_end ON public.workspace_subscriptions(current_period_end) WHERE status IN ('active','past_due','canceled');
CREATE INDEX IF NOT EXISTS idx_ws_subs_trial_end ON public.workspace_subscriptions(trial_ends_at) WHERE status = 'trialing';

-- Grandfather every workspace that exists right now. Runs BEFORE the trigger
-- below exists, so no existing customer can end up in a trial.
INSERT INTO public.workspace_subscriptions (workspace_id, status)
SELECT id, 'legacy' FROM public.workspaces
ON CONFLICT (workspace_id) DO NOTHING;

-- Every new workspace starts a trial, whatever code path created it.
CREATE OR REPLACE FUNCTION public.start_workspace_trial()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.workspace_subscriptions (workspace_id, status, trial_started_at, trial_ends_at)
  -- Exact 24-hour days: calendar-day arithmetic would shift by an hour across DST changes.
  VALUES (NEW.id, 'trialing', now(), now() + interval '720 hours')
  ON CONFLICT (workspace_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'workspaces_start_trial') THEN
    CREATE TRIGGER workspaces_start_trial AFTER INSERT ON public.workspaces
      FOR EACH ROW EXECUTE FUNCTION public.start_workspace_trial();
  END IF;
END $$;

-- ── Checkout sessions (hosted payment pages) ────────────────
CREATE TABLE IF NOT EXISTS public.checkout_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by UUID,
  kind TEXT NOT NULL CHECK (kind IN ('subscribe','change','pack','payment_method')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed','failed','expired','canceled')),
  selection JSONB NOT NULL,                 -- {planCode, interval, addons} | {packCode}
  quote JSONB NOT NULL,                     -- server-computed lines/subtotal/vat/total
  amount_total INTEGER NOT NULL CHECK (amount_total >= 0),
  currency TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_ref TEXT,                        -- Cardcom LowProfileId
  redirect_url TEXT,                        -- hosted page URL (returned again for a retried click)
  provider_transaction_id TEXT,
  idempotency_key TEXT NOT NULL,
  failure_code TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_checkout_provider_ref ON public.checkout_sessions(provider, provider_ref) WHERE provider_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_checkout_ws ON public.checkout_sessions(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_checkout_open ON public.checkout_sessions(created_at) WHERE status = 'open';

-- ── Invoices (our ledger; the tax document itself is issued by the provider) ──
CREATE SEQUENCE IF NOT EXISTS public.billing_invoice_seq START 1001;
CREATE TABLE IF NOT EXISTS public.billing_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  number TEXT NOT NULL UNIQUE DEFAULT ('DK-' || nextval('public.billing_invoice_seq')::text),
  kind TEXT NOT NULL CHECK (kind IN ('subscription','renewal','proration','pack')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','void','refunded')),
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  lines JSONB NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,       -- {planCode, interval, addons} the invoice pays for
  subtotal INTEGER NOT NULL,
  vat INTEGER NOT NULL,
  total INTEGER NOT NULL CHECK (total >= 0),
  currency TEXT NOT NULL,
  checkout_session_id UUID REFERENCES public.checkout_sessions(id) ON DELETE SET NULL,
  provider TEXT,
  provider_transaction_id TEXT,
  provider_document_number TEXT,
  provider_document_url TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoices_ws ON public.billing_invoices(workspace_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_provider_tx ON public.billing_invoices(provider, provider_transaction_id) WHERE provider_transaction_id IS NOT NULL;
-- One renewal invoice per workspace per period → renewals are idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_renewal_period ON public.billing_invoices(workspace_id, period_start) WHERE kind = 'renewal';

-- ── Provider callbacks: replay protection + audit (sanitised summary only) ──
CREATE TABLE IF NOT EXISTS public.payment_events (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  event_key TEXT NOT NULL,
  workspace_id UUID,
  checkout_session_id UUID,
  kind TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  outcome TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  UNIQUE (provider, event_key)
);

-- ── Metered usage ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.usage_counters (
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  metric TEXT NOT NULL CHECK (metric IN ('requests','envelopes')),
  period_start TIMESTAMPTZ NOT NULL,
  used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, metric, period_start)
);

-- One-time packs: extra quota valid until the end of the period they were bought in.
CREATE TABLE IF NOT EXISTS public.usage_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  metric TEXT NOT NULL CHECK (metric IN ('requests','envelopes')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  valid_from TIMESTAMPTZ NOT NULL,
  valid_until TIMESTAMPTZ NOT NULL,
  invoice_id UUID REFERENCES public.billing_invoices(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_usage_credits_ws ON public.usage_credits(workspace_id, valid_until);
CREATE UNIQUE INDEX IF NOT EXISTS uq_usage_credits_invoice ON public.usage_credits(invoice_id, metric) WHERE invoice_id IS NOT NULL;

-- ── Billing audit trail (append-only) ───────────────────────
CREATE TABLE IF NOT EXISTS public.billing_events (
  id BIGSERIAL PRIMARY KEY,
  workspace_id UUID NOT NULL,
  type TEXT NOT NULL,
  actor TEXT NOT NULL,              -- 'user:<uuid>' | 'system' | 'provider:<name>' | 'operator'
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_billing_events_ws ON public.billing_events(workspace_id, id DESC);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'billing_events_append_only') THEN
    CREATE TRIGGER billing_events_append_only BEFORE UPDATE OR DELETE ON public.billing_events
      FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();
  END IF;
END $$;

-- ── Product funnel (no personal data, no document data) ─────
CREATE TABLE IF NOT EXISTS public.funnel_events (
  id BIGSERIAL PRIMARY KEY,
  event TEXT NOT NULL CHECK (event IN ('landing_visit','pricing_viewed','signup','onboarding_completed','first_request','first_upload_completed','first_signature_completed','trial_to_paid')),
  workspace_id UUID,
  session_id TEXT CHECK (session_id IS NULL OR session_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  props JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Workspace milestones are recorded once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_funnel_ws_event ON public.funnel_events(workspace_id, event) WHERE workspace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_funnel_event_time ON public.funnel_events(event, occurred_at);

-- ── updated_at triggers & deny-by-default RLS (same rule as 0002/0003) ──
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['workspace_subscriptions', 'checkout_sessions', 'billing_invoices'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgrelid = format('public.%I', tbl)::regclass AND tgname = 'set_updated_at'
    ) THEN
      EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();', tbl);
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.workspace_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkout_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funnel_events ENABLE ROW LEVEL SECURITY;
