// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceLibrary } from './useWorkspaceLibrary';
import { serializeLibraryArchive } from './workspaceArchive';
import { serializeWorkspace, type WorkspaceContent } from './workspaceFormat';
import {
  autosaveWorkspace,
  listWorkspaces,
  readAutosave,
  readWorkspace,
  saveWorkspace,
  updateWorkspaceMeta,
} from './workspaceStore';
import { workspaceContent, workspaceRevision } from './workspaceTestFixtures';

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const backupFile = (text: string) => ({ size: text.length, text: async () => text }) as File;

describe('workspace recovery workflow', () => {
  it('reports unsaved edits and saves a new revision after restoring an old one', async () => {
    const first = await saveWorkspace('Exercise', workspaceContent());
    await saveWorkspace('Exercise', { ...workspaceContent(), code: 'print(2)' }, first);
    const onRestore = vi.fn();
    const { result, rerender } = renderHook(
      ({ content }) => useWorkspaceLibrary(content, onRestore, vi.fn()),
      { initialProps: { content: workspaceContent() } },
    );
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(async () => {
      await result.current.open(first.id, 1);
    });
    rerender({ content: onRestore.mock.calls[0][0] });
    expect(result.current.dirty).toBe(true);
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.active?.revision).toBe(3);
    expect(result.current.dirty).toBe(false);
    expect((await readWorkspace(first.id, 2)).content.code).toBe('print(2)');
    rerender({ content: { ...onRestore.mock.calls[0][0], code: 'print(3)' } });
    expect(result.current.dirty).toBe(true);
  });
  it('detaches a replaced workspace so the next save starts a new one', async () => {
    const original = await saveWorkspace('Original', workspaceContent());
    const onRestore = vi.fn();
    const { result } = renderHook(() =>
      useWorkspaceLibrary(workspaceContent(), onRestore, vi.fn()),
    );
    await act(async () => {
      await result.current.open(original.id, 1);
    });
    expect(result.current.active?.id).toBe(original.id);
    act(() => result.current.detach());
    expect(result.current.active).toBeNull();
    expect(result.current.name).toBe('Untitled workspace');
    expect(result.current.dirty).toBe(true);
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.active?.id).not.toBe(original.id);
    expect(result.current.active?.revision).toBe(1);
    const heads = await listWorkspaces();
    expect(heads).toHaveLength(2);
    expect(heads.find((head) => head.id === original.id)?.revision).toBe(1);
  });
  it('imports a backup as a new identity, never replacing an existing workspace', async () => {
    const original = await saveWorkspace('Original', workspaceContent());
    const onRestore = vi.fn();
    const { result } = renderHook(() =>
      useWorkspaceLibrary(workspaceContent(), onRestore, vi.fn()),
    );
    await act(async () => {
      await result.current.restore(backupFile(serializeWorkspace(original)));
    });
    expect(onRestore).toHaveBeenCalledOnce();
    expect(result.current.active?.id).not.toBe(original.id);
    expect(await listWorkspaces()).toHaveLength(2);
  });
  it('rejects corrupt files without replacing the editor or writing a record', async () => {
    const onRestore = vi.fn();
    const { result } = renderHook(() =>
      useWorkspaceLibrary(workspaceContent(), onRestore, vi.fn()),
    );
    await act(async () => {
      await result.current.restore(backupFile('{'));
    });
    expect(result.current.error).toContain('valid JSON');
    expect(onRestore).not.toHaveBeenCalled();
    expect(await listWorkspaces()).toEqual([]);
  });
  it('keeps edits made while a backup is being read', async () => {
    let finish!: (text: string) => void;
    const file = {
      size: 100,
      text: () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    } as File;
    const onRestore = vi.fn();
    const { result, rerender } = renderHook(
      ({ content }) => useWorkspaceLibrary(content, onRestore, vi.fn()),
      { initialProps: { content: workspaceContent() } },
    );
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.restore(file);
    });
    rerender({ content: { ...workspaceContent(), code: 'new edit' } });
    await act(async () => {
      finish(serializeWorkspace(workspaceRevision()));
      await pending;
    });
    expect(result.current.error).toContain('editor changed');
    expect(onRestore).not.toHaveBeenCalled();
    expect(await listWorkspaces()).toEqual([]);
  });
  it('surfaces unavailable storage, retains unsaved changes and supports retry', async () => {
    const content = workspaceContent();
    const onSaved = vi.fn();
    const { result } = renderHook(() => useWorkspaceLibrary(content, vi.fn(), onSaved));
    vi.stubGlobal('indexedDB', undefined);
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.error).toBeTruthy();
    expect(result.current.dirty).toBe(true);
    expect(onSaved).not.toHaveBeenCalled();
    vi.stubGlobal('indexedDB', new IDBFactory());
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.dirty).toBe(false);
    expect(onSaved).toHaveBeenCalledOnce();
  });
});

describe('workspace export', () => {
  it('exports all current unsaved fields without requiring local storage or clearing dirty state', async () => {
    const { Blob: NativeBlob } = await import('node:buffer');
    vi.stubGlobal('Blob', NativeBlob);
    const create = vi.fn((blob: Blob) => (blob.size ? 'blob:workspace-backup' : ''));
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = create;
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const content = workspaceContent();
    const { result } = renderHook(() => useWorkspaceLibrary(content, vi.fn(), vi.fn(), false));
    vi.stubGlobal('indexedDB', undefined);
    vi.useFakeTimers();
    act(() => result.current.exportBackup());
    expect(click).toHaveBeenCalledOnce();
    const blob = create.mock.calls[0][0] as unknown as Blob;
    const payload = JSON.parse(await blob.text());
    expect(payload.version).toBe(2);
    expect(payload.meta).toEqual({ tags: [], needsReview: false, reviewBy: null });
    expect(payload.workspace.content).toEqual(content);
    expect(result.current.dirty).toBe(true);
    expect(result.current.error).toBeNull();
    act(() => vi.runAllTimers());
    vi.useRealTimers();
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });
});

const edited = (code = 'print("edited")'): WorkspaceContent => ({ ...workspaceContent(), code });

/** Opens revision 1 in a fresh hook, as a tab would after a reload. */
async function openInTab(id: string, autosaveDelayMs = 5) {
  const onRestore = vi.fn();
  const hook = renderHook(
    ({ content }) => useWorkspaceLibrary(content, onRestore, vi.fn(), true, { autosaveDelayMs }),
    { initialProps: { content: workspaceContent() } },
  );
  await act(async () => {
    await hook.result.current.open(id, 1);
  });
  hook.rerender({ content: onRestore.mock.calls[0][0] });
  return { ...hook, onRestore };
}

describe('workspace autosave', () => {
  it('autosaves edits into one slot, then folds it into the next explicit revision', async () => {
    const first = await saveWorkspace('Exercise', workspaceContent());
    const { result, rerender } = await openInTab(first.id);
    expect(result.current.autosave).toBeNull();
    rerender({ content: edited() });
    await waitFor(() => expect(result.current.autosaveState.phase).toBe('saved'));
    expect(result.current.autosave?.text).toMatch(/^Autosaved /);
    expect((await readAutosave(first.id))?.workspace.content.code).toBe('print("edited")');
    expect((await listWorkspaces())[0].revision).toBe(1);
    expect(result.current.items[0].autosave).not.toBeNull();
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.active?.revision).toBe(2);
    expect(await readAutosave(first.id)).toBeNull();
    expect(result.current.autosave).toBeNull();
  });
  it('never autosaves untitled drafts', async () => {
    const { result, rerender } = renderHook(
      ({ content }) => useWorkspaceLibrary(content, vi.fn(), vi.fn(), true, { autosaveDelayMs: 1 }),
      { initialProps: { content: workspaceContent() } },
    );
    rerender({ content: edited() });
    await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
    expect(result.current.autosave).toBeNull();
    expect(await listWorkspaces()).toEqual([]);
  });
  it('offers a newer autosave on reopen and restores it without running code', async () => {
    const first = await saveWorkspace('Exercise', workspaceContent());
    await autosaveWorkspace('Exercise draft', edited(), first, null);
    const { result, rerender, onRestore } = await openInTab(first.id);
    expect(result.current.offer?.info.name).toBe('Exercise draft');
    expect(result.current.autosave?.text).toContain('restore or discard');
    // Nothing is written while the offer waits for a decision.
    rerender({ content: edited('print("other")') });
    await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
    expect((await readAutosave(first.id))?.workspace.content.code).toBe('print("edited")');
    rerender({ content: onRestore.mock.calls[0][0] });

    await act(async () => {
      await result.current.restoreAutosave();
    });
    expect(onRestore).toHaveBeenLastCalledWith(
      expect.objectContaining({ code: 'print("edited")' }),
    );
    rerender({ content: onRestore.mock.calls[1][0] });
    expect(result.current.name).toBe('Exercise draft');
    expect(result.current.dirty).toBe(true);
    expect(result.current.offer).toBeNull();
    await act(async () => {
      await result.current.save();
    });
    expect((await readWorkspace(first.id, 2)).content.code).toBe('print("edited")');
    expect(await readAutosave(first.id)).toBeNull();
  });
  it('discards the offered autosave after confirmation', async () => {
    const first = await saveWorkspace('Exercise', workspaceContent());
    await autosaveWorkspace('Exercise', edited(), first, null);
    const { result } = await openInTab(first.id);
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    await act(async () => {
      await result.current.discardAutosave();
    });
    expect(await readAutosave(first.id)).not.toBeNull();
    await act(async () => {
      await result.current.discardAutosave();
    });
    expect(result.current.offer).toBeNull();
    expect(await readAutosave(first.id)).toBeNull();
  });
  it('stops a stale tab instead of autosaving over a newer revision', async () => {
    const first = await saveWorkspace('Exercise', workspaceContent());
    const tabA = await openInTab(first.id);
    const tabB = await openInTab(first.id);
    tabA.rerender({ content: edited('print("a")') });
    await act(async () => {
      await tabA.result.current.save();
    });
    tabB.rerender({ content: edited('print("b")') });
    await waitFor(() => expect(tabB.result.current.autosaveState.phase).toBe('conflict'));
    expect(tabB.result.current.autosave).toMatchObject({ alert: true, retry: false });
    expect(tabB.result.current.autosave?.text).toContain('another tab');
    expect(await readAutosave(first.id)).toBeNull();
    expect((await readWorkspace(first.id, 2)).content.code).toBe('print("a")');
  });
  it('keeps another tab’s newer autosave instead of replacing it', async () => {
    const first = await saveWorkspace('Exercise', workspaceContent());
    const tabA = await openInTab(first.id);
    const tabB = await openInTab(first.id);
    tabA.rerender({ content: edited('print("a")') });
    await waitFor(() => expect(tabA.result.current.autosaveState.phase).toBe('saved'));
    tabB.rerender({ content: edited('print("b")') });
    await waitFor(() => expect(tabB.result.current.autosaveState.phase).toBe('conflict'));
    expect((await readAutosave(first.id))?.workspace.content.code).toBe('print("a")');
  });
  it('flushes pending edits on page hide and when the workspace is replaced', async () => {
    const first = await saveWorkspace('Exercise', workspaceContent());
    const { result, rerender } = await openInTab(first.id, 60_000);
    rerender({ content: edited() });
    expect(result.current.autosave?.text).toBe('Autosave pending…');
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    await waitFor(async () =>
      expect((await readAutosave(first.id))?.workspace.content.code).toBe('print("edited")'),
    );
    rerender({ content: edited('print("last")') });
    act(() => result.current.detach());
    await waitFor(async () =>
      expect((await readAutosave(first.id))?.workspace.content.code).toBe('print("last")'),
    );
    expect(result.current.autosave).toBeNull();
  });
  it('reports a failed autosave and retries it', async () => {
    const first = await saveWorkspace('Exercise', workspaceContent());
    const { result, rerender } = await openInTab(first.id);
    const factory = indexedDB;
    vi.stubGlobal('indexedDB', undefined);
    rerender({ content: edited() });
    await waitFor(() => expect(result.current.autosave?.text).toBe('Autosave failed — retry'));
    expect(result.current.autosave?.retry).toBe(true);
    vi.stubGlobal('indexedDB', factory);
    await act(async () => {
      await result.current.retryAutosave();
    });
    expect(result.current.autosaveState.phase).toBe('saved');
    expect(await readAutosave(first.id)).not.toBeNull();
  });
});

describe('workspace tags and archives', () => {
  it('edits tags as metadata and refreshes after another tab changed them', async () => {
    const first = await saveWorkspace('Exercise', workspaceContent());
    const onRestore = vi.fn();
    const { result } = renderHook(() =>
      useWorkspaceLibrary(workspaceContent(), onRestore, vi.fn()),
    );
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(async () => {
      await result.current.updateMeta(first.id, { tags: ['Two Pointers'] });
    });
    expect(result.current.items[0]).toMatchObject({ tags: ['two pointers'], revision: 1 });
    await updateWorkspaceMeta(first.id, 1, { tags: [], needsReview: true, reviewBy: null });
    await act(async () => {
      await result.current.updateMeta(first.id, { tags: ['dp'] });
    });
    expect(result.current.error).toContain('another tab');
    expect(result.current.items[0]).toMatchObject({ tags: [], needsReview: true });
    expect(onRestore).not.toHaveBeenCalled();
  });
  it('restores tags from version 2 backups', async () => {
    const { result } = renderHook(() => useWorkspaceLibrary(workspaceContent(), vi.fn(), vi.fn()));
    const meta = { tags: ['bfs'], needsReview: true, reviewBy: null };
    await act(async () => {
      await result.current.restore(backupFile(serializeWorkspace(workspaceRevision(), meta)));
    });
    expect(result.current.items[0]).toMatchObject(meta);
  });
  it('imports valid archive workspaces without touching the editor and reports skips', async () => {
    const onRestore = vi.fn();
    const { result } = renderHook(() =>
      useWorkspaceLibrary(workspaceContent(), onRestore, vi.fn()),
    );
    const payload = JSON.parse(
      serializeLibraryArchive(
        [
          {
            meta: { tags: ['dp'], needsReview: false, reviewBy: null },
            revisions: [workspaceRevision()],
            autosave: null,
          },
          {
            meta: { tags: [], needsReview: false, reviewBy: null },
            revisions: [workspaceRevision()],
            autosave: null,
          },
        ],
        false,
      ),
    );
    payload.workspaces[1].revisions[0].content.code = 42;
    await act(async () => {
      await result.current.importArchive(backupFile(JSON.stringify(payload)));
    });
    expect(onRestore).not.toHaveBeenCalled();
    expect(result.current.active).toBeNull();
    expect(result.current.items).toHaveLength(1);
    expect(result.current.notice).toContain('Imported 1 workspace with 1 revision');
    expect(result.current.notice).toContain('Skipped 1: 0 already in the library, 1 invalid');
  });
  it('exports the whole library including pending autosaves', async () => {
    const { Blob: NativeBlob } = await import('node:buffer');
    vi.stubGlobal('Blob', NativeBlob);
    const create = vi.fn(() => 'blob:library');
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = create;
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const first = await saveWorkspace('Exercise', workspaceContent());
    const { result, rerender } = await openInTab(first.id, 60_000);
    rerender({ content: edited() });
    await act(async () => {
      await result.current.exportArchive(true);
    });
    expect(click).toHaveBeenCalledOnce();
    const payload = JSON.parse(await (create.mock.calls[0] as unknown as [Blob])[0].text());
    expect(payload).toMatchObject({ format: 'code-visualizer-library', history: true });
    expect(payload.workspaces[0].autosave.content.code).toBe('print("edited")');
    expect(result.current.notice).toContain('1 workspace, 1 revision, 1 autosave');
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });
});
