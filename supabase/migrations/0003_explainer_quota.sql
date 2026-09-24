-- AI explainer quota refunds and an answer cache.
--
-- The Worker reserves one explanation from `usage_daily` before calling the AI
-- provider and refunds it when the provider fails or the request is over a
-- limit, so only delivered answers count. Answers are cached by a SHA-256 hash of
-- the model and the exact sanitized request, so an identical request is answered
-- without calling the provider or using quota.
--
-- Apply after 0001. The Worker keeps working without this migration: refunds and
-- the cache are skipped until it is applied.

CREATE OR REPLACE FUNCTION public.refund_usage_daily(p_subject text, p_day date)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.usage_daily
  SET count = GREATEST(count - 1, 0)
  WHERE subject = p_subject AND day = p_day;
$$;

CREATE TABLE IF NOT EXISTS public.explain_cache (
  context_hash text PRIMARY KEY CHECK (context_hash ~ '^[0-9a-f]{64}$'),
  model text NOT NULL CHECK (length(model) <= 120),
  answer text NOT NULL CHECK (length(answer) <= 8000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS explain_cache_created_idx ON public.explain_cache(created_at);

ALTER TABLE public.explain_cache ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.explain_cache FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.explain_cache TO service_role;

REVOKE ALL ON FUNCTION public.refund_usage_daily(text, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_usage_daily(text, date) TO service_role;
