import { accountDatabaseMissing, getSessionContext } from './auth';
import {
  getDatabase,
  isMissingSchemaError,
  type AppDatabase,
  type SyncedWorkspaceRow,
  type WorkspaceSyncResult,
} from './database';
import {
  isRecord,
  isRequestBodyTooLargeError,
  jsonResponse,
  jsonTextResponse,
  methodNotAllowed,
  readLimitedJson,
  requestBodyTooLargeResponse,
} from './http';
import { enforceIpRateLimit } from './rateLimit';
import type { ServerEnv } from './types';
import {
  encodeWorkspace,
  MAX_SYNCED_REVISION_BYTES,
  validateWorkspaceRevision,
} from '../app/workspaceFormat';
import { EMPTY_META, parseWorkspaceMeta, type WorkspaceMeta } from '../app/workspaceTags';

/** Per-account bounds, passed to `workspace_sync_push`. */
export const MAX_SYNCED_WORKSPACES = 500;
export const MAX_SYNCED_BYTES = 50 * 1024 * 1024;
export const WORKSPACE_EXPORT_LIMIT = 50;
export const WORKSPACE_EXPORT_BYTES = 8 * 1024 * 1024;
/** The account the library syncs with; a different signed-in account is refused. */
export const SYNC_ACCOUNT_HEADER = 'X-Sync-Account';
const LIST_LIMIT = 100;
const MAX_REVISION = 1_000_000;
// The largest allowed revision plus room for the base revision and tags.
const PUSH_BODY_LIMIT_BYTES = MAX_SYNCED_REVISION_BYTES + 16 * 1024;
const META_BODY_LIMIT_BYTES = 4096;
const ID_PATTERN = /^[a-zA-Z0-9-]{1,80}$/;
const READS_PER_MINUTE = 240;
const WRITES_PER_MINUTE = 120;

type SyncAuth = { db: AppDatabase; userId: string };

/** Opt-in library sync (`/api/workspaces/*`), backed by migration 0005. */
export async function handleWorkspaceSyncApi(
  request: Request,
  env: ServerEnv,
): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (pathname === '/api/workspaces') {
    return request.method === 'GET'
      ? withSync(env, request, 'read', (auth) => listHeads(auth, request))
      : methodNotAllowed(['GET']);
  }
  const revision = pathname.match(/^\/api\/workspaces\/([^/]+)\/revisions\/([^/]+)$/);
  if (revision) {
    const [, id, number] = revision;
    if (request.method === 'GET') {
      return withSync(env, request, 'read', (auth) => getRevision(auth, id, number));
    }
    if (request.method === 'PUT') {
      return withSync(env, request, 'write', (auth) => pushRevision(auth, request, id, number));
    }
    return methodNotAllowed(['GET', 'PUT']);
  }
  const workspace = pathname.match(/^\/api\/workspaces\/([^/]+)$/);
  if (workspace) {
    const id = workspace[1];
    if (request.method === 'PATCH') {
      return withSync(env, request, 'write', (auth) => updateMeta(auth, request, id));
    }
    if (request.method === 'DELETE') {
      return withSync(env, request, 'write', (auth) => removeWorkspace(auth, id));
    }
    return methodNotAllowed(['PATCH', 'DELETE']);
  }
  return null;
}

async function withSync(
  env: ServerEnv,
  request: Request,
  kind: 'read' | 'write',
  handler: (auth: SyncAuth) => Promise<Response>,
): Promise<Response> {
  const db = getDatabase(env);
  if (!db) {
    return accountDatabaseMissing();
  }
  const context = await getSessionContext(env, request);
  if (!context) {
    return jsonResponse({ error: 'Sign in to sync workspaces.', code: 'signed_out' }, 401);
  }
  // A session that changed mid-sync (sign-out, or another account in another
  // tab) must never receive this library's workspaces or send another's.
  const expected = request.headers.get(SYNC_ACCOUNT_HEADER);
  if (!expected) {
    return jsonResponse({ error: `${SYNC_ACCOUNT_HEADER} is required.` }, 400);
  }
  if (expected !== context.user.id) {
    return jsonResponse(
      {
        error: 'This library syncs with a different account than the one signed in.',
        code: 'account_mismatch',
      },
      409,
    );
  }
  const limited = enforceIpRateLimit(request, {
    limit: kind === 'read' ? READS_PER_MINUTE : WRITES_PER_MINUTE,
    namespace: `workspaces:${kind}:${context.user.id}`,
    windowMs: 60_000,
  });
  if (limited) return limited;
  try {
    return await handler({ db, userId: context.user.id });
  } catch (error) {
    if (isMissingSchemaError(error)) {
      return jsonResponse(
        {
          error:
            'Workspace sync is not available yet. The site owner needs to apply the latest database update.',
          code: 'sync_unavailable',
        },
        503,
      );
    }
    throw error;
  }
}

async function listHeads(auth: SyncAuth, request: Request): Promise<Response> {
  const since = Number(new URL(request.url).searchParams.get('since') ?? 0);
  if (!Number.isSafeInteger(since) || since < 0) {
    return jsonResponse({ error: 'since must be a cursor from an earlier list.' }, 400);
  }
  const rows = await auth.db.listSyncedWorkspaces(auth.userId, since, LIST_LIMIT + 1);
  const page = rows.slice(0, LIST_LIMIT);
  return jsonResponse({
    items: page.map(serializeHead),
    cursor: page.length ? Number(page[page.length - 1].change_seq) : since,
    more: rows.length > LIST_LIMIT,
  });
}

async function getRevision(auth: SyncAuth, id: string, number: string): Promise<Response> {
  const revision = readRevision(number);
  const body =
    ID_PATTERN.test(id) && revision !== null
      ? await auth.db.getSyncedRevision(auth.userId, id, revision)
      : null;
  // The stored document was validated and serialized by pushRevision.
  return body === null
    ? jsonResponse({ error: 'Revision not found.', code: 'not_found' }, 404)
    : jsonTextResponse(body);
}

async function pushRevision(
  auth: SyncAuth,
  request: Request,
  id: string,
  number: string,
): Promise<Response> {
  const revision = readRevision(number);
  if (!ID_PATTERN.test(id) || revision === null) {
    return jsonResponse({ error: 'Revision not found.', code: 'not_found' }, 404);
  }
  const body = await readSyncJson(request, PUSH_BODY_LIMIT_BYTES);
  if (body instanceof Response) return body;
  if (!isRecord(body) || body.baseRevision !== revision - 1) {
    return invalid('baseRevision must be the revision before the one being stored.');
  }
  let text: string;
  let name: string;
  let meta: WorkspaceMeta;
  try {
    const workspace = validateWorkspaceRevision(body.workspace);
    if (workspace.id !== id || workspace.revision !== revision) {
      return invalid('The workspace ID and revision must match the URL.');
    }
    meta = body.meta === undefined ? { ...EMPTY_META, tags: [] } : parseWorkspaceMeta(body.meta);
    // Only validated fields are serialized, so unknown properties are never stored.
    text = encodeWorkspace(workspace);
    name = workspace.name;
  } catch (error) {
    return invalid(error instanceof Error ? error.message : 'Workspace is invalid.');
  }
  if (new TextEncoder().encode(text).length > MAX_SYNCED_REVISION_BYTES) {
    return jsonResponse(
      { error: 'This revision is larger than 2 MB and cannot be synced.', code: 'too_large' },
      413,
    );
  }
  const result = await auth.db.pushWorkspaceRevision({
    base_revision: revision - 1,
    body: text,
    max_bytes: MAX_SYNCED_BYTES,
    max_workspaces: MAX_SYNCED_WORKSPACES,
    meta,
    name,
    user_id: auth.userId,
    workspace_id: id,
  });
  return syncResultResponse(result, 201);
}

async function updateMeta(auth: SyncAuth, request: Request, id: string): Promise<Response> {
  if (!ID_PATTERN.test(id)) {
    return jsonResponse({ error: 'Workspace not found.', code: 'missing' }, 404);
  }
  const body = await readSyncJson(request, META_BODY_LIMIT_BYTES);
  if (body instanceof Response) return body;
  if (
    !isRecord(body) ||
    typeof body.metaVersion !== 'number' ||
    !Number.isSafeInteger(body.metaVersion) ||
    body.metaVersion < 0
  ) {
    return invalid('metaVersion must be the version these tags were based on.');
  }
  let meta: WorkspaceMeta;
  try {
    meta = parseWorkspaceMeta(body.meta);
  } catch (error) {
    return invalid(error instanceof Error ? error.message : 'Tags or review state are invalid.');
  }
  return syncResultResponse(
    await auth.db.updateSyncedWorkspaceMeta(auth.userId, id, body.metaVersion, meta),
  );
}

async function removeWorkspace(auth: SyncAuth, id: string): Promise<Response> {
  if (!ID_PATTERN.test(id)) {
    return jsonResponse({ error: 'Workspace not found.', code: 'missing' }, 404);
  }
  return syncResultResponse(await auth.db.deleteSyncedWorkspace(auth.userId, id));
}

function syncResultResponse({ status, head }: WorkspaceSyncResult, storedStatus = 200): Response {
  const serialized = head ? serializeHead(head) : null;
  switch (status) {
    case 'stored':
      return jsonResponse({ status, head: serialized }, storedStatus);
    case 'duplicate':
      return jsonResponse({ status, head: serialized });
    case 'conflict':
      return jsonResponse(
        { error: 'This workspace changed on another device.', code: 'conflict', head: serialized },
        409,
      );
    case 'deleted':
      return jsonResponse(
        {
          error: 'This workspace was removed from your account.',
          code: 'deleted',
          head: serialized,
        },
        409,
      );
    case 'missing':
      return jsonResponse(
        { error: 'This workspace is not in your account.', code: 'missing', head: null },
        404,
      );
    case 'quota':
      return jsonResponse(
        {
          error: `Your account can sync up to ${MAX_SYNCED_WORKSPACES} workspaces and ${MAX_SYNCED_BYTES / 1024 / 1024} MB of revisions. Remove workspaces from your account or keep some local only.`,
          code: 'quota',
        },
        409,
      );
  }
}

function serializeHead(row: SyncedWorkspaceRow) {
  return {
    id: row.id,
    name: row.name,
    revision: Number(row.revision),
    meta: readStoredMeta(row.meta),
    metaVersion: Number(row.meta_version),
    updatedAt: row.updated_at,
    deleted: row.deleted_at !== null,
    cursor: Number(row.change_seq),
  };
}

/** For the account export: latest revisions as restorable backups, within a size bound. */
export async function exportSyncedWorkspaces(db: AppDatabase, userId: string) {
  let rows;
  try {
    rows = await db.exportSyncedWorkspaces(userId, WORKSPACE_EXPORT_LIMIT, WORKSPACE_EXPORT_BYTES);
  } catch (error) {
    if (isMissingSchemaError(error)) return [];
    throw error;
  }
  return rows.map((row) => {
    const meta = readStoredMeta(row.meta);
    return {
      id: row.id,
      name: row.name,
      revision: Number(row.revision),
      updatedAt: row.updated_at,
      ...meta,
      // A `.cvworkspace.json` document; null once the size bound is reached.
      backup: row.body === null ? null : parseStoredDocument(row.body, meta),
    };
  });
}

function parseStoredDocument(body: string, meta: WorkspaceMeta) {
  try {
    const document = JSON.parse(body) as unknown;
    return isRecord(document) ? { ...document, meta } : null;
  } catch {
    return null;
  }
}

function readStoredMeta(value: unknown): WorkspaceMeta {
  try {
    return parseWorkspaceMeta(value);
  } catch {
    return { ...EMPTY_META, tags: [] };
  }
}

function readRevision(value: string): number | null {
  const revision = /^[1-9]\d{0,6}$/.test(value) ? Number(value) : null;
  return revision !== null && revision <= MAX_REVISION ? revision : null;
}

function invalid(error: string): Response {
  return jsonResponse({ error, code: 'invalid' }, 400);
}

async function readSyncJson(request: Request, limitBytes: number): Promise<unknown | Response> {
  try {
    return await readLimitedJson(request, limitBytes);
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      return requestBodyTooLargeResponse(error);
    }
    throw error;
  }
}
