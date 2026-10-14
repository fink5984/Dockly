-- ============================================================
-- 0006 — Web push notifications
--
-- Additive only. A user opts in per device (one row per browser push
-- subscription) and chooses, once for all their devices, which events
-- should push. In-app notifications are unchanged.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- The push service URL is unique per browser install; a device that signs
  -- in as another user takes the row over instead of pushing to both.
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  -- UI language on that device when it subscribed (push text is rendered server-side).
  language TEXT NOT NULL DEFAULT 'he' CHECK (language IN ('he','en')),
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_success_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON public.push_subscriptions (user_id);

-- Events that push for this user. Defaults to everything; the in-app bell always shows all.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS push_events TEXT[] NOT NULL
  DEFAULT ARRAY['document_uploaded','request_completed','signature_signed','signature_declined','support_message','billing'];
