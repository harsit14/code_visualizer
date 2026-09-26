import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { parseLibraryArchive } from './workspaceArchive';
import {
  AutosaveConflictError,
  autosaveWorkspace,
  DB_VERSION,
  discardAutosave,
  exportLibrary,
  importLibrary,
  listWorkspaces,
  readAutosave,
  readWorkspace,
  saveWorkspace,
  updateWorkspaceMeta,
  WorkspaceConflictError,
  WorkspaceMetaConflictError,
} from './workspaceStore';
import { workspaceContent, workspaceRevision } from './workspaceTestFixtures';

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
      {
        id: first.id,
        name: 'Renamed',
        revision: 2,
        savedAt: second.savedAt,
        language: 'python',
        source: 'print(2)',
        tags: [],
        needsReview: false,
        reviewBy: null,
        metaRevision: 0,
        autosave: null,
      },
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

/** Builds the version 1 database exactly as the previous release created it. */
function createVersionOneDatabase(records: { head: object; text: string }[]) {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('cv-workspaces-v1', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('heads', { keyPath: 'id' });
      request.result.createObjectStore('revisions', { keyPath: ['id', 'revision'] });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const tx = request.result.transaction(['heads', 'revisions'], 'readwrite');
      for (const { head, text } of records) {
        tx.objectStore('heads').put(head);
        const { id, revision } = head as { id: string; revision: number };
        tx.objectStore('revisions').put({ id, revision, text });
      }
      tx.oncomplete = () => {
        request.result.close();
        resolve();
      };
    };
  });
}

describe('schema upgrade', () => {
  it('upgrades version 1 heads with search fields and empty metadata, keeping revisions', async () => {
    const v1 = workspaceRevision();
    await createVersionOneDatabase([
      {
        head: { id: v1.id, name: v1.name, revision: 1, savedAt: v1.savedAt },
        text: JSON.stringify({ format: 'code-visualizer-workspace', version: 1, workspace: v1 }),
      },
      {
        head: { id: 'damaged', name: 'Damaged', revision: 1, savedAt: 1 },
        text: '{not json',
      },
    ]);
    expect(DB_VERSION).toBe(2);
    const heads = await listWorkspaces();
    expect(heads).toEqual([
      {
        id: v1.id,
        name: v1.name,
        revision: 1,
        savedAt: v1.savedAt,
        language: 'python',
        source: 'print(1)',
        tags: [],
        needsReview: false,
        reviewBy: null,
        metaRevision: 0,
        autosave: null,
      },
      expect.objectContaining({ id: 'damaged', language: null, source: '', tags: [] }),
    ]);
    expect(await readWorkspace(v1.id, 1)).toEqual(v1);
    const next = await saveWorkspace('Upgraded', workspaceContent(), heads[0]);
    expect(next.revision).toBe(2);
    expect(await readAutosave(v1.id)).toBeNull();
  });
});

describe('workspace metadata', () => {
  it('edits tags and review state without creating a revision', async () => {
    const first = await saveWorkspace('Tagged', workspaceContent(), undefined, {
      meta: { tags: ['dp'], needsReview: false, reviewBy: null },
    });
    const updated = await updateWorkspaceMeta(first.id, 0, {
      tags: ['DP', 'Sliding Window'],
      needsReview: true,
      reviewBy: '2026-10-01',
    });
    expect(updated).toMatchObject({
      revision: 1,
      tags: ['dp', 'sliding window'],
      needsReview: true,
      reviewBy: '2026-10-01',
      metaRevision: 1,
    });
    expect((await listWorkspaces())[0]).toEqual(updated);
    await expect(readWorkspace(first.id, 2)).rejects.toThrow();
    // A stale tab still holding metaRevision 0 cannot overwrite the newer tags.
    await expect(
      updateWorkspaceMeta(first.id, 0, { tags: [], needsReview: false, reviewBy: null }),
    ).rejects.toBeInstanceOf(WorkspaceMetaConflictError);
    // Saving a revision keeps the tags.
    await saveWorkspace('Tagged', workspaceContent(), first);
    expect((await listWorkspaces())[0]).toMatchObject({
      revision: 2,
      tags: ['dp', 'sliding window'],
    });
  });
});

describe('autosave slot', () => {
  it('replaces one slot per workspace and folds it into the next explicit save', async () => {
    const first = await saveWorkspace('Auto', workspaceContent());
    const edited = { ...workspaceContent(), code: 'print("draft")' };
    const one = await autosaveWorkspace('Auto', edited, first, null);
    const two = await autosaveWorkspace('Auto renamed', edited, first, one.token);
    expect(two).toMatchObject({ baseRevision: 1, name: 'Auto renamed' });
    const found = await readAutosave(first.id);
    expect(found?.info).toEqual(two);
    expect(found?.workspace.content.code).toBe('print("draft")');
    expect((await listWorkspaces())[0]).toMatchObject({ revision: 1, autosave: two });

    await saveWorkspace('Auto', edited, first, { autosaveToken: two.token });
    expect(await readAutosave(first.id)).toBeNull();
    expect((await listWorkspaces())[0]).toMatchObject({ revision: 2, autosave: null });
  });
  it('rejects stale tabs instead of clobbering a newer revision or autosave', async () => {
    const first = await saveWorkspace('Shared', workspaceContent());
    const tabA = await autosaveWorkspace('Shared', workspaceContent(), first, null);
    // Tab B opened before tab A autosaved, so it still expects an empty slot.
    await expect(
      autosaveWorkspace('Shared', { ...workspaceContent(), code: 'b' }, first, null),
    ).rejects.toBeInstanceOf(AutosaveConflictError);
    // Tab B's explicit save succeeds but leaves tab A's autosave for review.
    const second = await saveWorkspace('Shared', workspaceContent(), first, {
      autosaveToken: null,
    });
    expect((await readAutosave(first.id))?.info).toEqual(tabA);
    // Tab A is now behind the head revision.
    await expect(
      autosaveWorkspace('Shared', workspaceContent(), first, tabA.token),
    ).rejects.toBeInstanceOf(WorkspaceConflictError);
    await expect(discardAutosave(first.id, 'someone-else')).rejects.toBeInstanceOf(
      AutosaveConflictError,
    );
    await discardAutosave(first.id, tabA.token);
    expect(await readAutosave(first.id)).toBeNull();
    expect((await listWorkspaces())[0]).toMatchObject({
      revision: second.revision,
      autosave: null,
    });
  });
});

describe('library archive storage', () => {
  it('exports latest revisions with tags and autosaves, and imports them under fresh IDs', async () => {
    const first = await saveWorkspace('Alpha', workspaceContent(), undefined, {
      meta: { tags: ['bfs'], needsReview: true, reviewBy: null },
    });
    await saveWorkspace('Alpha', { ...workspaceContent(), code: 'print(2)' }, first);
    await autosaveWorkspace(
      'Alpha',
      { ...workspaceContent(), code: 'print(3)' },
      { id: first.id, revision: 2 },
      null,
    );
    await saveWorkspace('Beta', {
      ...workspaceContent(),
      language: 'javascript',
      code: 'console.log(1)',
      result: null,
      step: 0,
      bookmarks: [],
    });

    const latest = await exportLibrary(false);
    expect(latest).toMatchObject({
      workspaces: 2,
      revisions: 2,
      autosaves: 1,
      history: false,
      damaged: 0,
    });
    const full = await exportLibrary(true);
    expect(full).toMatchObject({ workspaces: 2, revisions: 3, history: true });

    const { entries, skipped } = parseLibraryArchive(full.text);
    expect(skipped).toEqual([]);
    const alpha = entries.find((entry) => entry.revisions[0].name === 'Alpha')!;
    expect(alpha.meta).toEqual({ tags: ['bfs'], needsReview: true, reviewBy: null });
    expect(alpha.autosave?.content.code).toBe('print(3)');

    vi.stubGlobal('indexedDB', new IDBFactory());
    expect(await importLibrary(entries)).toEqual({ imported: 2, revisions: 3, duplicates: 0 });
    const heads = await listWorkspaces();
    const imported = heads.find((head) => head.name === 'Alpha')!;
    expect(imported.id).not.toBe(first.id);
    expect(imported).toMatchObject({
      revision: 2,
      tags: ['bfs'],
      needsReview: true,
      source: 'print(2)',
    });
    expect((await readWorkspace(imported.id, 1)).content.code).toBe('print(1)');
    expect((await readAutosave(imported.id))?.workspace.content.code).toBe('print(3)');
    // Re-importing the same archive is harmless.
    expect(await importLibrary(parseLibraryArchive(full.text).entries)).toEqual({
      imported: 0,
      revisions: 0,
      duplicates: 2,
    });
    expect(await listWorkspaces()).toHaveLength(2);

    // Latest-only archives renumber from 1 so every listed revision can be opened.
    vi.stubGlobal('indexedDB', new IDBFactory());
    await importLibrary(parseLibraryArchive(latest.text).entries);
    const renumbered = (await listWorkspaces()).find((head) => head.name === 'Alpha')!;
    expect(renumbered.revision).toBe(1);
    expect((await readWorkspace(renumbered.id, 1)).content.code).toBe('print(2)');
    expect((await readAutosave(renumbered.id))?.info.baseRevision).toBe(1);
  });
  it('writes all archive workspaces or none', async () => {
    await saveWorkspace('One', workspaceContent());
    await saveWorkspace('Two', { ...workspaceContent(), code: 'print(2)' });
    const { entries } = parseLibraryArchive((await exportLibrary(false)).text);
    vi.stubGlobal('indexedDB', new IDBFactory());
    const original = IDBObjectStore.prototype.add;
    let calls = 0;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (
      this: IDBObjectStore,
      value,
      key,
    ) {
      const request = original.call(this, value, key);
      calls += 1;
      if (calls === 2) this.transaction.abort();
      return request;
    });
    await expect(importLibrary(entries)).rejects.toThrow();
    spy.mockRestore();
    expect(await listWorkspaces()).toEqual([]);
  });
});
