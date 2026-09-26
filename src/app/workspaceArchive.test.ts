import { describe, expect, it } from 'vitest';
import {
  MAX_ARCHIVE_BYTES,
  MAX_ARCHIVE_WORKSPACES,
  parseLibraryArchive,
  serializeLibraryArchive,
  type ArchiveEntry,
} from './workspaceArchive';
import { serializeWorkspace } from './workspaceFormat';
import { workspaceRevision } from './workspaceTestFixtures';

const entry = (): ArchiveEntry => ({
  meta: { tags: ['dp'], needsReview: false, reviewBy: null },
  revisions: [workspaceRevision(), { ...workspaceRevision(), revision: 2, savedAt: 456 }],
  autosave: { ...workspaceRevision(), revision: 2, savedAt: 789, name: 'Unsaved name' },
});

describe('library archives', () => {
  it('round trips revisions, autosaves and tags', () => {
    const text = serializeLibraryArchive([entry()], true, 1);
    expect(JSON.parse(text)).toMatchObject({
      format: 'code-visualizer-library',
      version: 1,
      exportedAt: 1,
      history: true,
    });
    expect(parseLibraryArchive(text)).toEqual({ entries: [entry()], skipped: [] });
  });
  it('skips damaged workspaces by name while keeping the valid ones', () => {
    const payload = JSON.parse(serializeLibraryArchive([entry(), entry(), entry()], false));
    payload.workspaces[1].revisions[1].content.notebook.status = 'bogus';
    payload.workspaces[2].revisions.reverse();
    const { entries, skipped } = parseLibraryArchive(JSON.stringify(payload));
    expect(entries).toHaveLength(1);
    expect(skipped).toEqual([
      { index: 1, name: 'My exercise', reason: 'Invalid workspace notebook.' },
      { index: 2, name: 'My exercise', reason: 'Workspace revisions are out of order.' },
    ]);
  });
  it('rejects unusable files before anything is imported', () => {
    expect(() => parseLibraryArchive('{')).toThrow('valid JSON');
    expect(() => parseLibraryArchive(serializeWorkspace(workspaceRevision()))).toThrow(
      'Restore backup',
    );
    const payload = JSON.parse(serializeLibraryArchive([entry()], false));
    expect(() => parseLibraryArchive(JSON.stringify({ ...payload, version: 2 }))).toThrow(
      'Unsupported',
    );
    expect(() => parseLibraryArchive(JSON.stringify({ ...payload, workspaces: [] }))).toThrow(
      'no workspaces',
    );
    const crowded = { ...payload, workspaces: Array(MAX_ARCHIVE_WORKSPACES + 1).fill({}) };
    expect(() => parseLibraryArchive(JSON.stringify(crowded))).toThrow('limited');
    expect(() => parseLibraryArchive(' '.repeat(MAX_ARCHIVE_BYTES + 1))).toThrow('100 MB');
  });
});
