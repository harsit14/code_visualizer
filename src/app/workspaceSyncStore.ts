/**
 * Per-workspace account sync state, kept in the library database so it commits in
 * the same transaction as the heads and revisions a pull or conflict writes.
 */
import { encodeWorkspace, type WorkspaceRevision } from './workspaceFormat';
import {
  openDatabase,
  toSummary,
  transaction,
  type StoredHead,
  type WorkspaceSummary,
} from './workspaceStore';
import { parseWorkspaceMeta, type WorkspaceMeta } from './workspaceTags';

export type SyncIssue = { kind: 'failed' | 'conflict'; message: string; at: number };
export type SyncRecord = {
  id: string;
  /** Account this workspace syncs with; null until it is first uploaded or pulled. */
  account: string | null;
  /** Keep local only: never uploaded or updated from the account. */
  localOnly: boolean;
  /** Kept local because it was saved while a different account was signed in. */
  held?: boolean;
  /** Server revision this device's history matches up to; 0 before the first upload. */
  remoteRevision: number;
  /** Server version of tags and review state that the local copy is based on. */
  metaVersion: number;
  /** Local head `metaRevision` when tags last matched the account; -1 forces an upload. */
  localMetaRevision: number;
  issue: SyncIssue | null;
};
/** Fields a sync pass writes; `localOnly` and `held` belong to the user. */
export type SyncPatch = Partial<Omit<SyncRecord, 'id' | 'localOnly' | 'held'>>;
type Merge = { fallback: SyncRecord; patch: SyncPatch };

export const newSyncRecord = (id: string, account: string | null): SyncRecord => ({
  id,
  account,
  localOnly: false,
  remoteRevision: 0,
  metaVersion: 0,
  localMetaRevision: -1,
  issue: null,
});

const headFor = (workspace: WorkspaceRevision) => ({
  id: workspace.id,
  name: workspace.name,
  revision: workspace.revision,
  savedAt: workspace.savedAt,
  language: workspace.content.language,
  source: workspace.content.code,
});

/**
 * Reads the head and sync record of `id` in `tx`, then calls `then` with the
 * merged record, or with null when the user chose Keep local only meanwhile.
 */
function readForSync(
  tx: IDBTransaction,
  id: string,
  { fallback, patch }: Merge,
  then: (head: WorkspaceSummary | null, record: SyncRecord | null) => void,
) {
  const head = tx.objectStore('heads').get(id);
  const stored = tx.objectStore('sync').get(id);
  // Requests in one transaction complete in order, so the head is ready here.
  stored.onsuccess = () => {
    const base = (stored.result as SyncRecord | undefined) ?? fallback;
    then(
      head.result ? toSummary(head.result as StoredHead) : null,
      base.localOnly ? null : { ...base, ...patch, id },
    );
  };
}

export async function listSyncRecords(): Promise<SyncRecord[]> {
  const db = await openDatabase();
  return transaction(db, ['sync'], 'readonly', (tx, finish) => {
    const request = tx.objectStore('sync').getAll();
    request.onsuccess = () => finish(request.result as SyncRecord[]);
  });
}

/** Read-modify-write of one record; `change` returning null leaves it untouched. */
export async function updateSyncRecord(
  id: string,
  change: (current: SyncRecord | null) => SyncRecord | null,
): Promise<SyncRecord | null> {
  const db = await openDatabase();
  return transaction(db, ['sync'], 'readwrite', (tx, finish) => {
    const store = tx.objectStore('sync');
    const request = store.get(id);
    request.onsuccess = () => {
      const next = change((request.result as SyncRecord | undefined) ?? null);
      if (next) store.put({ ...next, id });
      finish(next);
    };
  });
}

/** Merges a pass's fields into the record; null when the workspace became local only. */
export const patchSyncRecord = (id: string, merge: Merge) =>
  updateSyncRecord(id, (current) => {
    const base = current ?? merge.fallback;
    return base.localOnly ? null : { ...base, ...merge.patch, id };
  });

/**
 * Adds a workspace pulled from the account. Returns false, writing nothing, when
 * this device already has a workspace with that ID or keeps that ID local only.
 */
export async function addPulledWorkspace(
  revisions: WorkspaceRevision[],
  meta: WorkspaceMeta,
  merge: Merge,
): Promise<boolean> {
  const latest = revisions[revisions.length - 1];
  const db = await openDatabase();
  return transaction(db, ['heads', 'revisions', 'sync'], 'readwrite', (tx, finish) => {
    readForSync(tx, latest.id, merge, (existing, record) => {
      if (existing || !record) {
        finish(false);
        return;
      }
      for (const workspace of revisions) {
        tx.objectStore('revisions').add({
          id: workspace.id,
          revision: workspace.revision,
          text: encodeWorkspace(workspace),
        });
      }
      tx.objectStore('heads').put({
        ...parseWorkspaceMeta(meta),
        ...headFor(latest),
        metaRevision: 0,
        autosave: null,
      } satisfies WorkspaceSummary);
      tx.objectStore('sync').put(record);
      finish(true);
    });
  });
}

/**
 * Appends newer account revisions after `expectedHead`, keeping tags and any
 * autosave. Returns null when the local head moved or the workspace became local only.
 */
export async function appendPulledRevisions(
  id: string,
  expectedHead: number,
  revisions: WorkspaceRevision[],
  merge: Merge,
): Promise<{ head: WorkspaceSummary; record: SyncRecord } | null> {
  const latest = revisions[revisions.length - 1];
  const db = await openDatabase();
  return transaction(db, ['heads', 'revisions', 'sync'], 'readwrite', (tx, finish) => {
    readForSync(tx, id, merge, (current, record) => {
      if (!current || !record || current.revision !== expectedHead) {
        finish(null);
        return;
      }
      for (const workspace of revisions) {
        tx.objectStore('revisions').add({
          id,
          revision: workspace.revision,
          text: encodeWorkspace(workspace),
        });
      }
      const head = { ...current, ...headFor(latest) } satisfies WorkspaceSummary;
      tx.objectStore('heads').put(head);
      tx.objectStore('sync').put(record);
      finish({ head, record });
    });
  });
}

/**
 * Keeps both sides of a conflict. The account's head is saved as a new local-only
 * workspace named `copyName`, and the local head stays. When the account already
 * has revision numbers up to the local head's, the local head is repeated after
 * them, so the next upload continues from the account's history. Returns null,
 * writing nothing, when the local head moved or the workspace became local only.
 */
export async function keepBothVersions({
  local,
  remote,
  remoteMeta,
  copyName,
  merge,
}: {
  local: WorkspaceRevision;
  remote: WorkspaceRevision;
  remoteMeta: WorkspaceMeta;
  copyName: string;
  merge: Merge;
}): Promise<{ copyId: string; head: WorkspaceSummary; record: SyncRecord } | null> {
  const copy: WorkspaceRevision = {
    ...remote,
    id: crypto.randomUUID(),
    name: copyName,
    revision: 1,
  };
  const rebased =
    local.revision > remote.revision
      ? null
      : { ...local, revision: remote.revision + 1, savedAt: Date.now() };
  const db = await openDatabase();
  return transaction(db, ['heads', 'revisions', 'sync'], 'readwrite', (tx, finish) => {
    readForSync(tx, local.id, merge, (current, record) => {
      if (!current || !record || current.revision !== local.revision) {
        finish(null);
        return;
      }
      const heads = tx.objectStore('heads');
      const revisions = tx.objectStore('revisions');
      revisions.add({ id: copy.id, revision: 1, text: encodeWorkspace(copy) });
      heads.put({
        ...parseWorkspaceMeta(remoteMeta),
        ...headFor(copy),
        metaRevision: 0,
        autosave: null,
      } satisfies WorkspaceSummary);
      tx.objectStore('sync').put({ ...newSyncRecord(copy.id, null), localOnly: true });
      let head = current;
      if (rebased) {
        revisions.add({ id: local.id, revision: rebased.revision, text: encodeWorkspace(rebased) });
        head = { ...current, ...headFor(rebased) };
        heads.put(head);
      }
      tx.objectStore('sync').put(record);
      finish({ copyId: copy.id, head, record });
    });
  });
}

/**
 * Writes tags and review state when the local copy still has
 * `expectedMetaRevision`. `clean` records that they now match the account;
 * otherwise they stay marked for upload. Returns null when they changed meanwhile.
 */
export async function applySyncedMeta(
  id: string,
  expectedMetaRevision: number,
  meta: WorkspaceMeta,
  merge: Merge,
  clean: boolean,
): Promise<{ head: WorkspaceSummary; record: SyncRecord } | null> {
  const next = parseWorkspaceMeta(meta);
  const db = await openDatabase();
  return transaction(db, ['heads', 'sync'], 'readwrite', (tx, finish) => {
    readForSync(tx, id, merge, (current, merged) => {
      if (!current || !merged || current.metaRevision !== expectedMetaRevision) {
        finish(null);
        return;
      }
      const head = { ...current, ...next, metaRevision: expectedMetaRevision + 1 };
      const record = clean ? { ...merged, localMetaRevision: head.metaRevision } : merged;
      tx.objectStore('heads').put(head);
      tx.objectStore('sync').put(record);
      finish({ head, record });
    });
  });
}
