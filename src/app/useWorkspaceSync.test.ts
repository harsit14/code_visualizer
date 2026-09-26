// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { useCallback, useEffect, useState } from 'react';
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
import { useWorkspaceSync } from './useWorkspaceSync';
import { listWorkspaces, saveWorkspace, type WorkspaceSummary } from './workspaceStore';
import { createWorkspaceSyncApi } from './workspaceSyncClient';
import { workspaceContent } from './workspaceTestFixtures';

vi.mock('../server/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../server/database')>()),
  getDatabase: vi.fn(),
}));

const env = {
  ...TEST_PEPPER_ENV,
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  SUPABASE_URL: 'https://project.supabase.co',
};
let fixture: Awaited<ReturnType<typeof createAccountFixture>>;
let session: string | null = ALICE_TOKEN;
const requests: string[] = [];
const api = createWorkspaceSyncApi(async (input, init) => {
  requests.push(`${init.method} ${input}`);
  const response = await handleAccountApi(
    new Request(`https://app.example${input}`, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string>),
        ...(session ? { Cookie: `cv_session=${session}` } : {}),
      },
    }),
    env,
  );
  return response ?? Response.json({ error: 'API route not found.' }, { status: 404 });
});

type Options = Partial<Parameters<typeof useWorkspaceSync>[0]>;
function useHarness(options: Options) {
  const [items, setItems] = useState<WorkspaceSummary[]>([]);
  const refresh = useCallback(async () => setItems(await listWorkspaces()), []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const sync = useWorkspaceSync({
    items,
    refresh,
    accounts: true,
    known: true,
    online: true,
    api,
    delayMs: 0,
    ...options,
  });
  return { items, refresh, sync };
}
const render = (options: Options = {}) =>
  renderHook((props: Options) => useHarness(props), { initialProps: options });
const syncedBy = (user: string) => fixture.workspaces.filter((row) => row.user_id === user);
let stored: Map<string, string>;

beforeEach(async () => {
  resetRateLimitsForTests();
  stored = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });
  vi.stubGlobal('indexedDB', new IDBFactory());
  fixture = await createAccountFixture();
  vi.mocked(getDatabase).mockReturnValue(fixture.database);
  session = ALICE_TOKEN;
  requests.length = 0;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useWorkspaceSync', () => {
  it('is off by default and uploads nothing until the user opts in', async () => {
    await saveWorkspace('Private until asked', workspaceContent());
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { result } = render();
    await waitFor(() => expect(result.current.sync.mode).toBe('ready'));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.sync.enabled).toBe(false);
    expect(result.current.sync.statusOf(result.current.items[0])).toMatchObject({
      kind: 'local',
      label: 'Local only',
    });
    await act(async () => {
      await result.current.sync.enable();
    });
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining('1 workspace on this device will be uploaded'),
    );
    expect(result.current.sync.enabled).toBe(false);
    expect(requests.filter((request) => request.includes('/api/workspaces'))).toEqual([]);
    expect(fixture.workspaces).toEqual([]);
  });

  it('syncs after confirmation and shows each workspace as synced', async () => {
    await saveWorkspace('Two Sum', workspaceContent());
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { result } = render();
    await waitFor(() => expect(result.current.sync.mode).toBe('ready'));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(async () => {
      await result.current.sync.enable();
    });
    await waitFor(() => expect(result.current.sync.lastSyncedAt).not.toBeNull());
    await waitFor(() =>
      expect(result.current.sync.statusOf(result.current.items[0]).label).toBe('Synced'),
    );
    expect(result.current.sync.account).toEqual({ id: ALICE, email: 'alice@example.com' });
    expect(syncedBy(ALICE)).toHaveLength(1);
    expect(JSON.parse(stored.get('cv-workspace-sync')!)).toMatchObject({
      enabled: true,
      account: { id: ALICE },
    });

    // A later save is picked up without another prompt.
    const [head] = result.current.items;
    await act(async () => {
      await saveWorkspace('Two Sum', { ...workspaceContent(), code: 'print(2)' }, head);
      await result.current.refresh();
    });
    await waitFor(() => expect(syncedBy(ALICE)[0]?.revision).toBe(2));
  });

  it('stops on an account change and never uploads to the new account without asking', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await saveWorkspace('Alice work', workspaceContent());
    const { result } = render();
    await waitFor(() => expect(result.current.sync.mode).toBe('ready'));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(async () => {
      await result.current.sync.enable();
    });
    await waitFor(() => expect(syncedBy(ALICE)).toHaveLength(1));

    session = BOB_TOKEN;
    act(() => window.dispatchEvent(new Event('cv-account-changed')));
    await waitFor(() => expect(result.current.sync.mode).toBe('other-account'));
    expect(result.current.sync.user).toEqual({ id: BOB, email: 'bob@example.com' });
    await act(async () => {
      await saveWorkspace('Written while Bob is signed in', workspaceContent());
      await result.current.refresh();
    });
    const waiting = result.current.items.find((item) => item.name !== 'Alice work')!;
    await waitFor(() =>
      expect(result.current.sync.statusOf(waiting)).toMatchObject({
        kind: 'local',
        detail: expect.stringContaining('different account was signed in'),
      }),
    );
    expect(syncedBy(BOB)).toEqual([]);

    confirm.mockClear();
    await act(async () => {
      await result.current.sync.enable();
    });
    expect(confirm).toHaveBeenCalledWith(
      expect.stringMatching(
        /bob@example.com\?.*1 workspace on this device.*1 workspace synced with another account/,
      ),
    );
    await waitFor(() => expect(syncedBy(BOB)).toHaveLength(1));
    expect(syncedBy(BOB)[0].name).toBe('Written while Bob is signed in');
    expect(syncedBy(ALICE)).toHaveLength(1);
  });

  it('keeps work saved under another account off the library’s account when it returns', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await saveWorkspace('Alice work', workspaceContent());
    const { result } = render();
    await waitFor(() => expect(result.current.sync.mode).toBe('ready'));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(async () => {
      await result.current.sync.enable();
    });
    await waitFor(() => expect(syncedBy(ALICE)).toHaveLength(1));

    session = BOB_TOKEN;
    act(() => window.dispatchEvent(new Event('cv-account-changed')));
    await waitFor(() => expect(result.current.sync.mode).toBe('other-account'));
    const bobs = await saveWorkspace('Bob’s notes', workspaceContent());
    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() => expect(result.current.sync.isLocalOnly(bobs.id)).toBe(true));

    session = ALICE_TOKEN;
    act(() => window.dispatchEvent(new Event('cv-account-changed')));
    await waitFor(() => expect(result.current.sync.mode).toBe('ready'));
    await act(async () => {
      result.current.sync.syncNow();
    });
    await waitFor(() => expect(result.current.sync.phase).toBe('idle'));
    expect(syncedBy(ALICE).map((row) => row.name)).toEqual(['Alice work']);
    expect(result.current.sync.isLocalOnly(bobs.id)).toBe(true);
  });

  it('pauses while signed out and explains static hosts, offline and a missing migration', async () => {
    session = null;
    const signedOut = render();
    await waitFor(() => expect(signedOut.result.current.sync.mode).toBe('signed-out'));
    signedOut.unmount();

    const staticHost = render({ accounts: false, known: true });
    expect(staticHost.result.current.sync.mode).toBe('static');
    staticHost.rerender({ accounts: true, known: true, online: false });
    expect(staticHost.result.current.sync.mode).toBe('offline');
    staticHost.unmount();

    session = ALICE_TOKEN;
    fixture = await createAccountFixture({ workspaceSync: false });
    vi.mocked(getDatabase).mockReturnValue(fixture.database);
    await saveWorkspace('Waiting', workspaceContent());
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const missing = render();
    await waitFor(() => expect(missing.result.current.sync.mode).toBe('ready'));
    await act(async () => {
      await missing.result.current.sync.enable();
    });
    await waitFor(() => expect(missing.result.current.sync.mode).toBe('unavailable'));
  });

  it('respects Keep local only and can remove a workspace from the account', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const kept = await saveWorkspace('Keep here', workspaceContent());
    const shared = await saveWorkspace('Share me', workspaceContent());
    const { result } = render();
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    await act(async () => {
      await result.current.sync.setLocalOnly(kept.id, true);
    });
    await waitFor(() => expect(result.current.sync.mode).toBe('ready'));
    await act(async () => {
      await result.current.sync.enable();
    });
    await waitFor(() => expect(result.current.sync.inAccount(shared.id)).toBe(true));
    expect(syncedBy(ALICE).map((row) => row.id)).toEqual([shared.id]);
    expect(result.current.sync.isLocalOnly(kept.id)).toBe(true);

    const item = result.current.items.find((entry) => entry.id === shared.id)!;
    await act(async () => {
      await result.current.sync.removeFromAccount(item);
    });
    expect(syncedBy(ALICE)[0]).toMatchObject({ deleted_at: expect.any(String) });
    expect(fixture.revisions).toEqual([]);
    expect(result.current.sync.isLocalOnly(shared.id)).toBe(true);
    expect(result.current.sync.inAccount(shared.id)).toBe(false);
    expect(result.current.items).toHaveLength(2);
  });
});
