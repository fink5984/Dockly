-- ============================================================
-- 0005 — Localizable notifications
--
-- Notifications were stored as finished English sentences, so a Hebrew UI
-- still showed English. They now carry a template key + params and the UI
-- renders them in the viewer's language; `title`/`message` stay as the
-- fallback for any template the UI doesn't know.
--
-- Additive: existing rows matching the known English sentences are tagged
-- with the equivalent template so old notifications localize too.
-- ============================================================

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS template TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS params JSONB;

UPDATE public.notifications
   SET template = 'request_completed',
       params = jsonb_build_object('client', (regexp_match(title, '^(.+) submitted every required document$'))[1])
 WHERE template IS NULL AND title ~ '^.+ submitted every required document$';

UPDATE public.notifications
   SET template = 'document_uploaded',
       params = jsonb_build_object('client', m[1], 'document', m[2])
  FROM (SELECT id AS nid, regexp_match(title, '^(.+?) uploaded (.+)$') AS m FROM public.notifications) x
 WHERE x.nid = notifications.id AND template IS NULL AND x.m IS NOT NULL;

UPDATE public.notifications
   SET template = 'signature_signed',
       params = jsonb_build_object('signer', m[1], 'title', m[2])
  FROM (SELECT id AS nid, regexp_match(title, '^(.+?) signed "(.*)"$') AS m FROM public.notifications) x
 WHERE x.nid = notifications.id AND template IS NULL AND x.m IS NOT NULL;

UPDATE public.notifications
   SET template = 'signature_declined',
       params = jsonb_build_object('client', m[1], 'title', m[2])
  FROM (SELECT id AS nid, regexp_match(title, '^(.+?) declined "(.*)"$') AS m FROM public.notifications) x
 WHERE x.nid = notifications.id AND template IS NULL AND x.m IS NOT NULL;

UPDATE public.notifications
   SET template = 'support_message',
       params = jsonb_build_object('client', (regexp_match(title, '^(.*): new support message$'))[1])
 WHERE template IS NULL AND title ~ ': new support message$';
