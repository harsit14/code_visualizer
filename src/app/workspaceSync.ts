/**
 * One account sync pass over the local workspace library. Pulled revisions are
 * validated and stored, never run. Nothing on either side is overwritten: a
 * conflict keeps the local head and saves the account's version as a copy.
 */
import { byteLength } from './workspaceArchive';
import {
  encodeWorkspace,
  MAX_SYNCED_REVISION_BYTES,
  type WorkspaceRevision,
} from './workspaceFormat';
import { listWorkspaces, readWorkspace, type WorkspaceSummary } from './workspaceStore';
import {
  WorkspaceSyncError,
  type RemoteChange,
  type RemoteHead,
  type SyncErrorCode,
  type WorkspaceSyncApi,
} from './workspaceSyncClient';
import {
  addPulledWorkspace,
  appendPulledRevisions,
  applySyncedMeta,
  keepBothVersions,
  listSyncRecords,
  newSyncRecord,
  patchSyncRecord,
  updateSyncRecord,
  type SyncPatch,
  type SyncRecord,
} from './workspaceSyncStore';
import { MAX_TAGS, type WorkspaceMeta } from './workspaceTags';

/** Newest revisions fetched per workspace in one pass; older ones stay in the account. */
export const MAX_PULL_REVISIONS = 50;
const MAX_LIST_PAGES = 20;
/** Conflicts resolved per workspace per pass, so two devices cannot loop forever. */
const MAX_CONFLICTS = 2;
/** Errors that end the pass; any other error fails only its workspace. */
const PASS_ERRORS = new Set<SyncErrorCode>([
  'account_mismatch',
  'offline',
  'rate_limited',
  'server',
  'signed_out',
  'static_host',
  'sync_unavailable',
]);

export type SyncPassResult = {
  /** Cursor for the next pass; unchanged unless every listed change was applied. */
  cursor: number;
  /** Conflicts kept and workspaces removed elsewhere, for the user. */
  notices: string[];
  /** Workspaces whose local head revision moved (pulled revisions or a kept conflict). */
  changed: string[];
  /** Workspaces added from the account. */
  pulled: number;
  /** Heads, revisions or tags in this library were written, so its list is stale. */
  libraryChanged: boolean;
  failed: number;
  /** Why the pass ended early. */
  stopped: WorkspaceSyncError | null;
};

class ChangedDuringSync extends Error {
  constructor() {
    super('This workspace changed while syncing. It will sync on the next pass.');
  }
}

export const fromAnotherDevice = (name: string) => {
  const suffix = ' (from another device)';
  return `${name.slice(0, 120 - suffix.length).trim()}${suffix}`;
};

const metaOf = (item: WorkspaceMeta): WorkspaceMeta => ({
  tags: item.tags,
  needsReview: item.needsReview,
  reviewBy: item.reviewBy,
});

/** Concurrent tag edits keep every tag, either review flag and the earlier review date. */
export function mergeMeta(local: WorkspaceMeta, remote: WorkspaceMeta): WorkspaceMeta {
  const dates = [local.reviewBy, remote.reviewBy].filter((date) => date !== null).sort();
  return {
    tags: [...new Set([...local.tags, ...remote.tags])].slice(0, MAX_TAGS),
    needsReview: local.needsReview || remote.needsReview,
    reviewBy: dates[0] ?? null,
  };
}

/**
 * A revision over the sync limit is uploaded without its replay. The result
 * depends only on the stored revision, so a retry sends identical content.
 */
export function syncableRevision(workspace: WorkspaceRevision): WorkspaceRevision {
  if (byteLength(encodeWorkspace(workspace)) <= MAX_SYNCED_REVISION_BYTES) return workspace;
  const trimmed = {
    ...workspace,
    content: { ...workspace.content, result: null, step: 0, bookmarks: [] },
  };
  if (byteLength(encodeWorkspace(trimmed)) > MAX_SYNCED_REVISION_BYTES) {
    throw new WorkspaceSyncError(
      'too_large',
      'A revision is larger than 2 MB even without its replay. Keep this workspace local only, or shorten its notes and cases.',
    );
  }
  return trimmed;
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

export async function syncLibrary({
  api,
  account,
  cursor,
  signal,
}: {
  api: WorkspaceSyncApi;
  /** ID of the account the library syncs with. */
  account: string;
  cursor: number;
  signal?: AbortSignal;
}): Promise<SyncPassResult> {
  const outcome: SyncPassResult = {
    cursor,
    notices: [],
    changed: [],
    pulled: 0,
    libraryChanged: false,
    failed: 0,
    stopped: null,
  };
  const remote = new Map<string, RemoteHead>();
  let next = cursor;
  try {
    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      const listed = await api.listHeads(account, next, signal);
      listed.items.forEach((head) => remote.set(head.id, head));
      next = listed.cursor;
      if (!listed.more) break;
    }
  } catch (error) {
    if (error instanceof WorkspaceSyncError) {
      outcome.stopped = error;
      return outcome;
    }
    throw error;
  }

  const heads = new Map((await listWorkspaces()).map((head) => [head.id, head]));
  const records = new Map((await listSyncRecords()).map((record) => [record.id, record]));
  let complete = true;
  for (const id of new Set([...remote.keys(), ...heads.keys()])) {
    signal?.throwIfAborted();
    try {
      await syncWorkspace(id, heads.get(id), records.get(id), remote.get(id));
    } catch (error) {
      if (isAbort(error)) throw error;
      if (error instanceof WorkspaceSyncError && PASS_ERRORS.has(error.code)) {
        outcome.stopped = error;
        return outcome;
      }
      if (remote.has(id)) complete = false;
      // Edited or set local only during the pass: the next pass picks it up.
      if (error instanceof ChangedDuringSync) continue;
      outcome.failed += 1;
      const message = error instanceof Error ? error.message : 'Sync failed.';
      await patchSyncRecord(id, {
        fallback: records.get(id) ?? newSyncRecord(id, account),
        patch: { issue: { kind: 'failed', message, at: Date.now() } },
      });
    }
  }
  if (complete) outcome.cursor = next;
  return outcome;

  async function syncWorkspace(
    id: string,
    head: WorkspaceSummary | undefined,
    record: SyncRecord | undefined,
    server: RemoteHead | undefined,
  ) {
    if (!head) {
      if (server && !server.deleted && !record?.localOnly) await pullNew(server);
      return;
    }
    // Local-only workspaces, and those synced with another account, are never sent here.
    if (record?.localOnly || (record?.account && record.account !== account)) return;
    await reconcile(head, record ?? newSyncRecord(id, account), server);
  }

  /** Saves the pass's fields, always recording which account the workspace syncs with. */
  async function persist(id: string, fallback: SyncRecord, patch: SyncPatch) {
    const saved = await patchSyncRecord(id, { fallback, patch: { ...patch, account } });
    if (!saved) throw new ChangedDuringSync();
    return saved;
  }

  async function pullNew(server: RemoteHead) {
    const revisions = await fetchRange(
      server.id,
      Math.max(1, server.revision - MAX_PULL_REVISIONS + 1),
      server.revision,
    );
    const added = await addPulledWorkspace(revisions, server.meta, {
      fallback: newSyncRecord(server.id, account),
      patch: {
        account,
        remoteRevision: server.revision,
        metaVersion: server.metaVersion,
        localMetaRevision: 0,
        issue: null,
      },
    });
    if (added) {
      outcome.pulled += 1;
      outcome.libraryChanged = true;
    }
  }

  async function fetchRange(id: string, first: number, last: number) {
    const revisions: WorkspaceRevision[] = [];
    for (let revision = first; revision <= last; revision += 1) {
      revisions.push(await api.fetchRevision(account, id, revision, signal));
    }
    return revisions;
  }

  async function reconcile(head: WorkspaceSummary, initial: SyncRecord, server?: RemoteHead) {
    const id = head.id;
    let local = head;
    let record: SyncRecord = { ...initial, account };
    let known = server;
    let conflicts = 0;
    let restarted = false;
    const save = async (patch: SyncPatch) => {
      record = await persist(id, record, patch);
    };
    const keepBoth = async (theirs: RemoteHead) => {
      if (++conflicts > MAX_CONFLICTS) throw new ChangedDuringSync();
      const remoteWorkspace = await api.fetchRevision(account, id, theirs.revision, signal);
      const localWorkspace = await readWorkspace(id, local.revision);
      const copyName = fromAnotherDevice(remoteWorkspace.name);
      const message = `“${local.name}” changed on this device and on another device. Both are kept: this device's version stays here, and the other version was saved as “${copyName}”.`;
      const kept = await keepBothVersions({
        local: localWorkspace,
        remote: remoteWorkspace,
        remoteMeta: theirs.meta,
        copyName,
        merge: {
          fallback: record,
          patch: {
            account,
            remoteRevision: theirs.revision,
            issue: { kind: 'conflict', message, at: Date.now() },
          },
        },
      });
      if (!kept) throw new ChangedDuringSync();
      if (kept.head.revision !== local.revision) outcome.changed.push(id);
      outcome.libraryChanged = true;
      local = kept.head;
      record = kept.record;
      known = theirs;
      outcome.notices.push(message);
    };

    for (;;) {
      signal?.throwIfAborted();
      if (known?.deleted) return removedElsewhere(local, record);
      const base = record.remoteRevision;
      if (local.revision > base) {
        // Upload the next local revision; a retry sends the same revision again.
        const workspace = syncableRevision(await readWorkspace(id, base + 1));
        let change: RemoteChange;
        try {
          change = await api.pushRevision(account, workspace, metaOf(local), signal);
        } catch (error) {
          if (!(error instanceof WorkspaceSyncError)) throw error;
          if (error.code === 'conflict' && error.head) {
            await keepBoth(error.head);
            continue;
          }
          if (error.code === 'deleted') return removedElsewhere(local, record);
          if (error.code === 'missing' && !restarted) {
            // The account no longer has it (never uploaded there): upload from revision 1.
            restarted = true;
            known = undefined;
            await save({ remoteRevision: 0, metaVersion: 0, localMetaRevision: -1 });
            continue;
          }
          throw error;
        }
        known = change.head;
        await save({
          remoteRevision: base + 1,
          ...(base === 0
            ? {
                metaVersion: change.head.metaVersion,
                // Only a fresh upload used this device's tags; a duplicate may predate an edit.
                localMetaRevision:
                  change.status === 'stored' ? local.metaRevision : record.localMetaRevision,
              }
            : {}),
        });
      } else if (known && known.revision > base) {
        const revisions = await fetchRange(
          id,
          Math.max(base + 1, known.revision - MAX_PULL_REVISIONS + 1),
          known.revision,
        );
        const appended = await appendPulledRevisions(id, local.revision, revisions, {
          fallback: record,
          patch: { account, remoteRevision: known.revision },
        });
        if (!appended) throw new ChangedDuringSync();
        local = appended.head;
        record = appended.record;
        outcome.changed.push(id);
        outcome.libraryChanged = true;
      } else if (known && known.revision < base) {
        // The account restarted this workspace (removed, then uploaded again elsewhere).
        await keepBoth(known);
      } else {
        break;
      }
    }
    const synced = await reconcileMeta(local, record, known);
    if (synced?.issue?.kind === 'failed') await persist(id, synced, { issue: null });
  }

  /** Tags and review state; returns the saved record, or null once removed elsewhere. */
  async function reconcileMeta(
    head: WorkspaceSummary,
    initial: SyncRecord,
    server: RemoteHead | undefined,
  ): Promise<SyncRecord | null> {
    let record = initial;
    const localChanged = head.metaRevision !== record.localMetaRevision;
    let theirs = server && server.metaVersion !== record.metaVersion ? server : undefined;
    if (!localChanged && !theirs) return record;
    if (!localChanged && theirs) {
      const applied = await applySyncedMeta(
        head.id,
        head.metaRevision,
        theirs.meta,
        { fallback: record, patch: { account, metaVersion: theirs.metaVersion } },
        true,
      );
      if (applied) outcome.libraryChanged = true;
      // Edited here meanwhile: the next pass uploads that edit with a merge.
      return applied?.record ?? record;
    }
    let meta = metaOf(head);
    let metaRevision = head.metaRevision;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (theirs) {
        // Both sides changed: merge locally first, still marked for upload.
        meta = mergeMeta(meta, theirs.meta);
        const applied = await applySyncedMeta(
          head.id,
          metaRevision,
          meta,
          { fallback: record, patch: { account, metaVersion: theirs.metaVersion } },
          false,
        );
        if (!applied) throw new ChangedDuringSync();
        outcome.libraryChanged = true;
        metaRevision = applied.head.metaRevision;
        record = applied.record;
        theirs = undefined;
      }
      try {
        const change = await api.updateMeta(account, head.id, record.metaVersion, meta, signal);
        return await persist(head.id, record, {
          metaVersion: change.head.metaVersion,
          localMetaRevision: metaRevision,
        });
      } catch (error) {
        if (!(error instanceof WorkspaceSyncError)) throw error;
        if (error.code === 'deleted') {
          await removedElsewhere(head, record);
          return null;
        }
        if (error.code !== 'conflict' || !error.head) throw error;
        theirs = error.head;
      }
    }
    throw new ChangedDuringSync();
  }

  async function removedElsewhere(head: WorkspaceSummary, record: SyncRecord) {
    // Kept on this device and never uploaded again unless the user turns sync back on for it.
    await updateSyncRecord(head.id, (current) => ({
      ...(current ?? record),
      localOnly: true,
      remoteRevision: 0,
      metaVersion: 0,
      localMetaRevision: -1,
      issue: null,
    }));
    outcome.notices.push(
      `“${head.name}” was removed from your account on another device. It stays on this device as local only.`,
    );
  }
}
