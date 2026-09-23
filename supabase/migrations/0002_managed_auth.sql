BEGIN;

-- Apply to a staging Supabase project first. No email-based automatic account merge.
CREATE TABLE public.account_identities (
  provider_subject uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  app_user_id uuid NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  linked_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sessions ADD COLUMN auth_method text NOT NULL DEFAULT 'legacy'
  CHECK (auth_method IN ('legacy', 'supabase'));

CREATE TABLE public.auth_rate_limits (
  bucket text PRIMARY KEY,
  attempts integer NOT NULL CHECK (attempts > 0),
  reset_at timestamptz NOT NULL
);
CREATE INDEX auth_rate_limits_reset_idx ON public.auth_rate_limits(reset_at);
ALTER TABLE public.account_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_identities, public.auth_rate_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.account_identities, public.auth_rate_limits TO service_role;

CREATE FUNCTION public.consume_auth_limit(p_bucket text, p_limit integer, p_window_seconds integer)
RETURNS TABLE(allowed boolean, retry_after integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE b public.auth_rate_limits;
BEGIN
  IF length(p_bucket) <> 64 OR p_limit < 1 OR p_limit > 1000 OR p_window_seconds < 1 OR p_window_seconds > 86400 THEN
    RAISE EXCEPTION 'invalid_limit';
  END IF;
  INSERT INTO public.auth_rate_limits AS target (bucket, attempts, reset_at)
    VALUES (p_bucket, 1, now() + make_interval(secs => p_window_seconds))
    ON CONFLICT (bucket) DO UPDATE SET
      attempts = CASE WHEN target.reset_at <= now() THEN 1 ELSE LEAST(target.attempts + 1, p_limit + 1) END,
      reset_at = CASE WHEN target.reset_at <= now() THEN now() + make_interval(secs => p_window_seconds) ELSE target.reset_at END
    RETURNING * INTO b;
  RETURN QUERY SELECT b.attempts <= p_limit, GREATEST(1, ceil(extract(epoch FROM b.reset_at - now()))::integer);
END $$;

-- Locks the account so a concurrent legacy password login cannot mint a new
-- legacy session after a successful link has revoked the old sessions.
CREATE FUNCTION public.guard_session_auth_method() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE managed boolean;
BEGIN
  SELECT password_hash = '!managed:supabase' INTO managed FROM public.users WHERE id = NEW.user_id FOR UPDATE;
  IF managed IS NULL OR (managed AND NEW.auth_method <> 'supabase') OR (NOT managed AND NEW.auth_method <> 'legacy') THEN
    RAISE EXCEPTION 'session_method_conflict';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER session_auth_method BEFORE INSERT OR UPDATE ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.guard_session_auth_method();

-- Provider identity eligibility is checked on every managed session lookup,
-- including history and AI requests. A provider ban/deletion fails closed.
CREATE FUNCTION public.managed_session_user(p_token_hash text)
RETURNS TABLE(id uuid, email text, created_at timestamptz, stripe_customer_id text)
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT u.id, u.email, u.created_at, u.stripe_customer_id
  FROM public.sessions s
  JOIN public.users u ON u.id = s.user_id
  JOIN public.account_identities i ON i.app_user_id = u.id
  JOIN auth.users a ON a.id = i.provider_subject
  WHERE s.token_hash = p_token_hash AND s.expires_at > now() AND s.auth_method = 'supabase'
    AND u.password_hash = '!managed:supabase' AND a.email_confirmed_at IS NOT NULL
    AND a.deleted_at IS NULL AND (a.banned_until IS NULL OR a.banned_until <= now())
    AND lower(a.email) = u.email
    AND NOT EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = a.id AND f.status = 'verified');
$$;

CREATE FUNCTION public.complete_managed_auth(
  p_subject uuid, p_email text, p_legacy_token_hash text, p_new_token_hash text
)
RETURNS TABLE(id uuid, email text, created_at timestamptz, stripe_customer_id text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE owner_id uuid; existing_id uuid; account public.users;
BEGIN
  IF length(p_new_token_hash) <> 64 OR p_email <> lower(p_email) THEN RAISE EXCEPTION 'invalid_identity'; END IF;
  -- Serialize duplicate verification/link requests for the same provider identity.
  PERFORM 1 FROM auth.users a WHERE a.id = p_subject AND lower(a.email) = p_email
    AND a.email_confirmed_at IS NOT NULL AND a.deleted_at IS NULL
    AND (a.banned_until IS NULL OR a.banned_until <= now())
    AND NOT EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = a.id AND f.status = 'verified') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_identity'; END IF;
  SELECT i.app_user_id INTO existing_id FROM public.account_identities i WHERE i.provider_subject = p_subject;

  IF p_legacy_token_hash IS NOT NULL THEN
    SELECT s.user_id INTO owner_id FROM public.sessions s WHERE s.token_hash = p_legacy_token_hash;
    SELECT * INTO account FROM public.users u WHERE u.id = owner_id FOR UPDATE;
    -- Check proof again after the user lock. Linking requires a fresh login.
    IF account.id IS NULL OR account.email <> p_email OR account.password_hash = '!managed:supabase'
      OR NOT EXISTS (SELECT 1 FROM public.sessions s WHERE s.token_hash = p_legacy_token_hash
        AND s.user_id = owner_id AND s.auth_method = 'legacy' AND s.expires_at > now()
        AND s.created_at > now() - interval '10 minutes') THEN RAISE EXCEPTION 'fresh_legacy_login_required'; END IF;
    IF existing_id IS NOT NULL OR EXISTS (SELECT 1 FROM public.account_identities i WHERE i.app_user_id = owner_id) THEN
      RAISE EXCEPTION 'identity_conflict';
    END IF;
    INSERT INTO public.account_identities(provider_subject, app_user_id) VALUES (p_subject, owner_id);
    UPDATE public.users SET password_hash = '!managed:supabase' WHERE public.users.id = owner_id;
    DELETE FROM public.sessions WHERE user_id = owner_id;
  ELSIF existing_id IS NOT NULL THEN
    owner_id := existing_id;
    SELECT * INTO account FROM public.users u WHERE u.id = owner_id FOR UPDATE;
    IF account.email <> p_email OR account.password_hash <> '!managed:supabase' THEN RAISE EXCEPTION 'identity_conflict'; END IF;
  ELSE
    -- Matching an unverified legacy email is NEVER enough to inherit its data.
    IF EXISTS (SELECT 1 FROM public.users u WHERE u.email = p_email AND u.password_hash = '!managed:supabase') THEN RAISE EXCEPTION 'identity_conflict'; END IF;
    IF EXISTS (SELECT 1 FROM public.users u WHERE u.email = p_email) THEN RAISE EXCEPTION 'legacy_link_required'; END IF;
    owner_id := gen_random_uuid();
    INSERT INTO public.users(id, email, password_hash, created_at)
      VALUES (owner_id, p_email, '!managed:supabase', now());
    INSERT INTO public.account_identities(provider_subject, app_user_id) VALUES (p_subject, owner_id);
  END IF;
  INSERT INTO public.sessions(token_hash, user_id, created_at, expires_at, auth_method)
    VALUES (p_new_token_hash, owner_id, now(), now() + interval '30 days', 'supabase');
  RETURN QUERY SELECT u.id, u.email, u.created_at, u.stripe_customer_id FROM public.users u WHERE u.id = owner_id;
END $$;

REVOKE ALL ON FUNCTION public.consume_auth_limit(text, integer, integer), public.guard_session_auth_method(),
  public.managed_session_user(text), public.complete_managed_auth(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_auth_limit(text, integer, integer),
  public.managed_session_user(text), public.complete_managed_auth(uuid, text, text, text) TO service_role;

COMMIT;
