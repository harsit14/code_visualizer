import { validateWorkspaceRevision, type WorkspaceRevision } from './workspaceFormat';
import { EMPTY_META, parseWorkspaceMeta, type WorkspaceMeta } from './workspaceTags';

export const LIBRARY_FORMAT_VERSION = 1;
export const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
export const MAX_ARCHIVE_WORKSPACES = 1000;
export const MAX_ARCHIVE_REVISIONS = 10_000;

export type ArchiveEntry = {
  meta: WorkspaceMeta;
  /** Oldest first; the last one is the latest revision. */
  revisions: WorkspaceRevision[];
  /** Unsaved edits from the workspace's autosave slot, when one exists. */
  autosave: WorkspaceRevision | null;
};
export type SkippedEntry = { index: number; name: string; reason: string };

const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

export const byteLength = (text: string) => new TextEncoder().encode(text).length;

export function serializeLibraryArchive(
  workspaces: ArchiveEntry[],
  history: boolean,
  exportedAt = Date.now(),
): string {
  return JSON.stringify({
    format: 'code-visualizer-library',
    version: LIBRARY_FORMAT_VERSION,
    exportedAt,
    history,
    workspaces,
  });
}

function parseEntry(value: unknown): ArchiveEntry {
  if (!record(value) || !Array.isArray(value.revisions) || value.revisions.length === 0) {
    throw new Error('Workspace has no revisions.');
  }
  const revisions = value.revisions.map(validateWorkspaceRevision);
  if (revisions.some((r, i) => i > 0 && r.revision <= revisions[i - 1].revision)) {
    throw new Error('Workspace revisions are out of order.');
  }
  return {
    meta: value.meta === undefined ? { ...EMPTY_META, tags: [] } : parseWorkspaceMeta(value.meta),
    revisions,
    autosave:
      value.autosave === null || value.autosave === undefined
        ? null
        : validateWorkspaceRevision(value.autosave),
  };
}

/**
 * Checks the whole archive before anything is written. File-level problems throw;
 * individual damaged workspaces are reported as skipped so the rest can import.
 */
export function parseLibraryArchive(text: string): {
  entries: ArchiveEntry[];
  skipped: SkippedEntry[];
} {
  if (byteLength(text) > MAX_ARCHIVE_BYTES) {
    throw new Error('Library archives must be no larger than 100 MB.');
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('Library archive is not valid JSON.');
  }
  if (!record(value) || value.format === 'code-visualizer-workspace') {
    throw new Error('This is a single workspace backup. Use Restore backup to open it.');
  }
  if (
    value.format !== 'code-visualizer-library' ||
    value.version !== LIBRARY_FORMAT_VERSION ||
    !Array.isArray(value.workspaces)
  ) {
    throw new Error('Unsupported library archive. Choose a version 1 library export.');
  }
  const workspaces = value.workspaces as unknown[];
  if (workspaces.length === 0) throw new Error('This library archive contains no workspaces.');
  const revisionCount = workspaces.reduce<number>(
    (sum, entry) =>
      sum + (record(entry) && Array.isArray(entry.revisions) ? entry.revisions.length : 0),
    0,
  );
  if (workspaces.length > MAX_ARCHIVE_WORKSPACES || revisionCount > MAX_ARCHIVE_REVISIONS) {
    throw new Error(
      `Library archives are limited to ${MAX_ARCHIVE_WORKSPACES} workspaces and ${MAX_ARCHIVE_REVISIONS.toLocaleString('en')} revisions.`,
    );
  }
  const entries: ArchiveEntry[] = [];
  const skipped: SkippedEntry[] = [];
  workspaces.forEach((entry, index) => {
    try {
      entries.push(parseEntry(entry));
    } catch (error) {
      const revisions = record(entry) && Array.isArray(entry.revisions) ? entry.revisions : [];
      const latest = revisions[revisions.length - 1];
      skipped.push({
        index,
        name:
          record(latest) && typeof latest.name === 'string'
            ? latest.name.slice(0, 120)
            : `Workspace ${index + 1}`,
        reason: error instanceof Error ? error.message : 'Invalid workspace.',
      });
    }
  });
  return { entries, skipped };
}
