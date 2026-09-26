import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAccountApi } from '../server/accountApi';
import {
  ALICE,
  ALICE_TOKEN,
  BOB,
  BOB_TOKEN,
  createAccountFixture,
  TEST_PEPPER_ENV,
} from '../server/accountTestFixtures';
import { getDatabase } from '../server/database';
import { resetRateLimitsForTests } from '../server/rateLimit';
import { encodeWorkspace, MAX_SYNCED_REVISION_BYTES } from './workspaceFormat';
import {
  autosaveWorkspace,
  listWorkspaces,
  readWorkspace,
  saveWorkspace,
  updateWorkspaceMeta,
} from './workspaceStore';
import { fromAnotherDevice, mergeMeta, syncableRevision, syncLibrary } from './workspaceSync';
import { createWorkspaceSyncApi } from './workspaceSyncClient';
import { listSyncRecords, updateSyncRecord } from './workspaceSyncStore';
import { workspaceContent, workspaceRevision } from './workspaceTestFixtures';

vi.mock('../server/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../server/database')>()),
  getDatabase: vi.fn(),
}));

const env = {
  ...TEST_PEPPER_ENV,
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  SUPABASE_URL: 'https://project.supabase.co',
};
const tags = { tags: ['two pointers'], needsReview: false, reviewBy: null };
let fixture: Awaited<ReturnType<typeof createAccountFixture>>;
let devices: Record<'laptop' | 'phone', IDBFactory>;
let cursors: Record<'laptop' | 'phone', number>;
/** The session cookie the browser currently sends. */
let session = ALICE_TOKEN;
/** Set to drop the next response after the server has handled the request. */
let loseNextAck: string | null = null;

const server = async (input: string, init: RequestInit) => {
  const response = await handleAccountApi(
    new Request(`https://app.example${input}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), Cookie: `cv_session=${session}` },
    }),
    env,
  );
  if (loseNextAck && init.method === loseNextAck) {
    loseNextAck = null;
    throw new TypeError('Failed to fetch');
  }
  return response ?? Response.json({ error: 'API route not found.' }, { status: 404 });
};
const api = createWorkspaceSyncApi(server);

function on(device: 'laptop' | 'phone') {
  vi.stubGlobal('indexedDB', devices[device]);
}
async function sync(device: 'laptop' | 'phone', account = ALICE) {
  on(device);
  const result = await syncLibrary({ api, account, cursor: cursors[device] });
  cursors[device] = result.cursor;
  return result;
}
const code = (text: string) => ({ ...workspaceContent(), code: text });
const aliceRows = () => fixture.workspaces.filter((row) => row.user_id === ALICE);
const bodyOf = (id: string, revision: number) =>
  fixture.revisions.find((row) => row.workspace_id === id && row.revision === revision)?.body;

beforeEach(async () => {
  resetRateLimitsForTests();
  fixture = await createAccountFixture();
  vi.mocked(getDatabase).mockReturnValue(fixture.database);
  devices = { laptop: new IDBFactory(), phone: new IDBFactory() };
  cursors = { laptop: 0, phone: 0 };
  session = ALICE_TOKEN;
  loseNextAck = null;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('workspace library sync', () => {
  it('uploads every revision and tags once, then another device pulls them unchanged', async () => {
    on('laptop');
    const first = await saveWorkspace('Two Sum', code('a = 1'), undefined, { meta: tags });
    const second = await saveWorkspace('Two Sum', code('a = 2'), first);
    const result = await sync('laptop');
    // Uploading changes nothing in the local library, so its list need not reload.
    expect(result).toMatchObject({ failed: 0, stopped: null, notices: [], libraryChanged: false });
    expect(aliceRows()).toEqual([
      expect.objectContaining({ id: first.id, revision: 2, meta: tags, name: 'Two Sum' }),
    ]);
    expect(JSON.parse(bodyOf(first.id, 2)!).workspace).toEqual(second);
    expect(await listSyncRecords()).toEqual([
      expect.objectContaining({ id: first.id, account: ALICE, remoteRevision: 2, issue: null }),
    ]);
    const pushes = fixture.db.pushWorkspaceRevision.mock.calls.length;
    await sync('laptop');
    expect(fixture.db.pushWorkspaceRevision.mock.calls.length).toBe(pushes);

    const pulled = await sync('phone');
    expect(pulled).toMatchObject({ pulled: 1, libraryChanged: true });
    expect(await listWorkspaces()).toEqual([
      expect.objectContaining({
        id: first.id,
        revision: 2,
        tags: ['two pointers'],
        autosave: null,
      }),
    ]);
    // Revisions are stored as uploaded, replay included, and are only opened on request.
    expect(await readWorkspace(first.id, 1)).toEqual(first);
    expect(await readWorkspace(first.id, 2)).toEqual(second);
  });

  it('pulls newer revisions and tag edits into a workspace with no local changes', async () => {
    on('laptop');
    const first = await saveWorkspace('Window', code('w = 1'));
    await sync('laptop');
    await sync('phone');
    on('laptop');
    await saveWorkspace('Window renamed', code('w = 2'), first);
    await updateWorkspaceMeta(first.id, 0, {
      tags: ['sliding window'],
      needsReview: true,
      reviewBy: null,
    });
    await sync('laptop');

    const result = await sync('phone');
    expect(result.changed).toEqual([first.id]);
    const [head] = await listWorkspaces();
    expect(head).toMatchObject({
      name: 'Window renamed',
      revision: 2,
      source: 'w = 2',
      tags: ['sliding window'],
      needsReview: true,
    });
    const [record] = await listSyncRecords();
    expect(record).toMatchObject({ remoteRevision: 2, localMetaRevision: head.metaRevision });
    const pushes = fixture.db.pushWorkspaceRevision.mock.calls.length;
    const metas = fixture.db.updateSyncedWorkspaceMeta.mock.calls.length;
    await sync('phone');
    expect(fixture.db.pushWorkspaceRevision.mock.calls.length).toBe(pushes);
    expect(fixture.db.updateSyncedWorkspaceMeta.mock.calls.length).toBe(metas);
  });

  it('keeps both versions when two devices save the same workspace, and says so', async () => {
    on('laptop');
    const first = await saveWorkspace('Two Sum', code('base'));
    await sync('laptop');
    await sync('phone');
    on('phone');
    await saveWorkspace('Two Sum', code('phone edit'), first);
    await sync('phone');
    on('laptop');
    await saveWorkspace('Two Sum', code('laptop edit'), first);

    const result = await sync('laptop');
    expect(result.failed).toBe(0);
    expect(result.notices).toEqual([expect.stringContaining('“Two Sum (from another device)”')]);
    const heads = await listWorkspaces();
    const mine = heads.find((head) => head.id === first.id)!;
    const copy = heads.find((head) => head.id !== first.id)!;
    // The local head stays; it follows the account's revision 2 as revision 3.
    expect(mine).toMatchObject({ name: 'Two Sum', revision: 3, source: 'laptop edit' });
    expect((await readWorkspace(first.id, 2)).content.code).toBe('laptop edit');
    expect(copy).toMatchObject({
      name: fromAnotherDevice('Two Sum'),
      revision: 1,
      source: 'phone edit',
    });
    const records = await listSyncRecords();
    expect(records.find((r) => r.id === copy.id)).toMatchObject({ localOnly: true });
    expect(records.find((r) => r.id === first.id)).toMatchObject({
      remoteRevision: 3,
      issue: { kind: 'conflict', message: expect.stringContaining('Both are kept') },
    });
    // Nothing in the account was overwritten, and the copy stayed on this device.
    expect(JSON.parse(bodyOf(first.id, 2)!).workspace.content.code).toBe('phone edit');
    expect(JSON.parse(bodyOf(first.id, 3)!).workspace.content.code).toBe('laptop edit');
    expect(aliceRows()).toHaveLength(1);

    // The phone keeps its own revision 2 and receives the laptop's version after it.
    const phone = await sync('phone');
    expect(phone.changed).toEqual([first.id]);
    expect((await readWorkspace(first.id, 2)).content.code).toBe('phone edit');
    expect((await readWorkspace(first.id, 3)).content.code).toBe('laptop edit');
  });

  it('keeps a longer local history on top of the account’s revisions after a conflict', async () => {
    on('laptop');
    const first = await saveWorkspace('Graph', code('g = 0'));
    await sync('laptop');
    await sync('phone');
    on('phone');
    await saveWorkspace('Graph', code('phone'), first);
    await sync('phone');
    on('laptop');
    const two = await saveWorkspace('Graph', code('laptop 2'), first);
    await saveWorkspace('Graph', code('laptop 3'), two);
    await sync('laptop');
    const mine = (await listWorkspaces()).find((head) => head.id === first.id)!;
    expect(mine.revision).toBe(3);
    expect(JSON.parse(bodyOf(first.id, 3)!).workspace.content.code).toBe('laptop 3');
    expect(JSON.parse(bodyOf(first.id, 2)!).workspace.content.code).toBe('phone');
  });

  it('retries after a lost acknowledgement without duplicating or reporting a conflict', async () => {
    on('laptop');
    const first = await saveWorkspace('Retry', code('r = 1'));
    loseNextAck = 'PUT';
    const lost = await sync('laptop');
    expect(lost.stopped?.code).toBe('offline');
    expect(fixture.revisions).toHaveLength(1);
    expect(await listSyncRecords()).toEqual([]);

    const retried = await sync('laptop');
    expect(retried).toMatchObject({ failed: 0, stopped: null, notices: [] });
    expect(fixture.revisions).toHaveLength(1);
    expect((await listSyncRecords())[0]).toMatchObject({ remoteRevision: 1 });

    // Lost again for revision 2; the next list shows it, and the resend is a duplicate.
    await saveWorkspace('Retry', code('r = 2'), first);
    loseNextAck = 'PUT';
    await sync('laptop');
    const again = await sync('laptop');
    expect(again.notices).toEqual([]);
    expect(fixture.revisions).toHaveLength(2);
    expect(await listWorkspaces()).toHaveLength(1);
    expect((await listSyncRecords())[0]).toMatchObject({ remoteRevision: 2, issue: null });
  });

  it('never sends one account’s workspaces to another or pulls across accounts', async () => {
    on('laptop');
    const alices = await saveWorkspace('Alice work', code('alice'));
    await sync('laptop');
    // Bob signs in on this browser while the library still syncs with Alice.
    session = BOB_TOKEN;
    const blocked = await sync('laptop', ALICE);
    expect(blocked.stopped?.code).toBe('account_mismatch');

    // Bob chooses to sync the library with his account: only new work goes to him.
    await saveWorkspace('Bob work', code('bob'));
    cursors.laptop = 0;
    const bobs = await sync('laptop', BOB);
    expect(bobs.failed).toBe(0);
    const bobRows = fixture.workspaces.filter((row) => row.user_id === BOB);
    expect(bobRows.map((row) => row.name)).toEqual(['Bob work']);
    expect(
      fixture.revisions.filter((row) => row.user_id === BOB && row.body.includes('alice')),
    ).toEqual([]);
    const records = await listSyncRecords();
    expect(records.find((r) => r.id === alices.id)).toMatchObject({ account: ALICE });

    // Back to Alice: Bob's workspace stays out of her account.
    session = ALICE_TOKEN;
    cursors.laptop = 0;
    await sync('laptop', ALICE);
    expect(aliceRows().map((row) => row.name)).toEqual(['Alice work']);
  });

  it('keeps local-only workspaces and autosaves on the device', async () => {
    on('laptop');
    const secret = await saveWorkspace('Private', code('private = 1'));
    await updateSyncRecord(secret.id, () => ({
      id: secret.id,
      account: null,
      localOnly: true,
      remoteRevision: 0,
      metaVersion: 0,
      localMetaRevision: -1,
      issue: null,
    }));
    const shared = await saveWorkspace('Shared', code('shared = 1'));
    await autosaveWorkspace('Shared', code('unsaved draft'), shared, null);
    await sync('laptop');
    expect(aliceRows().map((row) => row.id)).toEqual([shared.id]);
    expect(fixture.revisions.some((row) => row.body.includes('private = 1'))).toBe(false);
    expect(fixture.revisions.some((row) => row.body.includes('unsaved draft'))).toBe(false);
  });

  it('keeps a workspace removed on another device as local only', async () => {
    on('laptop');
    const first = await saveWorkspace('Gone', code('g = 1'));
    await sync('laptop');
    await api.removeWorkspace(ALICE, first.id);
    await saveWorkspace('Gone', code('late edit'), first);
    const result = await sync('laptop');
    expect(result.notices).toEqual([expect.stringContaining('removed from your account')]);
    expect(await listWorkspaces()).toEqual([
      expect.objectContaining({ id: first.id, revision: 2 }),
    ]);
    expect((await listSyncRecords())[0]).toMatchObject({ localOnly: true, remoteRevision: 0 });
    expect(fixture.revisions).toHaveLength(0);
    await sync('laptop');
    expect(fixture.revisions).toHaveLength(0);
  });

  it('merges tag edits made on two devices', async () => {
    on('laptop');
    const first = await saveWorkspace('Tags', code('t = 1'), undefined, { meta: tags });
    await sync('laptop');
    await sync('phone');
    on('phone');
    await updateWorkspaceMeta(first.id, 0, {
      tags: ['two pointers', 'dp'],
      needsReview: false,
      reviewBy: '2026-10-09',
    });
    await sync('phone');
    on('laptop');
    await updateWorkspaceMeta(first.id, 0, {
      tags: ['two pointers', 'bfs'],
      needsReview: true,
      reviewBy: null,
    });
    await sync('laptop');
    const merged = {
      tags: ['two pointers', 'bfs', 'dp'],
      needsReview: true,
      reviewBy: '2026-10-09',
    };
    expect(await listWorkspaces()).toEqual([expect.objectContaining(merged)]);
    expect(aliceRows()[0].meta).toEqual(merged);
    await sync('phone');
    expect(await listWorkspaces()).toEqual([expect.objectContaining(merged)]);
  });

  it('reports sync as unavailable before migration 0005 and changes nothing', async () => {
    fixture = await createAccountFixture({ workspaceSync: false });
    vi.mocked(getDatabase).mockReturnValue(fixture.database);
    on('laptop');
    await saveWorkspace('Waiting', code('w = 1'));
    const result = await sync('laptop');
    expect(result.stopped?.code).toBe('sync_unavailable');
    expect(result.cursor).toBe(0);
    expect(await listSyncRecords()).toEqual([]);
  });
});

describe('sync helpers', () => {
  it('uploads an oversized revision without its replay, identically on every retry', () => {
    const large = workspaceRevision();
    const run = large.content.result!.run!;
    run.stdout = 'x'.repeat(MAX_SYNCED_REVISION_BYTES);
    const trimmed = syncableRevision(large);
    expect(trimmed.content).toMatchObject({ result: null, step: 0, bookmarks: [] });
    expect(encodeWorkspace(syncableRevision(large))).toBe(encodeWorkspace(trimmed));
    const small = workspaceRevision();
    expect(syncableRevision(small)).toBe(small);
    const huge = { ...small, content: { ...small.content, result: null } };
    huge.content.cases = Array.from({ length: 12 }, (_, index) => ({
      ...small.content.cases[0],
      id: `case-${index}`,
      expected: 'y'.repeat(190_000),
    }));
    expect(() => syncableRevision(huge)).toThrow('larger than 2 MB');
  });

  it('merges tags without exceeding the limit and keeps the earlier review date', () => {
    expect(
      mergeMeta(
        {
          tags: Array.from({ length: 12 }, (_, i) => `t${i}`),
          needsReview: false,
          reviewBy: '2026-11-01',
        },
        { tags: ['extra'], needsReview: false, reviewBy: '2026-10-01' },
      ),
    ).toMatchObject({ reviewBy: '2026-10-01', tags: expect.not.arrayContaining(['extra']) });
    expect(fromAnotherDevice('x'.repeat(120))).toHaveLength(120);
  });
});
