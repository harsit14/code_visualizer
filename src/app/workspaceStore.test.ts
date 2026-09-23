import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  listWorkspaces,
  readWorkspace,
  saveWorkspace,
  WorkspaceConflictError,
} from './workspaceStore';
import { workspaceContent } from './workspaceTestFixtures';

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('transactional workspace library', () => {
  it('keeps a stable ID while renaming and preserves immutable older revisions', async () => {
    const first = await saveWorkspace('First', workspaceContent());
    const changed = { ...workspaceContent(), code: 'print(2)' };
    const second = await saveWorkspace('Renamed', changed, first);
    expect(second.id).toBe(first.id);
    expect(second.revision).toBe(2);
    expect(await readWorkspace(first.id, 1)).toEqual(first);
    expect(await readWorkspace(first.id, 2)).toEqual(second);
    expect(await listWorkspaces()).toEqual([
      { id: first.id, name: 'Renamed', revision: 2, savedAt: second.savedAt },
    ]);
  });
  it('allows only one concurrent save from the same base revision', async () => {
    const first = await saveWorkspace('Concurrent', workspaceContent());
    const saves = await Promise.allSettled([
      saveWorkspace('Tab A', workspaceContent(), first),
      saveWorkspace('Tab B', workspaceContent(), first),
    ]);
    expect(saves.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
    expect(saves.find((s) => s.status === 'rejected')).toMatchObject({
      reason: expect.any(WorkspaceConflictError),
    });
    expect((await listWorkspaces())[0].revision).toBe(2);
  });
  it('keeps the last committed head when a transaction aborts', async () => {
    const first = await saveWorkspace('Keep', workspaceContent());
    const original = IDBObjectStore.prototype.add;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (
      this: IDBObjectStore,
      value,
      key,
    ) {
      const request = original.call(this, value, key);
      this.transaction.abort();
      return request;
    });
    await expect(saveWorkspace('Fail', workspaceContent(), first)).rejects.toThrow();
    spy.mockRestore();
    expect((await listWorkspaces())[0].revision).toBe(1);
    expect(await readWorkspace(first.id, 1)).toEqual(first);
    await expect(readWorkspace(first.id, 2)).rejects.toThrow('missing or damaged');
  });
  it('rejects bad content without creating a workspace and reports unavailable storage', async () => {
    await expect(saveWorkspace('', workspaceContent())).rejects.toThrow();
    expect(await listWorkspaces()).toEqual([]);
    vi.stubGlobal('indexedDB', undefined);
    await expect(saveWorkspace('No storage', workspaceContent())).rejects.toThrow();
  });
});
