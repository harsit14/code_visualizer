import type { Language } from '../engine/types';
import {
  byteLength,
  MAX_ARCHIVE_BYTES,
  serializeLibraryArchive,
  type ArchiveEntry,
} from './workspaceArchive';
import {
  encodeWorkspace,
  parseWorkspace,
  serializeWorkspace,
  type WorkspaceContent,
  type WorkspaceRevision,
} from './workspaceFormat';
import { EMPTY_META, parseWorkspaceMeta, type WorkspaceMeta } from './workspaceTags';

export type AutosaveInfo = {
  /** New for every write, so a tab can tell whether the slot still holds what it last saw. */
  token: string;
  savedAt: number;
  /** Head revision the autosaved edits started from. */
  baseRevision: number;
  name: string;
};
export type WorkspaceSummary = WorkspaceMeta & {
  id: string;
  name: string;
  revision: number;
  savedAt: number;
  language: Language | null;
  /** Latest revision's source, kept on the head so search needs no revision reads. */
  source: string;
  /** Increases with each tag/review edit; stale edits from another tab are rejected. */
  metaRevision: number;
  autosave: AutosaveInfo | null;
};
export class WorkspaceConflictError extends Error {
  constructor() {
    super(
      'This workspace has a newer revision in another tab. Open it or save your work as a copy.',
    );
  }
}
export class AutosaveConflictError extends Error {
  constructor() {
    super(
      'Another tab autosaved or discarded changes to this workspace. Reopen it to review them, or save your work as a copy.',
    );
  }
}
export class WorkspaceMetaConflictError extends Error {
  constructor() {
    super('Tags or review state changed in another tab. The list was refreshed; apply it again.');
  }
}

const DB_NAME = 'cv-workspaces-v1';
/**
 * Version 2 adds head metadata (tags, review, search source) and the autosave store.
 * Version 3 adds the `sync` store of per-workspace account sync state.
 */
export const DB_VERSION = 3;
const LANGUAGES: Language[] = ['python', 'javascript', 'typescript'];

export type StoredHead = Partial<WorkspaceSummary> &
  Pick<WorkspaceSummary, 'id' | 'name' | 'revision'>;

export function toSummary(head: StoredHead): WorkspaceSummary {
  return {
    id: head.id,
    name: head.name,
    revision: head.revision,
    savedAt: head.savedAt ?? 0,
    language: head.language ?? null,
    source: head.source ?? '',
    tags: head.tags ?? [],
    needsReview: head.needsReview ?? false,
    reviewBy: head.reviewBy ?? null,
    metaRevision: head.metaRevision ?? 0,
    autosave: head.autosave ?? null,
  };
}

/** Reads only what search needs; a damaged revision still upgrades with empty source. */
function searchFields(text: unknown): Pick<WorkspaceSummary, 'language' | 'source'> {
  try {
    const content = JSON.parse(text as string)?.workspace?.content;
    return {
      language: LANGUAGES.includes(content?.language) ? content.language : null,
      source: typeof content?.code === 'string' ? content.code : '',
    };
  } catch {
    return { language: null, source: '' };
  }
}

function upgrade(db: IDBDatabase, tx: IDBTransaction, oldVersion: number) {
  if (oldVersion < 1) {
    db.createObjectStore('heads', { keyPath: 'id' });
    db.createObjectStore('revisions', { keyPath: ['id', 'revision'] });
  }
  if (oldVersion < 2) {
    db.createObjectStore('autosaves', { keyPath: 'id' });
    const heads = tx.objectStore('heads');
    const revisions = tx.objectStore('revisions');
    const all = heads.getAll();
    all.onsuccess = () => {
      for (const head of all.result as StoredHead[]) {
        const latest = revisions.get([head.id, head.revision]);
        latest.onsuccess = () =>
          heads.put(toSummary({ ...head, ...searchFields(latest.result?.text) }));
      }
    };
  }
  if (oldVersion < 3) {
    db.createObjectStore('sync', { keyPath: 'id' });
  }
}

/** Shared with workspaceSyncStore, whose writes must commit with heads and revisions. */
export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(
        new Error(
          'Local workspace storage is unavailable. Retry or export a backup to keep your work.',
        ),
      );
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    let settled = false;
    request.onupgradeneeded = (event) =>
      upgrade(request.result, request.transaction!, event.oldVersion);
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => {
      settled = true;
      reject(request.error);
    };
    request.onblocked = () => {
      settled = true;
      reject(new Error('Close other Code Visualizer tabs, then retry local storage.'));
    };
  });
}

export function transaction<T>(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction, finish: (value: T) => void, fail: (error: Error) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let value: T;
    let failure: Error | null = null;
    tx.oncomplete = () => {
      db.close();
      resolve(value);
    };
    tx.onabort = () => {
      db.close();
      reject(failure ?? tx.error ?? new Error('Workspace save was interrupted.'));
    };
    try {
      work(
        tx,
        (next) => {
          value = next;
        },
        (error) => {
          failure = error;
          tx.abort();
        },
      );
    } catch (error) {
      failure = error as Error;
      tx.abort();
    }
  });
}

export async function listWorkspaces(): Promise<WorkspaceSummary[]> {
  const db = await openDatabase();
  return transaction(db, ['heads'], 'readonly', (tx, finish) => {
    const request = tx.objectStore('heads').getAll();
    request.onsuccess = () =>
      finish((request.result as StoredHead[]).map(toSummary).sort((a, b) => b.savedAt - a.savedAt));
  });
}

export async function readWorkspace(id: string, revision: number): Promise<WorkspaceRevision> {
  const db = await openDatabase();
  return transaction(db, ['revisions'], 'readonly', (tx, finish, fail) => {
    const request = tx.objectStore('revisions').get([id, revision]);
    request.onsuccess = () => {
      try {
        finish(parseWorkspace(request.result?.text as string));
      } catch {
        fail(
          new Error(
            'This saved revision is missing or damaged. Other revisions and backups can still be opened.',
          ),
        );
      }
    };
  });
}

/**
 * Immutable revisions and the current head commit together, with optimistic concurrency.
 * Saving from the autosave this tab wrote or restored (`autosaveToken`) folds it into the
 * revision; another tab's autosave is left for that tab or a later reopen to resolve.
 */
export async function saveWorkspace(
  name: string,
  content: WorkspaceContent,
  base?: Pick<WorkspaceSummary, 'id' | 'revision'>,
  options: { meta?: WorkspaceMeta; autosaveToken?: string | null } = {},
): Promise<WorkspaceRevision> {
  const workspace = parseWorkspace(
    serializeWorkspace({
      id: base?.id ?? crypto.randomUUID(),
      name,
      revision: (base?.revision ?? 0) + 1,
      savedAt: Date.now(),
      content,
    }),
  );
  const text = serializeWorkspace(workspace);
  const meta = parseWorkspaceMeta(options.meta ?? EMPTY_META);
  const db = await openDatabase();
  return transaction(db, ['heads', 'revisions', 'autosaves'], 'readwrite', (tx, finish, fail) => {
    const heads = tx.objectStore('heads');
    const request = heads.get(workspace.id);
    request.onsuccess = () => {
      const current = request.result ? toSummary(request.result) : null;
      if ((current?.revision ?? 0) !== (base?.revision ?? 0)) {
        fail(new WorkspaceConflictError());
        return;
      }
      const { id, name, revision, savedAt } = workspace;
      const foldsAutosave = !!current?.autosave && current.autosave.token === options.autosaveToken;
      // A record wrapper provides compound keys while keeping the validated JSON intact.
      tx.objectStore('revisions').add({ id, revision, text });
      if (foldsAutosave) tx.objectStore('autosaves').delete(id);
      heads.put({
        ...(current ?? { ...meta, metaRevision: 0 }),
        id,
        name,
        revision,
        savedAt,
        language: workspace.content.language,
        source: workspace.content.code,
        autosave: foldsAutosave ? null : (current?.autosave ?? null),
      } satisfies WorkspaceSummary);
      finish(workspace);
    };
  });
}

/**
 * Replaces the workspace's single autosave slot. Rejected when another tab saved a newer
 * revision, or when the slot no longer holds `expectedToken` (another tab's autosave).
 */
export async function autosaveWorkspace(
  name: string,
  content: WorkspaceContent,
  base: Pick<WorkspaceSummary, 'id' | 'revision'>,
  expectedToken: string | null,
): Promise<AutosaveInfo> {
  const savedAt = Date.now();
  const text = serializeWorkspace({ id: base.id, name, revision: base.revision, savedAt, content });
  const db = await openDatabase();
  return transaction(db, ['heads', 'autosaves'], 'readwrite', (tx, finish, fail) => {
    const heads = tx.objectStore('heads');
    const request = heads.get(base.id);
    request.onsuccess = () => {
      const current = request.result ? toSummary(request.result) : null;
      if (!current) {
        fail(new Error('This workspace is no longer in the library. Save it as a copy.'));
      } else if (current.revision !== base.revision) {
        fail(new WorkspaceConflictError());
      } else if ((current.autosave?.token ?? null) !== expectedToken) {
        fail(new AutosaveConflictError());
      } else {
        const info: AutosaveInfo = {
          token: crypto.randomUUID(),
          savedAt,
          baseRevision: base.revision,
          name: name.trim(),
        };
        tx.objectStore('autosaves').put({ id: base.id, token: info.token, text });
        heads.put({ ...current, autosave: info });
        finish(info);
      }
    };
  });
}

export async function readAutosave(
  id: string,
): Promise<{ workspace: WorkspaceRevision; info: AutosaveInfo } | null> {
  const db = await openDatabase();
  return transaction(db, ['heads', 'autosaves'], 'readonly', (tx, finish, fail) => {
    const head = tx.objectStore('heads').get(id);
    const slot = tx.objectStore('autosaves').get(id);
    slot.onsuccess = () => {
      const info = head.result ? toSummary(head.result).autosave : null;
      if (!info || slot.result?.token !== info.token) {
        finish(null);
        return;
      }
      try {
        finish({ workspace: parseWorkspace(slot.result.text), info });
      } catch {
        fail(new Error('This autosave is damaged. Discard it; saved revisions are unaffected.'));
      }
    };
  });
}

/** Deletes the autosave only if it is still the one the user chose to discard. */
export async function discardAutosave(id: string, token: string): Promise<void> {
  const db = await openDatabase();
  return transaction(db, ['heads', 'autosaves'], 'readwrite', (tx, finish, fail) => {
    const heads = tx.objectStore('heads');
    const request = heads.get(id);
    request.onsuccess = () => {
      const current = request.result ? toSummary(request.result) : null;
      if (!current || current.autosave?.token !== token) {
        fail(new AutosaveConflictError());
        return;
      }
      tx.objectStore('autosaves').delete(id);
      heads.put({ ...current, autosave: null });
      finish(undefined);
    };
  });
}

/** Tags and review state are head metadata: editing them never creates a revision. */
export async function updateWorkspaceMeta(
  id: string,
  metaRevision: number,
  meta: WorkspaceMeta,
): Promise<WorkspaceSummary> {
  const next = parseWorkspaceMeta(meta);
  const db = await openDatabase();
  return transaction(db, ['heads'], 'readwrite', (tx, finish, fail) => {
    const heads = tx.objectStore('heads');
    const request = heads.get(id);
    request.onsuccess = () => {
      if (!request.result) {
        fail(new Error('Workspace is no longer available. Refresh the library.'));
        return;
      }
      const current = toSummary(request.result);
      if (current.metaRevision !== metaRevision) {
        fail(new WorkspaceMetaConflictError());
        return;
      }
      const updated = { ...current, ...next, metaRevision: metaRevision + 1 };
      heads.put(updated);
      finish(updated);
    };
  });
}

export type LibraryExport = {
  text: string;
  workspaces: number;
  revisions: number;
  autosaves: number;
  /** False when every revision was requested but the archive would exceed its size limit. */
  history: boolean;
  damaged: number;
};

/** Reads the whole library in one snapshot; history is dropped once it outgrows the limit. */
export async function exportLibrary(includeHistory: boolean): Promise<LibraryExport> {
  const db = await openDatabase();
  type Collected = {
    heads: WorkspaceSummary[];
    revisions: Map<string, { revision: number; text: string }[]>;
    slots: Map<string, string>;
    history: boolean;
  };
  const collected = await transaction<Collected>(
    db,
    ['heads', 'revisions', 'autosaves'],
    'readonly',
    (tx, finish) => {
      const result: Collected = {
        heads: [],
        revisions: new Map(),
        slots: new Map(),
        history: includeHistory,
      };
      finish(result);
      const revisions = tx.objectStore('revisions');
      const keep = (row: { id: string; revision: number; text: string }) =>
        result.revisions.set(row.id, [...(result.revisions.get(row.id) ?? []), row]);
      const readLatest = () => {
        result.revisions.clear();
        for (const head of result.heads) {
          const latest = revisions.get([head.id, head.revision]);
          latest.onsuccess = () => latest.result && keep(latest.result);
        }
      };
      const heads = tx.objectStore('heads').getAll();
      heads.onsuccess = () => {
        result.heads = (heads.result as StoredHead[]).map(toSummary);
        if (!includeHistory) readLatest();
      };
      const slots = tx.objectStore('autosaves').getAll();
      slots.onsuccess = () => {
        for (const slot of slots.result as { id: string; token: string; text: string }[])
          result.slots.set(slot.id, slot.text);
      };
      if (!includeHistory) return;
      let size = 0;
      const cursor = revisions.openCursor();
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) return;
        size += row.value.text.length;
        if (size > MAX_ARCHIVE_BYTES) {
          result.history = false;
          readLatest();
          return;
        }
        keep(row.value);
        row.continue();
      };
    },
  );
  let damaged = 0;
  const entries: ArchiveEntry[] = [];
  for (const head of collected.heads.sort((a, b) => a.name.localeCompare(b.name))) {
    const revisions = (collected.revisions.get(head.id) ?? [])
      .sort((a, b) => a.revision - b.revision)
      .flatMap(({ text }) => {
        try {
          return [parseWorkspace(text)];
        } catch {
          damaged += 1;
          return [];
        }
      });
    let autosave: WorkspaceRevision | null = null;
    const slot = collected.slots.get(head.id);
    if (head.autosave && slot) {
      try {
        autosave = parseWorkspace(slot);
      } catch {
        damaged += 1;
      }
    }
    if (revisions.length)
      entries.push({
        meta: { tags: head.tags, needsReview: head.needsReview, reviewBy: head.reviewBy },
        revisions,
        autosave,
      });
  }
  let history = collected.history;
  let text = serializeLibraryArchive(entries, history);
  if (history && byteLength(text) > MAX_ARCHIVE_BYTES) {
    history = false;
    text = serializeLibraryArchive(
      entries.map((entry) => ({ ...entry, revisions: entry.revisions.slice(-1) })),
      history,
    );
  }
  if (byteLength(text) > MAX_ARCHIVE_BYTES) {
    throw new Error(
      'The library is larger than 100 MB. Export workspaces individually, or remove large traces first.',
    );
  }
  return {
    text,
    workspaces: entries.length,
    revisions: history
      ? entries.reduce((sum, entry) => sum + entry.revisions.length, 0)
      : entries.length,
    autosaves: entries.filter((entry) => entry.autosave).length,
    history,
    damaged,
  };
}

const fingerprint = (name: string, savedAt: number, source: string) =>
  JSON.stringify([name, savedAt, source]);

/**
 * Adds validated archive entries under fresh IDs in one transaction: either every
 * workspace is written or none is. Entries matching an existing workspace's latest
 * revision (name, time and source) are skipped so re-importing an archive is harmless.
 */
export async function importLibrary(
  entries: ArchiveEntry[],
): Promise<{ imported: number; revisions: number; duplicates: number }> {
  const db = await openDatabase();
  return transaction(db, ['heads', 'revisions', 'autosaves'], 'readwrite', (tx, finish) => {
    const heads = tx.objectStore('heads');
    const existing = heads.getAll();
    existing.onsuccess = () => {
      const seen = new Set(
        (existing.result as StoredHead[])
          .map(toSummary)
          .map((head) => fingerprint(head.name, head.savedAt, head.source)),
      );
      const outcome = { imported: 0, revisions: 0, duplicates: 0 };
      for (const entry of entries) {
        const latest = entry.revisions[entry.revisions.length - 1];
        const key = fingerprint(latest.name, latest.savedAt, latest.content.code);
        if (seen.has(key)) {
          outcome.duplicates += 1;
          continue;
        }
        seen.add(key);
        const id = crypto.randomUUID();
        // Renumbering keeps revisions contiguous when an archive holds only the latest one.
        entry.revisions.forEach((revision, index) => {
          const workspace = { ...revision, id, revision: index + 1 };
          tx.objectStore('revisions').add({
            id,
            revision: workspace.revision,
            text: encodeWorkspace(workspace),
          });
        });
        const head = entry.revisions.length;
        let autosave: AutosaveInfo | null = null;
        if (entry.autosave) {
          autosave = {
            token: crypto.randomUUID(),
            savedAt: entry.autosave.savedAt,
            baseRevision: head,
            name: entry.autosave.name,
          };
          tx.objectStore('autosaves').put({
            id,
            token: autosave.token,
            text: encodeWorkspace({ ...entry.autosave, id, revision: head }),
          });
        }
        heads.put({
          ...entry.meta,
          id,
          name: latest.name,
          revision: head,
          savedAt: latest.savedAt,
          language: latest.content.language,
          source: latest.content.code,
          metaRevision: 0,
          autosave,
        } satisfies WorkspaceSummary);
        outcome.imported += 1;
        outcome.revisions += head;
      }
      finish(outcome);
    };
  });
}
