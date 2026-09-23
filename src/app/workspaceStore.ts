import {
  parseWorkspace,
  serializeWorkspace,
  type WorkspaceContent,
  type WorkspaceRevision,
} from './workspaceFormat';

export type WorkspaceSummary = Pick<WorkspaceRevision, 'id' | 'name' | 'revision' | 'savedAt'>;
export class WorkspaceConflictError extends Error {
  constructor() {
    super(
      'This workspace has a newer revision in another tab. Open it or save your work as a copy.',
    );
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(
        new Error(
          'Local workspace storage is unavailable. Retry or export a backup to keep your work.',
        ),
      );
      return;
    }
    const request = indexedDB.open('cv-workspaces-v1', 1);
    let settled = false;
    request.onupgradeneeded = () => {
      request.result.createObjectStore('heads', { keyPath: 'id' });
      request.result.createObjectStore('revisions', { keyPath: ['id', 'revision'] });
    };
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

function transaction<T>(
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
      finish((request.result as WorkspaceSummary[]).sort((a, b) => b.savedAt - a.savedAt));
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

/** Immutable revisions and the current head commit together, with optimistic concurrency. */
export async function saveWorkspace(
  name: string,
  content: WorkspaceContent,
  base?: Pick<WorkspaceSummary, 'id' | 'revision'>,
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
  const db = await openDatabase();
  return transaction(db, ['heads', 'revisions'], 'readwrite', (tx, finish, fail) => {
    const heads = tx.objectStore('heads');
    const request = heads.get(workspace.id);
    request.onsuccess = () => {
      if ((request.result?.revision ?? 0) !== (base?.revision ?? 0)) {
        fail(new WorkspaceConflictError());
        return;
      }
      const { id, name, revision, savedAt } = workspace;
      // A record wrapper provides compound keys while keeping the validated JSON intact.
      tx.objectStore('revisions').add({ id, revision, text });
      heads.put({ id, name, revision, savedAt });
      finish(workspace);
    };
  });
}
