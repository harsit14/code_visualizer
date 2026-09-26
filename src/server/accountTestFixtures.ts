import { vi } from 'vitest';
import { hashPassword, sha256Hex } from './auth';
import {
  DatabaseRequestError,
  type AppDatabase,
  type HistoryRow,
  type SessionRow,
  type SyncedWorkspaceRow,
  type UserWithPasswordRow,
  type WorkspacePushRow,
  type WorkspaceSyncResult,
} from './database';

export const TEST_PEPPER_ENV = { PASSWORD_PEPPER: 'test-pepper' };
export const ALICE_PASSWORD = 'correct horse battery staple';
export const ALICE = '50000000-0000-4000-8000-000000000001';
export const BOB = '50000000-0000-4000-8000-000000000002';
export const ALICE_TOKEN = 'a'.repeat(43);
export const ALICE_LAPTOP_TOKEN = 'l'.repeat(43);
export const BOB_TOKEN = 'b'.repeat(43);

type StoredHistory = HistoryRow & { idempotency_key: string | null };
type StoredWorkspace = SyncedWorkspaceRow & { user_id: string; bytes: number };
type StoredRevision = { user_id: string; workspace_id: string; revision: number; body: string };

const EMPTY_TAGS = { tags: [], needsReview: false, reviewBy: null };

/**
 * An in-memory stand-in for the Supabase adapter that follows the SQL rules of
 * migrations 0001-0005 (the real SQL is exercised by the *Migration tests).
 * `migrated: false` behaves like a database without 0004 and 0005;
 * `workspaceSync: false` like one without 0005.
 */
export async function createAccountFixture({
  migrated = true,
  workspaceSync = migrated,
}: { migrated?: boolean; workspaceSync?: boolean } = {}) {
  const day = new Date(Date.now() + 86_400_000).toISOString();
  const users: Array<UserWithPasswordRow & { auth_method?: 'legacy' | 'supabase' }> = [
    {
      created_at: '2026-01-01T00:00:00.000Z',
      email: 'alice@example.com',
      id: ALICE,
      password_hash: await hashPassword(TEST_PEPPER_ENV, ALICE_PASSWORD),
      stripe_customer_id: null,
    },
    {
      created_at: '2026-02-01T00:00:00.000Z',
      email: 'bob@example.com',
      id: BOB,
      password_hash: await hashPassword(TEST_PEPPER_ENV, 'bob password 123'),
      stripe_customer_id: null,
    },
  ];
  const sessions: SessionRow[] = [
    session(
      await sha256Hex(ALICE_TOKEN),
      ALICE,
      '2026-09-20T00:00:00.000Z',
      day,
      'Chrome on macOS',
    ),
    session(
      await sha256Hex(ALICE_LAPTOP_TOKEN),
      ALICE,
      '2026-09-10T00:00:00.000Z',
      day,
      'Firefox on Windows',
    ),
    session(await sha256Hex(BOB_TOKEN), BOB, '2026-09-21T00:00:00.000Z', day, null),
  ];
  const history: StoredHistory[] = [
    historyRow('alice-history', ALICE),
    historyRow('bob-history', BOB),
  ];
  const usage = [
    { subject: `user:${ALICE}`, day: '2026-09-24', plan: 'free', count: 3 },
    { subject: `user:${BOB}`, day: '2026-09-24', plan: 'free', count: 1 },
  ];
  const identities: Array<{ subject: string; userId: string }> = [];
  const workspaces: StoredWorkspace[] = [];
  const revisions: StoredRevision[] = [];
  let changeSeq = 0;

  const missing = (code: string) => new DatabaseRequestError('missing migration 0004', 400, code);
  const requireSync = (code: 'PGRST202' | 'PGRST205') => {
    if (!workspaceSync) throw new DatabaseRequestError('missing migration 0005', 404, code);
  };
  const headOf = (row: StoredWorkspace): SyncedWorkspaceRow => ({
    change_seq: row.change_seq,
    deleted_at: row.deleted_at,
    id: row.id,
    meta: structuredClone(row.meta),
    meta_version: row.meta_version,
    name: row.name,
    revision: row.revision,
    updated_at: row.updated_at,
  });
  const findWorkspace = (userId: string, id: string) =>
    workspaces.find((w) => w.user_id === userId && w.id === id);
  const lockUser = (userId: string) => {
    if (!users.some((u) => u.id === userId)) {
      throw new DatabaseRequestError('account_missing', 400, 'P0001');
    }
  };
  const result = (
    status: WorkspaceSyncResult['status'],
    row?: StoredWorkspace,
  ): WorkspaceSyncResult => ({ status, head: row ? headOf(row) : null });
  const bump = (row: StoredWorkspace) => {
    row.change_seq = ++changeSeq;
    row.updated_at = new Date().toISOString();
  };
  const visible = (row: SessionRow): SessionRow => {
    const copy = { ...row };
    if (!migrated) {
      delete copy.device_label;
      delete copy.last_used_at;
    }
    return copy;
  };
  const removeWhere = <T>(rows: T[], match: (row: T) => boolean) => {
    const removed = rows.filter(match);
    removed.forEach((row) => rows.splice(rows.indexOf(row), 1));
    return removed.length;
  };

  const db = {
    consumeAuthLimit: vi.fn(async () => ({ allowed: true, retry_after: 60 })),
    getSubscriptionForUser: vi.fn(async () => null),
    getUsageCount: vi.fn(async () => 0),
    findSessionUser: vi.fn(async (tokenHash: string, expiresAfter: string) => {
      const found = sessions.find((s) => s.token_hash === tokenHash && s.expires_at > expiresAfter);
      const user = found && users.find((u) => u.id === found.user_id);
      if (!found || !user) return null;
      const { created_at, device_label, last_used_at } = visible(found);
      return {
        created_at: user.created_at,
        email: user.email,
        id: user.id,
        stripe_customer_id: user.stripe_customer_id,
        auth_method: found.auth_method,
        session: migrated ? { created_at, device_label, last_used_at } : { created_at },
      };
    }),
    updateSessionMetadata: vi.fn(
      async (tokenHash: string, fields: { device_label?: string; last_used_at?: string }) => {
        if (!migrated) throw missing('PGRST204');
        const found = sessions.find((s) => s.token_hash === tokenHash);
        if (found) Object.assign(found, fields);
      },
    ),
    listSessions: vi.fn(async (userId: string, expiresAfter: string, limit: number) =>
      sessions
        .filter((s) => s.user_id === userId && s.expires_at > expiresAfter)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, limit)
        .map(visible),
    ),
    deleteUserSession: vi.fn(async (tokenHash: string, userId: string) => {
      removeWhere(sessions, (s) => s.token_hash === tokenHash && s.user_id === userId);
    }),
    deleteOtherSessions: vi.fn(async (userId: string, keep: string) =>
      removeWhere(sessions, (s) => s.user_id === userId && s.token_hash !== keep),
    ),
    findUserByEmail: vi.fn(async (email: string) => users.find((u) => u.email === email) ?? null),
    listHistory: vi.fn(async (userId: string, limit: number) =>
      history.filter((h) => h.user_id === userId).slice(0, limit),
    ),
    listUsage: vi.fn(async (subject: string, limit: number) =>
      usage.filter((u) => u.subject === subject).slice(0, limit),
    ),
    deleteAccount: vi.fn(async (userId: string, tokenHash: string, subject: string | null) => {
      if (!migrated) throw new DatabaseRequestError('Could not find the function', 404, 'PGRST202');
      const user = users.find((u) => u.id === userId);
      const now = new Date().toISOString();
      if (
        !user ||
        !sessions.some(
          (s) => s.token_hash === tokenHash && s.user_id === userId && s.expires_at > now,
        )
      ) {
        throw new DatabaseRequestError('session_required', 400, 'P0001');
      }
      if (
        user.password_hash === '!managed:supabase' &&
        !identities.some((i) => i.subject === subject && i.userId === userId)
      ) {
        throw new DatabaseRequestError('reauthentication_required', 400, 'P0001');
      }
      removeWhere(usage, (u) => u.subject === `user:${userId}`);
      removeWhere(history, (h) => h.user_id === userId);
      removeWhere(workspaces, (w) => w.user_id === userId);
      removeWhere(revisions, (r) => r.user_id === userId);
      removeWhere(sessions, (s) => s.user_id === userId);
      removeWhere(identities, (i) => i.userId === userId);
      removeWhere(users, (u) => u.id === userId);
    }),
    findOwnedHistoryId: vi.fn(
      async (id: string, userId: string) =>
        history.find((h) => h.id === id && h.user_id === userId)?.id ?? null,
    ),
    getHistoryItem: vi.fn(
      async (id: string, userId: string) =>
        history.find((h) => h.id === id && h.user_id === userId) ?? null,
    ),
    insertHistory: vi.fn(async (row: HistoryRow) => {
      history.push({ ...row, idempotency_key: null });
    }),
    insertHistoryOnce: vi.fn(async (row: HistoryRow, key: string) => {
      if (!migrated) throw missing('PGRST204');
      if (history.some((h) => h.user_id === row.user_id && h.idempotency_key === key)) return false;
      history.push({ ...row, idempotency_key: key });
      return true;
    }),
    findHistoryByIdempotencyKey: vi.fn(
      async (userId: string, key: string) =>
        history.find((h) => h.user_id === userId && h.idempotency_key === key) ?? null,
    ),
    updateHistory: vi.fn(async () => {}),
    pruneHistory: vi.fn(async () => {}),
    listSyncedWorkspaces: vi.fn(async (userId: string, after: number, limit: number) => {
      requireSync('PGRST205');
      return workspaces
        .filter((w) => w.user_id === userId && w.change_seq > after)
        .sort((a, b) => a.change_seq - b.change_seq)
        .slice(0, limit)
        .map(headOf);
    }),
    getSyncedRevision: vi.fn(async (userId: string, id: string, revision: number) => {
      requireSync('PGRST205');
      return (
        revisions.find(
          (r) => r.user_id === userId && r.workspace_id === id && r.revision === revision,
        )?.body ?? null
      );
    }),
    pushWorkspaceRevision: vi.fn(async (row: WorkspacePushRow) => {
      requireSync('PGRST202');
      lockUser(row.user_id);
      const head = findWorkspace(row.user_id, row.workspace_id);
      const next = row.base_revision + 1;
      if (head && !head.deleted_at) {
        const stored = revisions.find(
          (r) =>
            r.user_id === row.user_id && r.workspace_id === row.workspace_id && r.revision === next,
        );
        if (stored || head.revision !== row.base_revision) {
          return result(stored?.body === row.body ? 'duplicate' : 'conflict', head);
        }
      } else if (row.base_revision > 0) {
        return result(head ? 'deleted' : 'missing', head);
      }
      const size = new TextEncoder().encode(row.body).length;
      const own = workspaces.filter((w) => w.user_id === row.user_id);
      if (
        (!head || head.deleted_at) &&
        own.filter((w) => !w.deleted_at).length >= row.max_workspaces
      ) {
        return result('quota');
      }
      if (own.reduce((sum, w) => sum + w.bytes, 0) + size > row.max_bytes) {
        return result('quota');
      }
      let stored = head;
      if (!stored) {
        stored = {
          user_id: row.user_id,
          id: row.workspace_id,
          name: row.name,
          revision: 1,
          meta: structuredClone(row.meta),
          meta_version: 0,
          bytes: size,
          change_seq: 0,
          updated_at: '',
          deleted_at: null,
        };
        workspaces.push(stored);
      } else {
        const revived = stored.deleted_at !== null;
        Object.assign(stored, {
          name: row.name,
          revision: next,
          meta: revived ? structuredClone(row.meta) : stored.meta,
          meta_version: stored.meta_version + (revived ? 1 : 0),
          bytes: (revived ? 0 : stored.bytes) + size,
          deleted_at: null,
        });
      }
      bump(stored);
      revisions.push({
        user_id: row.user_id,
        workspace_id: row.workspace_id,
        revision: next,
        body: row.body,
      });
      return result('stored', stored);
    }),
    updateSyncedWorkspaceMeta: vi.fn(
      async (userId: string, id: string, metaVersion: number, meta: unknown) => {
        requireSync('PGRST202');
        lockUser(userId);
        const head = findWorkspace(userId, id);
        if (!head) return result('missing');
        if (head.deleted_at) return result('deleted', head);
        if (
          head.meta_version === metaVersion + 1 &&
          JSON.stringify(head.meta) === JSON.stringify(meta)
        ) {
          return result('duplicate', head);
        }
        if (head.meta_version !== metaVersion) return result('conflict', head);
        head.meta = structuredClone(meta);
        head.meta_version += 1;
        bump(head);
        return result('stored', head);
      },
    ),
    deleteSyncedWorkspace: vi.fn(async (userId: string, id: string) => {
      requireSync('PGRST202');
      lockUser(userId);
      const head = findWorkspace(userId, id);
      if (!head) return result('missing');
      if (head.deleted_at) return result('duplicate', head);
      removeWhere(revisions, (r) => r.user_id === userId && r.workspace_id === id);
      Object.assign(head, {
        name: 'Removed workspace',
        meta: structuredClone(EMPTY_TAGS),
        bytes: 0,
        deleted_at: new Date().toISOString(),
      });
      bump(head);
      return result('stored', head);
    }),
    exportSyncedWorkspaces: vi.fn(async (userId: string, limit: number, maxBytes: number) => {
      requireSync('PGRST202');
      let running = 0;
      return workspaces
        .filter((w) => w.user_id === userId && !w.deleted_at)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id))
        .slice(0, limit)
        .map((w) => {
          const body =
            revisions.find(
              (r) => r.user_id === userId && r.workspace_id === w.id && r.revision === w.revision,
            )?.body ?? '';
          running += new TextEncoder().encode(body).length;
          return {
            id: w.id,
            name: w.name,
            revision: w.revision,
            meta: structuredClone(w.meta),
            updated_at: w.updated_at,
            body: running <= maxBytes ? body : null,
          };
        });
    }),
  };

  return {
    db,
    database: db as unknown as AppDatabase,
    history,
    identities,
    revisions,
    sessions,
    usage,
    users,
    workspaces,
  };
}

export function cookie(token: string): Record<string, string> {
  return { Cookie: `cv_session=${token}` };
}

function session(
  tokenHash: string,
  userId: string,
  createdAt: string,
  expiresAt: string,
  device: string | null,
): SessionRow {
  return {
    auth_method: 'legacy',
    created_at: createdAt,
    device_label: device,
    expires_at: expiresAt,
    last_used_at: null,
    token_hash: tokenHash,
    user_id: userId,
  };
}

function historyRow(id: string, userId: string): StoredHistory {
  return {
    code: `print("${id}")`,
    created_at: '2026-09-01T00:00:00.000Z',
    example_id: null,
    function_name: null,
    id,
    idempotency_key: null,
    inputs_json: null,
    language: 'python',
    last_run_at: '2026-09-01T00:00:00.000Z',
    seed: null,
    title: id,
    updated_at: '2026-09-01T00:00:00.000Z',
    user_id: userId,
  };
}
