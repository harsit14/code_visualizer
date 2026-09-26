import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getDatabase,
  isDatabaseUniqueConstraintError,
  isMissingSchemaError,
  type HistoryRow,
} from './database';

type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

describe('Supabase database adapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is unavailable until Supabase secrets are configured', () => {
    expect(getDatabase({})).toBeNull();
    expect(getDatabase({ SUPABASE_URL: 'https://project.supabase.co' })).toBeNull();
  });

  it('increments usage through the Supabase RPC endpoint', async () => {
    const fetchMock = vi.fn<FetchMock>(
      async () =>
        new Response(JSON.stringify([{ new_count: 7 }]), {
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const db = getDatabase({
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      SUPABASE_URL: 'https://project.supabase.co',
    });

    await expect(
      db?.incrementUsageDaily({
        day: '2026-06-16',
        plan: 'free',
        subject: 'user:abc',
        updatedAt: '2026-06-16T12:00:00.000Z',
      }),
    ).resolves.toBe(7);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://project.supabase.co/rest/v1/rpc/increment_usage_daily');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(
      JSON.stringify({
        p_day: '2026-06-16',
        p_plan: 'free',
        p_subject: 'user:abc',
        p_updated_at: '2026-06-16T12:00:00.000Z',
      }),
    );
    expect(new Headers(init?.headers).get('apikey')).toBe('service-role-key');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer service-role-key');
  });

  it('recognizes Supabase unique constraint errors', async () => {
    const fetchMock = vi.fn<FetchMock>(
      async () =>
        new Response(
          JSON.stringify({
            code: '23505',
            message: 'duplicate key value violates unique constraint "users_email_key"',
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 409,
          },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const db = getDatabase({
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      SUPABASE_URL: 'https://project.supabase.co',
    });

    try {
      await db?.createUser({
        created_at: '2026-06-16T12:00:00.000Z',
        email: 'person@example.com',
        id: '80c2c8f7-8a11-47ed-a084-6ec71d47d260',
        password_hash: 'hmac_sha256_v1$salt$hash',
      });
      throw new Error('Expected createUser to fail.');
    } catch (error) {
      expect(isDatabaseUniqueConstraintError(error)).toBe(true);
    }
  });

  it('inserts idempotent history with ON CONFLICT DO NOTHING and reports replays', async () => {
    const fetchMock = vi.fn<FetchMock>(async () => Response.json([]));
    vi.stubGlobal('fetch', fetchMock);
    const db = getDatabase(env)!;
    const row = { id: 'history-1', user_id: 'user-1' } as HistoryRow;

    await expect(db.insertHistoryOnce(row, 'key-1')).resolves.toBe(false);
    const [url, init] = fetchMock.mock.calls[0];
    const target = new URL(String(url));
    expect(target.pathname).toBe('/rest/v1/code_history');
    expect(target.searchParams.get('on_conflict')).toBe('user_id,idempotency_key');
    expect(new Headers(init?.headers).get('Prefer')).toBe(
      'resolution=ignore-duplicates,return=representation',
    );
    expect(JSON.parse(String(init?.body))).toMatchObject({
      id: 'history-1',
      idempotency_key: 'key-1',
    });
    fetchMock.mockResolvedValueOnce(Response.json([{ id: 'history-1' }], { status: 201 }));
    await expect(db.insertHistoryOnce(row, 'key-1')).resolves.toBe(true);
  });

  it('recognizes a missing 0004 column as a pending migration', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchMock>(async () =>
        Response.json(
          { code: 'PGRST204', message: "Could not find the 'idempotency_key' column" },
          { status: 400 },
        ),
      ),
    );
    const error = await getDatabase(env)!
      .insertHistoryOnce({ id: 'history-1' } as HistoryRow, 'key-1')
      .catch((caught: unknown) => caught);
    expect(isMissingSchemaError(error)).toBe(true);
    expect(isMissingSchemaError(new Error('PGRST204'))).toBe(false);
  });

  it('revokes other sessions only within one user and counts them', async () => {
    const fetchMock = vi.fn<FetchMock>(async () =>
      Response.json([{ token_hash: 'x' }, { token_hash: 'y' }]),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(getDatabase(env)!.deleteOtherSessions('user-1', 'keep')).resolves.toBe(2);
    const [url, init] = fetchMock.mock.calls[0];
    const target = new URL(String(url));
    expect(init?.method).toBe('DELETE');
    expect(target.searchParams.get('user_id')).toBe('eq.user-1');
    expect(target.searchParams.get('token_hash')).toBe('neq.keep');
  });

  it('reads session details only when migration 0004 added them', async () => {
    const user = {
      id: 'user-1',
      email: 'a@example.com',
      created_at: 'c',
      stripe_customer_id: null,
    };
    const session = { token_hash: 't', user_id: 'user-1', created_at: 's', expires_at: 'e' };
    const respond = (sessionRow: object) =>
      vi.fn<FetchMock>(async (input) =>
        Response.json(String(input).includes('/sessions') ? [sessionRow] : [user]),
      );
    vi.stubGlobal('fetch', respond(session));
    expect((await getDatabase(env)!.findSessionUser('t', 'now'))?.session).toEqual({
      created_at: 's',
    });
    vi.stubGlobal(
      'fetch',
      respond({ ...session, device_label: 'Chrome on Linux', last_used_at: null }),
    );
    expect((await getDatabase(env)!.findSessionUser('t', 'now'))?.session).toEqual({
      created_at: 's',
      device_label: 'Chrome on Linux',
      last_used_at: null,
    });
  });

  it('deletes accounts through the atomic RPC', async () => {
    const fetchMock = vi.fn<FetchMock>(async () => Response.json([{ history_deleted: 1 }]));
    vi.stubGlobal('fetch', fetchMock);
    await getDatabase(env)!.deleteAccount('user-1', 'hash', null);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://project.supabase.co/rest/v1/rpc/delete_account');
    expect(JSON.parse(String(init?.body))).toEqual({
      p_user_id: 'user-1',
      p_token_hash: 'hash',
      p_provider_subject: null,
    });
  });

  it('pushes workspace revisions through the compare-and-append RPC', async () => {
    const head = { id: 'ws-1', revision: 1, change_seq: 7 };
    const fetchMock = vi.fn<FetchMock>(async () => Response.json({ status: 'stored', head }));
    vi.stubGlobal('fetch', fetchMock);
    const db = getDatabase(env)!;
    await expect(
      db.pushWorkspaceRevision({
        base_revision: 0,
        body: '{}',
        max_bytes: 10,
        max_workspaces: 2,
        meta: { tags: [] },
        name: 'Two Sum',
        user_id: 'user-1',
        workspace_id: 'ws-1',
      }),
    ).resolves.toEqual({ status: 'stored', head });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://project.supabase.co/rest/v1/rpc/workspace_sync_push');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      p_user_id: 'user-1',
      p_workspace_id: 'ws-1',
      p_base_revision: 0,
      p_body: '{}',
    });

    fetchMock.mockResolvedValueOnce(Response.json([]));
    await db.listSyncedWorkspaces('user-1', 7, 101);
    const target = new URL(String(fetchMock.mock.calls[1][0]));
    expect(target.pathname).toBe('/rest/v1/synced_workspaces');
    expect(target.searchParams.get('user_id')).toBe('eq.user-1');
    expect(target.searchParams.get('change_seq')).toBe('gt.7');
    expect(target.searchParams.get('order')).toBe('change_seq.asc');

    fetchMock.mockResolvedValueOnce(
      Response.json({ code: 'PGRST202', message: 'Could not find the function' }, { status: 404 }),
    );
    const missing = await db.deleteSyncedWorkspace('user-1', 'ws-1').catch((error) => error);
    expect(isMissingSchemaError(missing)).toBe(true);
    fetchMock.mockResolvedValueOnce(Response.json(null));
    await expect(db.updateSyncedWorkspaceMeta('user-1', 'ws-1', 0, {})).rejects.toThrow(
      'Invalid workspace sync response.',
    );
  });
});

const env = {
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  SUPABASE_URL: 'https://project.supabase.co',
};
