// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { useWorkspaceLibrary } from '../app/useWorkspaceLibrary';
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

function renderLibrary(overrides: Partial<Library> = {}) {
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
  render(<WorkspaceLibrary library={library} />);
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
