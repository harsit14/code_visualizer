CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  stripe_customer_id text UNIQUE,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS public.sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON public.sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON public.sessions(expires_at);

CREATE TABLE IF NOT EXISTS public.subscriptions (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  stripe_customer_id text,
  stripe_subscription_id text,
  status text NOT NULL,
  price_id text,
  current_period_end timestamptz,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS subscriptions_customer_idx
  ON public.subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS subscriptions_status_idx ON public.subscriptions(status);

CREATE TABLE IF NOT EXISTS public.usage_daily (
  subject text NOT NULL,
  day date NOT NULL,
  plan text NOT NULL,
  count integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (subject, day)
);

CREATE INDEX IF NOT EXISTS usage_daily_day_idx ON public.usage_daily(day);

CREATE TABLE IF NOT EXISTS public.billing_events (
  id text PRIMARY KEY,
  type text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS public.code_history (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  language text NOT NULL CHECK (language IN ('python', 'javascript', 'typescript')),
  code text NOT NULL,
  inputs_json text,
  function_name text,
  seed integer,
  example_id text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  last_run_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS code_history_user_last_run_idx
  ON public.code_history(user_id, last_run_at DESC);

CREATE OR REPLACE FUNCTION public.increment_usage_daily(
  p_subject text,
  p_day date,
  p_plan text,
  p_updated_at timestamptz
)
RETURNS TABLE(new_count integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.usage_daily AS target (subject, day, plan, count, updated_at)
  VALUES (p_subject, p_day, p_plan, 1, p_updated_at)
  ON CONFLICT (subject, day)
  DO UPDATE SET
    count = target.count + 1,
    plan = EXCLUDED.plan,
    updated_at = EXCLUDED.updated_at
  RETURNING target.count AS new_count;
$$;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.code_history ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.users FROM anon, authenticated;
REVOKE ALL ON TABLE public.sessions FROM anon, authenticated;
REVOKE ALL ON TABLE public.subscriptions FROM anon, authenticated;
REVOKE ALL ON TABLE public.usage_daily FROM anon, authenticated;
REVOKE ALL ON TABLE public.billing_events FROM anon, authenticated;
REVOKE ALL ON TABLE public.code_history FROM anon, authenticated;

REVOKE ALL ON FUNCTION public.increment_usage_daily(text, date, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_usage_daily(text, date, text, timestamptz)
  TO service_role;
