// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceLibrary } from './useWorkspaceLibrary';
import { serializeWorkspace } from './workspaceFormat';
import { listWorkspaces, readWorkspace, saveWorkspace } from './workspaceStore';
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
    expect(payload.workspace.content).toEqual(content);
    expect(result.current.dirty).toBe(true);
    expect(result.current.error).toBeNull();
    act(() => vi.runAllTimers());
    vi.useRealTimers();
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });
});
