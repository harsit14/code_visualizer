-- Opt-in account sync for the local workspace library.
--
-- `synced_workspaces` keeps one head per (user, workspace ID): the latest
-- revision's number and name, tags and review state with their own version, a
-- change number the Worker lists as a sync cursor, and a tombstone time once the
-- workspace is removed from the account. `synced_workspace_revisions` keeps
-- immutable revisions: the workspace document the Worker validated and
-- re-serialized, at most 2 MB each.
--
-- Writes go through the functions below. Each locks the user row first, so one
-- account's sync writes run one at a time (change numbers commit in order, and a
-- concurrent delete_account either finishes first or waits). A revision is
-- accepted only when the server head equals its base revision. (user_id,
-- workspace_id, revision) is unique, so a revision re-sent after a lost
-- acknowledgement is reported as a duplicate when identical and as a conflict
-- when it differs; stored revisions are never overwritten.
--
-- `delete_account` is replaced, with its 0004 signature, so account deletion also
-- removes synced workspaces. `workspace_sync_export` feeds the account export.
--
-- Apply after 0004. The Worker keeps working without this migration: sync
-- reports that it is unavailable and account exports list no workspaces.

BEGIN;

CREATE SEQUENCE IF NOT EXISTS public.synced_workspace_changes;

CREATE TABLE IF NOT EXISTS public.synced_workspaces (
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  id text NOT NULL CHECK (id ~ '^[A-Za-z0-9-]{1,80}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  revision integer NOT NULL CHECK (revision >= 1),
  meta jsonb NOT NULL CHECK (jsonb_typeof(meta) = 'object' AND octet_length(meta::text) <= 4096),
  meta_version integer NOT NULL DEFAULT 0 CHECK (meta_version >= 0),
  -- Sum of this workspace's revision sizes, for the per-account storage bound.
  bytes bigint NOT NULL CHECK (bytes >= 0),
  change_seq bigint NOT NULL DEFAULT nextval('public.synced_workspace_changes'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS synced_workspaces_user_change_idx
  ON public.synced_workspaces(user_id, change_seq);

CREATE TABLE IF NOT EXISTS public.synced_workspace_revisions (
  user_id uuid NOT NULL,
  workspace_id text NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  body text NOT NULL CHECK (octet_length(body) <= 2097152),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, workspace_id, revision),
  FOREIGN KEY (user_id, workspace_id)
    REFERENCES public.synced_workspaces(user_id, id) ON DELETE CASCADE
);

ALTER TABLE public.synced_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.synced_workspace_revisions ENABLE ROW LEVEL SECURITY;

-- Stores revision `p_base_revision + 1`. Status: stored, duplicate (identical
-- revision already stored), conflict (head moved or a different revision holds
-- that number), deleted (tombstone; only a fresh upload from revision 1 may
-- continue), missing (no head for a base above 0) or quota.
CREATE OR REPLACE FUNCTION public.workspace_sync_push(
  p_user_id uuid, p_workspace_id text, p_base_revision integer, p_name text,
  p_body text, p_meta jsonb, p_max_workspaces integer, p_max_bytes bigint
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  head public.synced_workspaces;
  stored text;
  size bigint := octet_length(p_body);
BEGIN
  IF p_base_revision IS NULL OR p_base_revision < 0 THEN
    RAISE EXCEPTION 'invalid_revision';
  END IF;
  PERFORM 1 FROM public.users u WHERE u.id = p_user_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_missing';
  END IF;
  SELECT * INTO head FROM public.synced_workspaces w
    WHERE w.user_id = p_user_id AND w.id = p_workspace_id FOR UPDATE;

  IF head.id IS NOT NULL AND head.deleted_at IS NULL THEN
    SELECT r.body INTO stored FROM public.synced_workspace_revisions r
      WHERE r.user_id = p_user_id AND r.workspace_id = p_workspace_id
        AND r.revision = p_base_revision + 1;
    IF stored IS NOT NULL OR head.revision <> p_base_revision THEN
      RETURN jsonb_build_object(
        'status', CASE WHEN stored = p_body THEN 'duplicate' ELSE 'conflict' END,
        'head', to_jsonb(head) - 'user_id' - 'bytes');
    END IF;
  ELSIF p_base_revision > 0 THEN
    RETURN jsonb_build_object(
      'status', CASE WHEN head.id IS NULL THEN 'missing' ELSE 'deleted' END,
      'head', CASE WHEN head.id IS NULL THEN NULL ELSE to_jsonb(head) - 'user_id' - 'bytes' END);
  END IF;

  IF (head.id IS NULL OR head.deleted_at IS NOT NULL) AND (
    SELECT count(*) FROM public.synced_workspaces w
    WHERE w.user_id = p_user_id AND w.deleted_at IS NULL
  ) >= p_max_workspaces THEN
    RETURN jsonb_build_object('status', 'quota', 'head', NULL);
  END IF;
  IF (
    SELECT coalesce(sum(w.bytes), 0) FROM public.synced_workspaces w WHERE w.user_id = p_user_id
  ) + size > p_max_bytes THEN
    RETURN jsonb_build_object('status', 'quota', 'head', NULL);
  END IF;

  IF head.id IS NULL THEN
    INSERT INTO public.synced_workspaces(user_id, id, name, revision, meta, bytes)
      VALUES (p_user_id, p_workspace_id, p_name, 1, p_meta, size)
      RETURNING * INTO head;
  ELSE
    -- Uploading onto a tombstone starts the workspace over with the pushed metadata.
    UPDATE public.synced_workspaces w SET
      name = p_name,
      revision = p_base_revision + 1,
      meta = CASE WHEN w.deleted_at IS NULL THEN w.meta ELSE p_meta END,
      meta_version = w.meta_version + CASE WHEN w.deleted_at IS NULL THEN 0 ELSE 1 END,
      bytes = CASE WHEN w.deleted_at IS NULL THEN w.bytes ELSE 0 END + size,
      change_seq = nextval('public.synced_workspace_changes'),
      updated_at = now(),
      deleted_at = NULL
    WHERE w.user_id = p_user_id AND w.id = p_workspace_id
    RETURNING * INTO head;
  END IF;
  INSERT INTO public.synced_workspace_revisions(user_id, workspace_id, revision, body)
    VALUES (p_user_id, p_workspace_id, p_base_revision + 1, p_body);
  RETURN jsonb_build_object('status', 'stored', 'head', to_jsonb(head) - 'user_id' - 'bytes');
END $$;

-- Replaces tags and review state when the head still has `p_meta_version`.
CREATE OR REPLACE FUNCTION public.workspace_sync_meta(
  p_user_id uuid, p_workspace_id text, p_meta_version integer, p_meta jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE head public.synced_workspaces;
BEGIN
  PERFORM 1 FROM public.users u WHERE u.id = p_user_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_missing';
  END IF;
  SELECT * INTO head FROM public.synced_workspaces w
    WHERE w.user_id = p_user_id AND w.id = p_workspace_id FOR UPDATE;
  IF head.id IS NULL THEN
    RETURN jsonb_build_object('status', 'missing', 'head', NULL);
  END IF;
  IF head.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'deleted', 'head', to_jsonb(head) - 'user_id' - 'bytes');
  END IF;
  -- A retry whose acknowledgement was lost finds its own update applied.
  IF head.meta_version = p_meta_version + 1 AND head.meta = p_meta THEN
    RETURN jsonb_build_object('status', 'duplicate', 'head', to_jsonb(head) - 'user_id' - 'bytes');
  END IF;
  IF head.meta_version <> p_meta_version THEN
    RETURN jsonb_build_object('status', 'conflict', 'head', to_jsonb(head) - 'user_id' - 'bytes');
  END IF;
  UPDATE public.synced_workspaces w SET
    meta = p_meta,
    meta_version = w.meta_version + 1,
    change_seq = nextval('public.synced_workspace_changes'),
    updated_at = now()
  WHERE w.user_id = p_user_id AND w.id = p_workspace_id
  RETURNING * INTO head;
  RETURN jsonb_build_object('status', 'stored', 'head', to_jsonb(head) - 'user_id' - 'bytes');
END $$;

-- Deletes the revisions and leaves a tombstone, so other devices stop syncing it.
CREATE OR REPLACE FUNCTION public.workspace_sync_delete(p_user_id uuid, p_workspace_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE head public.synced_workspaces;
BEGIN
  PERFORM 1 FROM public.users u WHERE u.id = p_user_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_missing';
  END IF;
  SELECT * INTO head FROM public.synced_workspaces w
    WHERE w.user_id = p_user_id AND w.id = p_workspace_id FOR UPDATE;
  IF head.id IS NULL THEN
    RETURN jsonb_build_object('status', 'missing', 'head', NULL);
  END IF;
  IF head.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'duplicate', 'head', to_jsonb(head) - 'user_id' - 'bytes');
  END IF;
  DELETE FROM public.synced_workspace_revisions r
    WHERE r.user_id = p_user_id AND r.workspace_id = p_workspace_id;
  -- The tombstone keeps no name, tags or code.
  UPDATE public.synced_workspaces w SET
    name = 'Removed workspace',
    meta = '{"tags": [], "needsReview": false, "reviewBy": null}'::jsonb,
    bytes = 0,
    change_seq = nextval('public.synced_workspace_changes'),
    updated_at = now(),
    deleted_at = now()
  WHERE w.user_id = p_user_id AND w.id = p_workspace_id
  RETURNING * INTO head;
  RETURN jsonb_build_object('status', 'stored', 'head', to_jsonb(head) - 'user_id' - 'bytes');
END $$;

-- Latest revision of each live workspace, newest first. Bodies stop once their
-- running total passes `p_max_bytes`; later rows keep their details without one.
CREATE OR REPLACE FUNCTION public.workspace_sync_export(
  p_user_id uuid, p_limit integer, p_max_bytes bigint
)
RETURNS TABLE(id text, name text, revision integer, meta jsonb, updated_at timestamptz, body text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT latest.id, latest.name, latest.revision, latest.meta, latest.updated_at,
    CASE WHEN latest.running <= p_max_bytes THEN latest.body END
  FROM (
    SELECT w.id, w.name, w.revision, w.meta, w.updated_at, r.body,
      sum(octet_length(r.body)) OVER (ORDER BY w.updated_at DESC, w.id) AS running
    FROM public.synced_workspaces w
    JOIN public.synced_workspace_revisions r
      ON r.user_id = w.user_id AND r.workspace_id = w.id AND r.revision = w.revision
    WHERE w.user_id = p_user_id AND w.deleted_at IS NULL
    ORDER BY w.updated_at DESC, w.id
    LIMIT p_limit
  ) latest
  ORDER BY latest.updated_at DESC, latest.id;
$$;

-- As in 0004, plus synced workspaces (their revisions cascade).
CREATE OR REPLACE FUNCTION public.delete_account(
  p_user_id uuid, p_token_hash text, p_provider_subject uuid
)
RETURNS TABLE(history_deleted integer, sessions_deleted integer, usage_deleted integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE account public.users; history_count integer; session_count integer; usage_count integer;
BEGIN
  -- The lock also blocks a concurrent login or sync write mid-delete.
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
  DELETE FROM public.synced_workspaces WHERE user_id = p_user_id;
  DELETE FROM public.sessions WHERE user_id = p_user_id;
  GET DIAGNOSTICS session_count = ROW_COUNT;
  -- Cascades to subscriptions and, with 0002, the provider identity mapping.
  DELETE FROM public.users WHERE id = p_user_id;
  RETURN QUERY SELECT history_count, session_count, usage_count;
END $$;

REVOKE ALL ON TABLE public.synced_workspaces, public.synced_workspace_revisions
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.synced_workspaces, public.synced_workspace_revisions TO service_role;
REVOKE ALL ON SEQUENCE public.synced_workspace_changes FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.synced_workspace_changes TO service_role;

REVOKE ALL ON FUNCTION
  public.workspace_sync_push(uuid, text, integer, text, text, jsonb, integer, bigint),
  public.workspace_sync_meta(uuid, text, integer, jsonb),
  public.workspace_sync_delete(uuid, text),
  public.workspace_sync_export(uuid, integer, bigint),
  public.delete_account(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.workspace_sync_push(uuid, text, integer, text, text, jsonb, integer, bigint),
  public.workspace_sync_meta(uuid, text, integer, jsonb),
  public.workspace_sync_delete(uuid, text),
  public.workspace_sync_export(uuid, integer, bigint),
  public.delete_account(uuid, text, uuid)
  TO service_role;

COMMIT;
