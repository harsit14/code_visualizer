// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { useWorkspaceLibrary } from '../app/useWorkspaceLibrary';
import type { WorkspaceSyncState, WorkspaceSyncView } from '../app/useWorkspaceSync';
import type { WorkspaceSummary } from '../app/workspaceStore';
import { WorkspaceLibrary } from './WorkspaceLibrary';

afterEach(cleanup);

type Library = ReturnType<typeof useWorkspaceLibrary>;
const summary = (overrides: Partial<WorkspaceSummary>): WorkspaceSummary => ({
  id: 'id',
  name: 'Workspace',
  revision: 1,
  savedAt: 1,
  language: 'python',
  source: '',
  tags: [],
  needsReview: false,
  reviewBy: null,
  metaRevision: 0,
  autosave: null,
  ...overrides,
});
const items = [
  summary({ id: 'sum', name: 'Two Sum', savedAt: 30, tags: ['hash map'], source: 'seen = {}' }),
  summary({
    id: 'window',
    name: 'Max window',
    savedAt: 20,
    language: 'javascript',
    tags: ['sliding window'],
    source: 'let best = 0;',
    needsReview: true,
  }),
  summary({ id: 'search', name: 'Binary search', savedAt: 10, source: 'lo = 0' }),
];

const syncView = (overrides: Partial<WorkspaceSyncView> = {}): WorkspaceSyncView => ({
  mode: 'ready',
  enabled: false,
  account: null,
  user: { id: 'me', email: 'me@example.com' },
  phase: 'idle',
  error: null,
  notice: '',
  lastSyncedAt: null,
  statusOf: () => ({ kind: 'local', label: 'Local only', detail: null }),
  isLocalOnly: () => false,
  inAccount: () => false,
  enable: vi.fn(async () => {}),
  disable: vi.fn(),
  syncNow: vi.fn(),
  setLocalOnly: vi.fn(async () => {}),
  dismissIssue: vi.fn(async () => {}),
  removeFromAccount: vi.fn(async () => {}),
  ...overrides,
});

function renderLibrary(overrides: Partial<Library> = {}, sync?: WorkspaceSyncView) {
  const library = {
    active: null,
    items,
    name: 'Untitled workspace',
    setName: vi.fn(),
    dirty: true,
    busy: false,
    error: null,
    notice: '',
    refresh: vi.fn(async () => {}),
    save: vi.fn(async () => {}),
    open: vi.fn(async () => {}),
    restore: vi.fn(async () => {}),
    exportBackup: vi.fn(),
    confirmReplace: vi.fn(() => true),
    detach: vi.fn(),
    offer: null,
    restoreAutosave: vi.fn(async () => {}),
    discardAutosave: vi.fn(async () => {}),
    autosave: null,
    autosaveState: { phase: 'idle' },
    retryAutosave: vi.fn(async () => {}),
    updateMeta: vi.fn(async () => {}),
    exportArchive: vi.fn(async () => {}),
    importArchive: vi.fn(async () => {}),
    notebookPatterns: '',
    ...overrides,
  } as Library;
  render(<WorkspaceLibrary library={library} sync={sync} />);
  return library;
}
const resultNames = () =>
  within(screen.getByRole('group', { name: 'Choose a saved workspace' }))
    .getAllByRole('radio')
    .map((radio) => radio.closest('label')?.querySelector('.workspace-result-name')?.textContent);

describe('WorkspaceLibrary', () => {
  it('searches names, tags and code, and shows an empty state with a reset', () => {
    renderLibrary();
    expect(resultNames()).toEqual(['Two Sum', 'Max window', 'Binary search']);
    const search = screen.getByRole('searchbox', { name: 'Search workspaces' });
    fireEvent.change(search, { target: { value: 'seen' } });
    expect(resultNames()).toEqual(['Two Sum']);
    fireEvent.change(search, { target: { value: 'sliding' } });
    expect(resultNames()).toEqual(['Max window']);
    fireEvent.change(search, { target: { value: 'nothing like this' } });
    expect(screen.getByText('No workspaces match this search and filter.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search and filters' }));
    expect(resultNames()).toHaveLength(3);
  });
  it('filters by language, tag and review state, and sorts by name', () => {
    renderLibrary();
    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), {
      target: { value: 'javascript' },
    });
    expect(resultNames()).toEqual(['Max window']);
    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), {
      target: { value: '' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Tag' }), {
      target: { value: 'hash map' },
    });
    expect(resultNames()).toEqual(['Two Sum']);
    fireEvent.change(screen.getByRole('combobox', { name: 'Tag' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Due for review' }));
    expect(resultNames()).toEqual(['Max window']);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Due for review' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort' }), {
      target: { value: 'name' },
    });
    expect(resultNames()).toEqual(['Binary search', 'Max window', 'Two Sum']);
  });
  it('opens a chosen revision and edits its tags and review state as metadata', () => {
    const library = renderLibrary({ notebookPatterns: 'binary search on the answer' });
    fireEvent.click(screen.getByRole('radio', { name: /Binary search/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Open revision' }));
    expect(library.open).toHaveBeenCalledWith('search', 1);
    fireEvent.change(screen.getByRole('combobox', { name: 'New tag' }), {
      target: { value: '  Two-Pointer ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    expect(library.updateMeta).toHaveBeenLastCalledWith('search', { tags: ['two pointers'] });
    fireEvent.click(screen.getByRole('button', { name: 'Add tag bfs' }));
    expect(library.updateMeta).toHaveBeenLastCalledWith('search', { tags: ['bfs'] });
    fireEvent.change(screen.getByRole('combobox', { name: 'New tag' }), {
      target: { value: '<nope>' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    expect(screen.getByRole('alert').textContent).toContain('letters, numbers');
    expect(library.updateMeta).toHaveBeenCalledTimes(2);
    const review = screen.getByRole('checkbox', { name: 'Needs review' });
    fireEvent.click(review);
    expect(library.updateMeta).toHaveBeenLastCalledWith('search', { needsReview: true });
    fireEvent.change(screen.getByLabelText('Review by'), { target: { value: '2026-10-01' } });
    expect(library.updateMeta).toHaveBeenLastCalledWith('search', { reviewBy: '2026-10-01' });
  });
  it('ranks suggestions from the open workspace notebook and removes tags', () => {
    const library = renderLibrary({
      active: { id: 'sum', name: 'Two Sum', revision: 1 },
      notebookPatterns: 'Uses a heap',
    });
    const suggestions = within(screen.getByRole('group', { name: 'Suggested pattern tags' }));
    expect(suggestions.getAllByRole('button')[0].textContent).toBe('+ heap');
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag hash map' }));
    expect(library.updateMeta).toHaveBeenCalledWith('sum', { tags: [] });
  });
  it('offers restoring or discarding a newer autosave and shows autosave status', () => {
    const library = renderLibrary({
      active: { id: 'sum', name: 'Two Sum', revision: 3 },
      offer: {
        id: 'sum',
        headRevision: 3,
        info: { token: 't', savedAt: 0, baseRevision: 2, name: 'Two Sum' },
        opened: { key: '', name: 'Two Sum', result: null },
      },
      autosave: { text: 'Autosave failed — retry', alert: true, retry: true },
    });
    expect(screen.getByText(/started from revision 2; revision 3 is newer/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restore autosave' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard autosave' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry autosave' }));
    expect(library.restoreAutosave).toHaveBeenCalledOnce();
    expect(library.discardAutosave).toHaveBeenCalledOnce();
    expect(library.retryAutosave).toHaveBeenCalledOnce();
    expect(screen.getByRole('alert').textContent).toContain('Autosave failed');
  });
  it('explains an empty library and exports or imports archives', () => {
    const library = renderLibrary({ items: [] });
    expect(screen.getByText(/No saved workspaces yet/)).toBeTruthy();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(
      (screen.getByRole('button', { name: 'Export library' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    const upload = new File(['{}'], 'library.cvlibrary.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText('Import library archive file'), {
      target: { files: [upload] },
    });
    expect(library.importArchive).toHaveBeenCalledWith(upload);
  });
  it('exports every revision when requested', () => {
    const library = renderLibrary();
    fireEvent.click(screen.getByRole('checkbox', { name: /Include every revision/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Export library' }));
    expect(library.exportArchive).toHaveBeenCalledWith(true);
  });
});

describe('WorkspaceLibrary account sync', () => {
  const heading = () => screen.queryByText('Account sync', { selector: 'strong' });

  it('is hidden on static hosts and explains why it is paused elsewhere', () => {
    renderLibrary({}, syncView({ mode: 'static' }));
    expect(heading()).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /Two Sum/ }));
    expect(screen.queryByRole('checkbox', { name: 'Keep local only' })).toBeNull();
    cleanup();

    renderLibrary({}, syncView({ mode: 'unavailable' }));
    expect(screen.getByText(/not available on this server yet/)).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: /Sync this library/ })).toBeNull();
    cleanup();

    renderLibrary({}, syncView({ mode: 'offline', enabled: true }));
    expect(screen.getByText(/sync resumes when you reconnect/)).toBeTruthy();
    cleanup();

    renderLibrary(
      {},
      syncView({ mode: 'signed-out', enabled: true, account: { id: 'a', email: 'a@example.com' } }),
    );
    expect(screen.getByText(/Sign in as a@example.com to keep syncing/)).toBeTruthy();
  });

  it('asks before syncing with a different signed-in account', () => {
    const sync = syncView({
      mode: 'other-account',
      enabled: true,
      account: { id: 'a', email: 'a@example.com' },
      user: { id: 'b', email: 'b@example.com' },
    });
    renderLibrary({}, sync);
    expect(
      screen.getByText(/syncs with a@example.com. You are signed in as b@example.com/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sync with b@example.com instead' }));
    expect(sync.enable).toHaveBeenCalledOnce();
  });

  it('turns library sync on and off and shows the last sync', () => {
    const off = syncView();
    renderLibrary({}, off);
    const toggle = screen.getByRole('checkbox', { name: 'Sync this library with my account' });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    fireEvent.click(toggle);
    expect(off.enable).toHaveBeenCalledOnce();
    cleanup();

    const on = syncView({
      enabled: true,
      account: { id: 'me', email: 'me@example.com' },
      lastSyncedAt: new Date(2026, 8, 26, 14, 2).getTime(),
    });
    renderLibrary({}, on);
    expect(screen.getByText(/Last synced/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    expect(on.syncNow).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Sync this library with my account' }));
    expect(on.disable).toHaveBeenCalledOnce();
    cleanup();

    const failed = syncView({ enabled: true, phase: 'failed', error: 'Server unreachable.' });
    renderLibrary({}, failed);
    expect(screen.getByRole('alert').textContent).toContain('Sync failed: Server unreachable.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry sync' }));
    expect(failed.syncNow).toHaveBeenCalledOnce();
  });

  it('shows each workspace’s state with Retry, Dismiss, Keep local only and removal', () => {
    const states: Record<string, WorkspaceSyncState> = {
      sum: { kind: 'synced', label: 'Synced', detail: null },
      window: { kind: 'failed', label: 'Sync failed', detail: 'Too large.' },
      search: { kind: 'conflict', label: 'Conflict', detail: 'Both are kept.' },
    };
    const sync = syncView({
      enabled: true,
      account: { id: 'me', email: 'me@example.com' },
      statusOf: (item) => states[item.id],
      isLocalOnly: (id) => id === 'search',
      inAccount: (id) => id === 'sum',
    });
    renderLibrary({ active: { id: 'sum', name: 'Two Sum', revision: 1 }, dirty: false }, sync);
    expect(screen.getByText('Local saved · revision 1 · Synced')).toBeTruthy();
    const meta = screen.getAllByText(/· r1 ·/).map((node) => node.textContent);
    expect(meta).toEqual([
      expect.stringContaining('synced'),
      expect.stringContaining('sync failed'),
      expect.stringContaining('conflict'),
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Remove from account' }));
    expect(sync.removeFromAccount).toHaveBeenCalledWith(items[0]);

    fireEvent.click(screen.getByRole('radio', { name: /Max window/ }));
    expect(screen.getByRole('alert').textContent).toContain('Sync failed. Too large.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry sync' }));
    expect(sync.syncNow).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Keep local only' }));
    expect(sync.setLocalOnly).toHaveBeenCalledWith('window', true);
    expect(screen.queryByRole('button', { name: 'Remove from account' })).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: /Binary search/ }));
    expect(screen.getByRole('alert').textContent).toContain('Conflict. Both are kept.');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(sync.dismissIssue).toHaveBeenCalledWith('search');
    const keep = screen.getByRole('checkbox', { name: 'Keep local only' }) as HTMLInputElement;
    expect(keep.checked).toBe(true);
    fireEvent.click(keep);
    expect(sync.setLocalOnly).toHaveBeenLastCalledWith('search', false);
  });
});
