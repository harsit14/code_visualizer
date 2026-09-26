-- Account session controls, atomic account deletion and idempotent history saves.
--
-- Sessions gain a coarse device label (for example "Firefox on Windows"; never a
-- full User-Agent or an IP address) and a last-used time that the Worker
-- refreshes at most hourly. `delete_account` removes a user's usage counters,
-- history, sessions and account row in one transaction, and only while the
-- caller's own session is still valid. Managed (email-code) accounts must also
-- present the provider identity that a fresh email code just verified.
--
-- History saves carry a client-generated idempotency key. (user_id,
-- idempotency_key) is unique, so a retried save whose acknowledgement was lost
-- returns the stored entry instead of inserting a duplicate. Older rows and
-- clients have a NULL key, which never conflicts.
--
-- Apply after 0001; 0002 and 0003 are optional and may be applied before or
-- after. The Worker keeps working without this migration: sessions are listed
-- without device and last-used details, history saves skip the idempotency key,
-- and account deletion reports that it is unavailable.

BEGIN;

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS device_label text CHECK (char_length(device_label) <= 64),
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz;

ALTER TABLE public.code_history ADD COLUMN IF NOT EXISTS idempotency_key uuid;

-- A plain (non-partial) unique index so PostgREST's on_conflict can target it.
CREATE UNIQUE INDEX IF NOT EXISTS code_history_user_idempotency_key_idx
  ON public.code_history(user_id, idempotency_key);

CREATE OR REPLACE FUNCTION public.delete_account(
  p_user_id uuid, p_token_hash text, p_provider_subject uuid
)
RETURNS TABLE(history_deleted integer, sessions_deleted integer, usage_deleted integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE account public.users; history_count integer; session_count integer; usage_count integer;
BEGIN
  -- The lock also blocks a concurrent login from adding a session mid-delete.
  SELECT * INTO account FROM public.users u WHERE u.id = p_user_id FOR UPDATE;
  -- Re-check the caller's session after the lock: a session revoked after the
  -- Worker looked it up cannot delete the account.
  IF account.id IS NULL OR NOT EXISTS (SELECT 1 FROM public.sessions s
    WHERE s.token_hash = p_token_hash AND s.user_id = p_user_id AND s.expires_at > now()) THEN
    RAISE EXCEPTION 'session_required';
  END IF;
  -- Nested so account_identities (from 0002) is only planned for managed accounts.
  IF account.password_hash = '!managed:supabase' THEN
    IF p_provider_subject IS NULL OR NOT EXISTS (SELECT 1 FROM public.account_identities i
      WHERE i.provider_subject = p_provider_subject AND i.app_user_id = p_user_id) THEN
      RAISE EXCEPTION 'reauthentication_required';
    END IF;
  END IF;

  DELETE FROM public.usage_daily WHERE subject = 'user:' || p_user_id::text;
  GET DIAGNOSTICS usage_count = ROW_COUNT;
  DELETE FROM public.code_history WHERE user_id = p_user_id;
  GET DIAGNOSTICS history_count = ROW_COUNT;
  DELETE FROM public.sessions WHERE user_id = p_user_id;
  GET DIAGNOSTICS session_count = ROW_COUNT;
  -- Cascades to subscriptions and, with 0002, the provider identity mapping.
  DELETE FROM public.users WHERE id = p_user_id;
  RETURN QUERY SELECT history_count, session_count, usage_count;
END $$;

REVOKE ALL ON FUNCTION public.delete_account(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_account(uuid, text, uuid) TO service_role;

COMMIT;
