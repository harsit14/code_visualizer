import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAccountApi } from './accountApi';
import { getDatabase } from './database';
import { resetRateLimitsForTests } from './rateLimit';
import {
  ALICE,
  ALICE_PASSWORD,
  ALICE_TOKEN,
  BOB,
  BOB_TOKEN,
  cookie,
  createAccountFixture,
  TEST_PEPPER_ENV,
} from './accountTestFixtures';
import { parseWorkspace, type WorkspaceRevision } from '../app/workspaceFormat';
import { workspaceRevision } from '../app/workspaceTestFixtures';

vi.mock('./database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./database')>()),
  getDatabase: vi.fn(),
}));

const env = {
  ...TEST_PEPPER_ENV,
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  SUPABASE_URL: 'https://project.supabase.co',
};
const tags = { tags: ['bfs'], needsReview: false, reviewBy: null };
let fixture: Awaited<ReturnType<typeof createAccountFixture>>;

async function use(options: Parameters<typeof createAccountFixture>[0] = {}) {
  fixture = await createAccountFixture(options);
  vi.mocked(getDatabase).mockReturnValue(fixture.database);
}

function call(
  path: string,
  {
    body,
    headers = {},
    method = 'GET',
    token = ALICE_TOKEN,
    account = ALICE,
  }: {
    body?: unknown;
    headers?: Record<string, string>;
    method?: string;
    token?: string | null;
    account?: string | null;
  } = {},
) {
  return handleAccountApi(
    new Request(`https://app.example/api/${path}`, {
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '203.0.113.9',
        ...(token ? cookie(token) : {}),
        ...(account ? { 'X-Sync-Account': account } : {}),
        ...headers,
      },
      method,
    }),
    env,
  ) as Promise<Response>;
}

const revision = (n: number, overrides: Partial<WorkspaceRevision> = {}): WorkspaceRevision => ({
  ...workspaceRevision(),
  revision: n,
  savedAt: 1000 + n,
  ...overrides,
});

function push(workspace: WorkspaceRevision, options: Parameters<typeof call>[1] = {}) {
  return call(`workspaces/${workspace.id}/revisions/${workspace.revision}`, {
    body: { baseRevision: workspace.revision - 1, workspace, meta: tags },
    method: 'PUT',
    ...options,
  });
}

beforeEach(async () => {
  resetRateLimitsForTests();
  await use();
});

describe('workspace sync API', () => {
  it.each([
    ['workspaces', 'GET'],
    ['workspaces/workspace-one/revisions/1', 'GET'],
    ['workspaces/workspace-one/revisions/1', 'PUT'],
    ['workspaces/workspace-one', 'PATCH'],
    ['workspaces/workspace-one', 'DELETE'],
  ])('requires a signed-in session for %s %s', async (path, method) => {
    const anonymous = await call(path, {
      method,
      token: null,
      body: method === 'GET' ? undefined : {},
    });
    expect(anonymous.status).toBe(401);
    expect((await anonymous.json()).code).toBe('signed_out');
    const forged = await call(path, { method, token: 'f'.repeat(43) });
    expect(forged.status).toBe(401);
    expect(fixture.db.pushWorkspaceRevision).not.toHaveBeenCalled();
    expect(fixture.db.listSyncedWorkspaces).not.toHaveBeenCalled();
  });

  it('rejects cross-origin requests before looking up the session', async () => {
    const response = await push(revision(1), { headers: { Origin: 'https://attacker.example' } });
    expect(response.status).toBe(403);
    expect(fixture.db.findSessionUser).not.toHaveBeenCalled();
  });

  it('refuses a request meant for another account, so a switched session cannot mix libraries', async () => {
    const missing = await call('workspaces', { account: null });
    expect(missing.status).toBe(400);
    const pushed = await push(revision(1), { token: BOB_TOKEN, account: ALICE });
    expect(pushed.status).toBe(409);
    expect((await pushed.json()).code).toBe('account_mismatch');
    const listed = await call('workspaces', { token: BOB_TOKEN, account: ALICE });
    expect(listed.status).toBe(409);
    expect(fixture.db.pushWorkspaceRevision).not.toHaveBeenCalled();
    expect(fixture.db.listSyncedWorkspaces).not.toHaveBeenCalled();
  });

  it('stores a revision once, treats an identical retry as success and refuses a different one', async () => {
    const first = await push(revision(1));
    expect(first.status).toBe(201);
    const stored = await first.json();
    expect(stored).toMatchObject({
      status: 'stored',
      head: { id: 'workspace-one', name: 'My exercise', revision: 1, meta: tags, deleted: false },
    });
    // The acknowledgement was lost; the client sends the same revision again.
    const retry = await push(revision(1));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ status: 'duplicate', head: { revision: 1 } });
    expect(fixture.revisions).toHaveLength(1);

    const other = await push(revision(1, { savedAt: 99, name: 'Edited elsewhere' }));
    expect(other.status).toBe(409);
    expect(await other.json()).toMatchObject({ code: 'conflict', head: { revision: 1 } });
    expect((await push(revision(2))).status).toBe(201);
    const stale = await push(revision(2, { savedAt: 5 }));
    expect(stale.status).toBe(409);
    expect((await stale.json()).head.revision).toBe(2);
  });

  it('lists heads changed since a cursor and pages through them', async () => {
    await push(revision(1));
    await push(revision(1, { id: 'workspace-two' }));
    const all = await (await call('workspaces')).json();
    expect(all.items.map((item: { id: string }) => item.id)).toEqual([
      'workspace-one',
      'workspace-two',
    ]);
    expect(all.more).toBe(false);
    await push(revision(2));
    const changed = await (await call(`workspaces?since=${all.cursor}`)).json();
    expect(changed.items).toEqual([expect.objectContaining({ id: 'workspace-one', revision: 2 })]);
    const none = await (await call(`workspaces?since=${changed.cursor}`)).json();
    expect(none).toEqual({ items: [], cursor: changed.cursor, more: false });
    expect((await call('workspaces?since=-1')).status).toBe(400);
  });

  it('returns the stored, re-validated document without unknown fields', async () => {
    const extra = { ...revision(1), injected: '<script>' } as WorkspaceRevision;
    expect((await push(extra)).status).toBe(201);
    const response = await call('workspaces/workspace-one/revisions/1');
    expect(response.headers.get('Content-Type')).toContain('application/json');
    const text = await response.text();
    expect(text).not.toContain('injected');
    expect(parseWorkspace(text)).toEqual(revision(1));
    expect((await call('workspaces/workspace-one/revisions/2')).status).toBe(404);
    expect((await call('workspaces/bad%20id/revisions/1')).status).toBe(404);
  });

  it('isolates accounts, even for the same workspace ID', async () => {
    await push(revision(1));
    const bobList = await (await call('workspaces', { token: BOB_TOKEN, account: BOB })).json();
    expect(bobList.items).toEqual([]);
    const bobFetch = await call('workspaces/workspace-one/revisions/1', {
      token: BOB_TOKEN,
      account: BOB,
    });
    expect(bobFetch.status).toBe(404);
    const bobPush = await push(revision(1, { name: 'Bob’s' }), { token: BOB_TOKEN, account: BOB });
    expect(bobPush.status).toBe(201);
    const bobDelete = await call('workspaces/workspace-one', {
      method: 'DELETE',
      token: BOB_TOKEN,
      account: BOB,
    });
    expect(bobDelete.status).toBe(200);
    const alice = await (await call('workspaces')).json();
    expect(alice.items).toEqual([expect.objectContaining({ name: 'My exercise', deleted: false })]);
  });

  it('rejects invalid, mismatched and oversized payloads before storing anything', async () => {
    const bad = revision(1, { content: { ...revision(1).content, language: 'cobol' as never } });
    const invalid = await push(bad);
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).code).toBe('invalid');
    const wrongId = await call('workspaces/other-id/revisions/1', {
      body: { baseRevision: 0, workspace: revision(1), meta: tags },
      method: 'PUT',
    });
    expect(wrongId.status).toBe(400);
    const wrongBase = await call('workspaces/workspace-one/revisions/2', {
      body: { baseRevision: 0, workspace: revision(2), meta: tags },
      method: 'PUT',
    });
    expect(wrongBase.status).toBe(400);
    const badTags = await call('workspaces/workspace-one/revisions/1', {
      body: { baseRevision: 0, workspace: revision(1), meta: { tags: ['<b>'] } },
      method: 'PUT',
    });
    expect(badTags.status).toBe(400);
    const huge = revision(1, {
      content: {
        ...revision(1).content,
        notebook: { ...revision(1).content.notebook, notes: 'x'.repeat(199_000) },
      },
    });
    const body = JSON.stringify({
      baseRevision: 0,
      workspace: {
        ...huge,
        content: {
          ...huge.content,
          cases: Array(12)
            .fill(null)
            .map((_, i) => ({
              ...huge.content.cases[0],
              id: `c${i}`,
              expected: 'y'.repeat(199_000),
            })),
        },
      },
    });
    const oversized = await call('workspaces/workspace-one/revisions/1', { body, method: 'PUT' });
    expect(oversized.status).toBe(413);
    expect(fixture.db.pushWorkspaceRevision).not.toHaveBeenCalled();
  });

  it('updates tags with their own version check and accepts a retried update', async () => {
    await push(revision(1));
    const next = { tags: ['bfs', 'graph'], needsReview: true, reviewBy: null };
    const patch = (metaVersion: number, meta: unknown) =>
      call('workspaces/workspace-one', { body: { metaVersion, meta }, method: 'PATCH' });
    const updated = await patch(0, next);
    expect(updated.status).toBe(200);
    expect((await updated.json()).head).toMatchObject({ meta: next, metaVersion: 1 });
    expect((await (await patch(0, next)).json()).status).toBe('duplicate');
    const stale = await patch(0, tags);
    expect(stale.status).toBe(409);
    expect((await stale.json()).head.meta).toEqual(next);
    expect((await patch(1, { tags: 'nope' })).status).toBe(400);
    const unknown = await call('workspaces/unknown-id', {
      body: { metaVersion: 0, meta: tags },
      method: 'PATCH',
    });
    expect(unknown.status).toBe(404);
  });

  it('tombstones a removed workspace so other devices stop syncing it', async () => {
    await push(revision(1));
    const removed = await call('workspaces/workspace-one', { method: 'DELETE' });
    expect(removed.status).toBe(200);
    expect((await removed.json()).head).toMatchObject({ deleted: true, name: 'Removed workspace' });
    expect(fixture.revisions).toHaveLength(0);
    expect((await call('workspaces/workspace-one/revisions/1')).status).toBe(404);
    const late = await push(revision(2));
    expect(late.status).toBe(409);
    expect((await late.json()).code).toBe('deleted');
    const listed = await (await call('workspaces')).json();
    expect(listed.items).toEqual([
      expect.objectContaining({ deleted: true, meta: expect.any(Object) }),
    ]);
    expect((await call('workspaces/never-there', { method: 'DELETE' })).status).toBe(404);
  });

  it('throttles writes per account', async () => {
    await push(revision(1));
    for (let attempt = 1; attempt < 120; attempt += 1) await push(revision(1));
    const limited = await push(revision(1));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBeTruthy();
    expect((await call('workspaces')).status).toBe(200);
  });

  it('reports sync as unavailable before migration 0005 without breaking other routes', async () => {
    await use({ workspaceSync: false });
    const listed = await call('workspaces');
    expect(listed.status).toBe(503);
    expect((await listed.json()).code).toBe('sync_unavailable');
    const pushed = await push(revision(1));
    expect(pushed.status).toBe(503);
    expect((await pushed.json()).code).toBe('sync_unavailable');
    const exported = await call('account/export', { account: null });
    expect(exported.status).toBe(200);
    expect((await exported.json()).workspaces).toEqual([]);
    expect((await call('account/sessions', { account: null })).status).toBe(200);
  });
});

describe('synced workspaces in account export and deletion', () => {
  it('exports the caller’s latest revisions as restorable backups', async () => {
    await push(revision(1));
    await push(revision(2, { name: 'Renamed' }));
    await push(revision(1, { name: 'Bob only' }), { token: BOB_TOKEN, account: BOB });
    const response = await call('account/export', { account: null });
    const text = await response.text();
    const data = JSON.parse(text);
    expect(data.workspaces).toEqual([
      expect.objectContaining({
        id: 'workspace-one',
        name: 'Renamed',
        revision: 2,
        tags: ['bfs'],
        backup: expect.objectContaining({
          format: 'code-visualizer-workspace',
          meta: tags,
          workspace: expect.objectContaining({ revision: 2, name: 'Renamed' }),
        }),
      }),
    ]);
    expect(data.limits).toMatchObject({ workspaces: 50, workspaceBackupBytes: 8 * 1024 * 1024 });
    expect(text).not.toContain('Bob only');
  });

  it('removes synced workspaces with the account', async () => {
    await push(revision(1));
    await push(revision(1), { token: BOB_TOKEN, account: BOB });
    const response = await call('account/delete', {
      body: { confirmEmail: 'alice@example.com', password: ALICE_PASSWORD },
      method: 'POST',
      account: null,
    });
    expect(response.status).toBe(200);
    expect(fixture.workspaces.map((row) => row.user_id)).toEqual([BOB]);
    expect(fixture.revisions.map((row) => row.user_id)).toEqual([BOB]);
  });
});
