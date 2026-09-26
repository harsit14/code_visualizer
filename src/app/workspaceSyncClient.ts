/** Browser client for `/api/workspaces/*`. Every response is validated before use. */
import { parseWorkspace, type WorkspaceRevision } from './workspaceFormat';
import { EMPTY_META, parseWorkspaceMeta, type WorkspaceMeta } from './workspaceTags';

export type SyncAccount = { id: string; email: string };
export type RemoteHead = {
  id: string;
  name: string;
  revision: number;
  meta: WorkspaceMeta;
  metaVersion: number;
  updatedAt: string;
  deleted: boolean;
  /** Change number; listing with `since` set to it returns only later changes. */
  cursor: number;
};
export type RemoteChange = { status: 'stored' | 'duplicate'; head: RemoteHead };
export type SyncErrorCode =
  | 'account_mismatch'
  | 'conflict'
  | 'deleted'
  | 'invalid'
  | 'missing'
  | 'not_found'
  | 'offline'
  | 'quota'
  | 'rate_limited'
  | 'server'
  | 'signed_out'
  | 'static_host'
  | 'sync_unavailable'
  | 'too_large';

export class WorkspaceSyncError extends Error {
  readonly code: SyncErrorCode;
  /** The account's head, for conflicts and removed workspaces. */
  readonly head: RemoteHead | null;
  readonly retryAfterMs: number | null;

  constructor(
    code: SyncErrorCode,
    message: string,
    {
      head = null,
      retryAfterMs = null,
    }: { head?: RemoteHead | null; retryAfterMs?: number | null } = {},
  ) {
    super(message);
    this.name = 'WorkspaceSyncError';
    this.code = code;
    this.head = head;
    this.retryAfterMs = retryAfterMs;
  }
}

export type WorkspaceSyncApi = {
  currentAccount(signal?: AbortSignal): Promise<SyncAccount | null>;
  listHeads(
    account: string,
    since: number,
    signal?: AbortSignal,
  ): Promise<{ items: RemoteHead[]; cursor: number; more: boolean }>;
  fetchRevision(
    account: string,
    id: string,
    revision: number,
    signal?: AbortSignal,
  ): Promise<WorkspaceRevision>;
  /** Stores `workspace` as the revision after `workspace.revision - 1`. */
  pushRevision(
    account: string,
    workspace: WorkspaceRevision,
    meta: WorkspaceMeta,
    signal?: AbortSignal,
  ): Promise<RemoteChange>;
  updateMeta(
    account: string,
    id: string,
    metaVersion: number,
    meta: WorkspaceMeta,
    signal?: AbortSignal,
  ): Promise<RemoteChange>;
  removeWorkspace(account: string, id: string, signal?: AbortSignal): Promise<RemoteChange>;
};

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const count = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

function readHead(value: unknown): RemoteHead | null {
  if (
    !record(value) ||
    typeof value.id !== 'string' ||
    !/^[a-zA-Z0-9-]{1,80}$/.test(value.id) ||
    typeof value.name !== 'string' ||
    !count(value.revision) ||
    !count(value.metaVersion) ||
    typeof value.updatedAt !== 'string' ||
    typeof value.deleted !== 'boolean' ||
    !count(value.cursor)
  ) {
    return null;
  }
  let meta: WorkspaceMeta;
  try {
    meta = parseWorkspaceMeta(value.meta);
  } catch {
    meta = { ...EMPTY_META, tags: [] };
  }
  return {
    id: value.id,
    name: value.name,
    revision: value.revision,
    meta,
    metaVersion: value.metaVersion,
    updatedAt: value.updatedAt,
    deleted: value.deleted,
    cursor: value.cursor,
  };
}

function readChange(value: unknown): RemoteChange {
  const head = record(value) ? readHead(value.head) : null;
  if (!record(value) || (value.status !== 'stored' && value.status !== 'duplicate') || !head) {
    throw new WorkspaceSyncError('server', 'The server sent an unexpected sync response.');
  }
  return { status: value.status, head };
}

export function createWorkspaceSyncApi(
  fetcher: Fetcher = (input, init) => fetch(input, init),
): WorkspaceSyncApi {
  async function request(
    url: string,
    init: RequestInit & { account?: string },
  ): Promise<{ text: string; payload: unknown }> {
    const { account, ...rest } = init;
    let response: Response;
    try {
      response = await fetcher(url, {
        ...rest,
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          ...(rest.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(account ? { 'X-Sync-Account': account } : {}),
        },
      });
    } catch (error) {
      if (rest.signal?.aborted) throw error;
      throw new WorkspaceSyncError('offline', 'The server could not be reached. Sync will retry.');
    }
    const text = await response.text();
    if (!(response.headers.get('Content-Type') ?? '').toLowerCase().includes('application/json')) {
      throw new WorkspaceSyncError(
        response.status >= 500 ? 'server' : 'static_host',
        response.status >= 500
          ? `The server returned an error (${response.status}). Sync will retry.`
          : 'Account sync is not available from this host.',
      );
    }
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      throw new WorkspaceSyncError('server', 'The server sent an unreadable sync response.');
    }
    if (response.ok) return { text, payload };
    const body = record(payload) ? payload : {};
    const message =
      typeof body.error === 'string' ? body.error : `Sync request failed (${response.status}).`;
    const head = readHead(body.head);
    const code =
      typeof body.code === 'string'
        ? (body.code as SyncErrorCode)
        : response.status === 401
          ? 'signed_out'
          : response.status === 413
            ? 'too_large'
            : response.status === 429
              ? 'rate_limited'
              : response.status >= 500
                ? 'server'
                : 'invalid';
    const retryAfter = Number(response.headers.get('Retry-After'));
    throw new WorkspaceSyncError(code, message, {
      head,
      retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : null,
    });
  }

  const path = (id: string) => `/api/workspaces/${encodeURIComponent(id)}`;

  return {
    async currentAccount(signal) {
      const { payload } = await request('/api/me', { method: 'GET', signal });
      const user = record(payload) && record(payload.user) ? payload.user : null;
      return user && typeof user.id === 'string' && typeof user.email === 'string'
        ? { id: user.id, email: user.email }
        : null;
    },
    async listHeads(account, since, signal) {
      const { payload } = await request(`/api/workspaces?since=${since}`, {
        account,
        method: 'GET',
        signal,
      });
      if (!record(payload) || !Array.isArray(payload.items) || !count(payload.cursor)) {
        throw new WorkspaceSyncError('server', 'The server sent an unexpected workspace list.');
      }
      const items = payload.items.map(readHead);
      if (items.some((item) => item === null)) {
        throw new WorkspaceSyncError('server', 'The server sent an unexpected workspace list.');
      }
      return { items: items as RemoteHead[], cursor: payload.cursor, more: payload.more === true };
    },
    async fetchRevision(account, id, revision, signal) {
      const { text } = await request(`${path(id)}/revisions/${revision}`, {
        account,
        method: 'GET',
        signal,
      });
      // Validated like any backup file before it can reach the library.
      const workspace = parseWorkspace(text);
      if (workspace.id !== id || workspace.revision !== revision) {
        throw new WorkspaceSyncError('server', 'The server sent a different revision.');
      }
      return workspace;
    },
    async pushRevision(account, workspace, meta, signal) {
      const { payload } = await request(`${path(workspace.id)}/revisions/${workspace.revision}`, {
        account,
        body: JSON.stringify({ baseRevision: workspace.revision - 1, workspace, meta }),
        method: 'PUT',
        signal,
      });
      return readChange(payload);
    },
    async updateMeta(account, id, metaVersion, meta, signal) {
      const { payload } = await request(path(id), {
        account,
        body: JSON.stringify({ metaVersion, meta }),
        method: 'PATCH',
        signal,
      });
      return readChange(payload);
    },
    async removeWorkspace(account, id, signal) {
      const { payload } = await request(path(id), { account, method: 'DELETE', signal });
      return readChange(payload);
    },
  };
}
