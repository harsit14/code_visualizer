import { isRecord } from './http';
import type { AccountPlan, ServerEnv } from './types';

export type UserRow = {
  auth_method?: 'legacy' | 'supabase';
  created_at: string;
  email: string;
  id: string;
  stripe_customer_id: string | null;
};

export type UserWithPasswordRow = UserRow & {
  password_hash: string;
};

export type SessionRow = {
  auth_method?: 'legacy' | 'supabase';
  created_at: string;
  /** Absent until migration 0004 adds the column. */
  device_label?: string | null;
  expires_at: string;
  /** Absent until migration 0004 adds the column. */
  last_used_at?: string | null;
  token_hash: string;
  user_id: string;
};

export type SessionUserRow = UserRow & {
  session?: Pick<SessionRow, 'created_at' | 'device_label' | 'last_used_at'>;
};

export type UsageRow = {
  count: number;
  day: string;
  plan: string;
};

export type SubscriptionRow = {
  current_period_end: string | null;
  price_id: string | null;
  status: string;
  stripe_subscription_id: string | null;
  updated_at: string;
  user_id: string;
};

export type HistoryRow = {
  code: string;
  created_at: string;
  example_id: string | null;
  function_name: string | null;
  id: string;
  inputs_json: string | null;
  language: 'python' | 'javascript' | 'typescript';
  last_run_at: string;
  seed: number | null;
  title: string;
  updated_at: string;
  user_id: string;
};

export type HistoryUpdateRow = Omit<HistoryRow, 'created_at'>;

export type SubscriptionUpsertRow = SubscriptionRow & {
  stripe_customer_id: string | null;
};

/** A synced workspace head from migration 0005; `meta` is validated by the caller. */
export type SyncedWorkspaceRow = {
  change_seq: number;
  deleted_at: string | null;
  id: string;
  meta: unknown;
  meta_version: number;
  name: string;
  revision: number;
  updated_at: string;
};

export type WorkspaceSyncStatus =
  | 'conflict'
  | 'deleted'
  | 'duplicate'
  | 'missing'
  | 'quota'
  | 'stored';

export type WorkspaceSyncResult = {
  head: SyncedWorkspaceRow | null;
  status: WorkspaceSyncStatus;
};

export type WorkspacePushRow = {
  base_revision: number;
  body: string;
  max_bytes: number;
  max_workspaces: number;
  meta: unknown;
  name: string;
  user_id: string;
  workspace_id: string;
};

export type SyncedWorkspaceExportRow = {
  body: string | null;
  id: string;
  meta: unknown;
  name: string;
  revision: number;
  updated_at: string;
};

export type AppDatabase = {
  consumeAuthLimit(
    bucket: string,
    limit: number,
    windowSeconds: number,
  ): Promise<{ allowed: boolean; retry_after: number }>;
  completeManagedAuth(
    subject: string,
    email: string,
    legacyTokenHash: string | null,
    newTokenHash: string,
  ): Promise<UserRow>;
  billingEventExists(id: string): Promise<boolean>;
  createSession(row: {
    created_at: string;
    expires_at: string;
    token_hash: string;
    user_id: string;
  }): Promise<void>;
  createUser(row: {
    created_at: string;
    email: string;
    id: string;
    password_hash: string;
  }): Promise<void>;
  /** Atomic `delete_account` RPC from migration 0004. */
  deleteAccount(userId: string, tokenHash: string, providerSubject: string | null): Promise<void>;
  deleteHistoryItem(id: string, userId: string): Promise<void>;
  /** Deletes every session of the user except `keepTokenHash`; returns how many. */
  deleteOtherSessions(userId: string, keepTokenHash: string): Promise<number>;
  deleteSession(tokenHash: string): Promise<void>;
  /** Tombstones a synced workspace (`workspace_sync_delete`, migration 0005). */
  deleteSyncedWorkspace(userId: string, workspaceId: string): Promise<WorkspaceSyncResult>;
  deleteUserSession(tokenHash: string, userId: string): Promise<void>;
  /** Latest revision of each live synced workspace, bodies within `maxBytes`. */
  exportSyncedWorkspaces(
    userId: string,
    limit: number,
    maxBytes: number,
  ): Promise<SyncedWorkspaceExportRow[]>;
  findHistoryByIdempotencyKey(userId: string, key: string): Promise<HistoryRow | null>;
  findOwnedHistoryId(id: string, userId: string): Promise<string | null>;
  findSessionUser(tokenHash: string, expiresAfter: string): Promise<SessionUserRow | null>;
  findUserByEmail(email: string): Promise<UserWithPasswordRow | null>;
  findUserByStripeCustomerId(customerId: string): Promise<UserRow | null>;
  getHistoryItem(id: string, userId: string): Promise<HistoryRow | null>;
  getSubscriptionForUser(userId: string): Promise<SubscriptionRow | null>;
  /** The stored workspace document of one synced revision. */
  getSyncedRevision(userId: string, workspaceId: string, revision: number): Promise<string | null>;
  getUsageCount(subject: string, day: string): Promise<number>;
  incrementUsageDaily(params: {
    day: string;
    plan: AccountPlan;
    subject: string;
    updatedAt: string;
  }): Promise<number>;
  refundUsageDaily(params: { day: string; subject: string }): Promise<void>;
  getCachedExplanation(
    contextHash: string,
    createdAfter: string,
  ): Promise<{ answer: string; model: string } | null>;
  putCachedExplanation(row: {
    answer: string;
    context_hash: string;
    created_at: string;
    model: string;
  }): Promise<void>;
  insertBillingEvent(row: { created_at: string; id: string; type: string }): Promise<void>;
  insertHistory(row: HistoryRow): Promise<void>;
  /** Inserts unless (user_id, key) exists; returns whether a row was inserted. */
  insertHistoryOnce(row: HistoryRow, idempotencyKey: string): Promise<boolean>;
  listHistory(userId: string, limit: number): Promise<HistoryRow[]>;
  listSessions(userId: string, expiresAfter: string, limit: number): Promise<SessionRow[]>;
  /** Heads whose change number is above `after`, oldest change first. */
  listSyncedWorkspaces(userId: string, after: number, limit: number): Promise<SyncedWorkspaceRow[]>;
  listUsage(subject: string, limit: number): Promise<UsageRow[]>;
  pruneHistory(userId: string, keep: number): Promise<void>;
  /** Compare-and-append of one revision (`workspace_sync_push`, migration 0005). */
  pushWorkspaceRevision(row: WorkspacePushRow): Promise<WorkspaceSyncResult>;
  updateHistory(row: HistoryUpdateRow): Promise<void>;
  /** Compare-and-set of tags and review state (`workspace_sync_meta`, migration 0005). */
  updateSyncedWorkspaceMeta(
    userId: string,
    workspaceId: string,
    metaVersion: number,
    meta: unknown,
  ): Promise<WorkspaceSyncResult>;
  updateSessionMetadata(
    tokenHash: string,
    fields: { device_label?: string; last_used_at?: string },
  ): Promise<void>;
  updateUserStripeCustomerId(userId: string, customerId: string): Promise<void>;
  upsertSubscription(row: SubscriptionUpsertRow): Promise<void>;
};

type RequestOptions = {
  body?: unknown;
  method?: string;
  params?: Record<string, string | number | undefined>;
  prefer?: string;
};

export class DatabaseRequestError extends Error {
  readonly code?: string;
  readonly status: number;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'DatabaseRequestError';
    this.code = code;
    this.status = status;
  }
}

export function getDatabase(env: ServerEnv): AppDatabase | null {
  const url = env.SUPABASE_URL?.trim();
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) {
    return null;
  }
  return new SupabaseRestDatabase(url, serviceRoleKey, env.SUPABASE_SCHEMA);
}

// A column, table or function that a not-yet-applied migration would add.
const MISSING_SCHEMA_CODES = new Set([
  'PGRST202',
  'PGRST204',
  'PGRST205',
  '42703',
  '42883',
  '42P01',
  '42P10',
]);

export function isMissingSchemaError(error: unknown): boolean {
  return (
    error instanceof DatabaseRequestError &&
    error.code !== undefined &&
    MISSING_SCHEMA_CODES.has(error.code)
  );
}

export function isDatabaseUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof DatabaseRequestError &&
    (error.code === '23505' || error.message.toLowerCase().includes('duplicate key'))
  );
}

class SupabaseRestDatabase implements AppDatabase {
  private readonly restUrl: string;
  private readonly schema: string;
  private readonly serviceRoleKey: string;

  constructor(projectUrl: string, serviceRoleKey: string, schema?: string) {
    this.restUrl = `${projectUrl.replace(/\/+$/, '')}/rest/v1`;
    this.schema = schema?.trim() || 'public';
    this.serviceRoleKey = serviceRoleKey;
  }

  async consumeAuthLimit(bucket: string, limit: number, windowSeconds: number) {
    const rows = await this.request<Array<{ allowed: boolean; retry_after: number }>>(
      'rpc/consume_auth_limit',
      {
        method: 'POST',
        body: { p_bucket: bucket, p_limit: limit, p_window_seconds: windowSeconds },
      },
    );
    const row = rows?.[0];
    if (!row || typeof row.allowed !== 'boolean' || !Number.isFinite(row.retry_after))
      throw new Error('Invalid rate limit response.');
    return row;
  }

  async completeManagedAuth(
    subject: string,
    email: string,
    legacyTokenHash: string | null,
    newTokenHash: string,
  ): Promise<UserRow> {
    const rows = await this.request<UserRow[]>('rpc/complete_managed_auth', {
      method: 'POST',
      body: {
        p_subject: subject,
        p_email: email,
        p_legacy_token_hash: legacyTokenHash,
        p_new_token_hash: newTokenHash,
      },
    });
    if (!rows?.[0]?.id) throw new Error('Missing managed account.');
    return rows[0];
  }

  async billingEventExists(id: string): Promise<boolean> {
    const row = await this.first<{ id: string }>('billing_events', {
      id: eq(id),
      select: 'id',
    });
    return row !== null;
  }

  async createSession(row: {
    created_at: string;
    expires_at: string;
    token_hash: string;
    user_id: string;
  }): Promise<void> {
    await this.mutate('sessions', 'POST', row);
  }

  async createUser(row: {
    created_at: string;
    email: string;
    id: string;
    password_hash: string;
  }): Promise<void> {
    await this.mutate('users', 'POST', { ...row, stripe_customer_id: null });
  }

  async deleteAccount(
    userId: string,
    tokenHash: string,
    providerSubject: string | null,
  ): Promise<void> {
    await this.request<unknown>('rpc/delete_account', {
      method: 'POST',
      body: { p_user_id: userId, p_token_hash: tokenHash, p_provider_subject: providerSubject },
    });
  }

  async deleteHistoryItem(id: string, userId: string): Promise<void> {
    await this.mutate('code_history', 'DELETE', undefined, {
      id: eq(id),
      user_id: eq(userId),
    });
  }

  async deleteOtherSessions(userId: string, keepTokenHash: string): Promise<number> {
    const rows = await this.request<Array<{ token_hash: string }> | null>('sessions', {
      method: 'DELETE',
      params: { select: 'token_hash', token_hash: `neq.${keepTokenHash}`, user_id: eq(userId) },
      prefer: 'return=representation',
    });
    return rows?.length ?? 0;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.mutate('sessions', 'DELETE', undefined, {
      token_hash: eq(tokenHash),
    });
  }

  async deleteSyncedWorkspace(userId: string, workspaceId: string): Promise<WorkspaceSyncResult> {
    return this.syncCall('workspace_sync_delete', {
      p_user_id: userId,
      p_workspace_id: workspaceId,
    });
  }

  async deleteUserSession(tokenHash: string, userId: string): Promise<void> {
    await this.mutate('sessions', 'DELETE', undefined, {
      token_hash: eq(tokenHash),
      user_id: eq(userId),
    });
  }

  async exportSyncedWorkspaces(
    userId: string,
    limit: number,
    maxBytes: number,
  ): Promise<SyncedWorkspaceExportRow[]> {
    const rows = await this.request<SyncedWorkspaceExportRow[] | null>(
      'rpc/workspace_sync_export',
      {
        body: { p_user_id: userId, p_limit: limit, p_max_bytes: maxBytes },
        method: 'POST',
      },
    );
    return rows ?? [];
  }

  async findHistoryByIdempotencyKey(userId: string, key: string): Promise<HistoryRow | null> {
    return this.first<HistoryRow>('code_history', {
      idempotency_key: eq(key),
      select: historySelect,
      user_id: eq(userId),
    });
  }

  async findOwnedHistoryId(id: string, userId: string): Promise<string | null> {
    const row = await this.first<{ id: string }>('code_history', {
      id: eq(id),
      select: 'id',
      user_id: eq(userId),
    });
    return row?.id ?? null;
  }

  async findSessionUser(tokenHash: string, expiresAfter: string): Promise<SessionUserRow | null> {
    // `*` so metadata columns from migration 0004 are read when present.
    const session = await this.first<SessionRow>('sessions', {
      expires_at: gt(expiresAfter),
      select: '*',
      token_hash: eq(tokenHash),
    });
    if (!session) {
      return null;
    }
    const metadata: NonNullable<SessionUserRow['session']> = { created_at: session.created_at };
    if ('last_used_at' in session) {
      metadata.device_label = session.device_label ?? null;
      metadata.last_used_at = session.last_used_at ?? null;
    }
    if (session.auth_method === 'supabase') {
      const rows = await this.request<UserRow[]>('rpc/managed_session_user', {
        method: 'POST',
        body: { p_token_hash: tokenHash },
      });
      return rows[0] ? { ...rows[0], auth_method: 'supabase', session: metadata } : null;
    }
    const user = await this.findUserById(session.user_id);
    return user ? { ...user, session: metadata } : null;
  }

  async findUserByEmail(email: string): Promise<UserWithPasswordRow | null> {
    return this.first<UserWithPasswordRow>('users', {
      email: eq(email),
      select: 'id,email,password_hash,created_at,stripe_customer_id',
    });
  }

  async findUserByStripeCustomerId(customerId: string): Promise<UserRow | null> {
    return this.first<UserRow>('users', {
      select: 'id,email,created_at,stripe_customer_id',
      stripe_customer_id: eq(customerId),
    });
  }

  async getHistoryItem(id: string, userId: string): Promise<HistoryRow | null> {
    return this.first<HistoryRow>('code_history', {
      id: eq(id),
      select: historySelect,
      user_id: eq(userId),
    });
  }

  async getSubscriptionForUser(userId: string): Promise<SubscriptionRow | null> {
    return this.first<SubscriptionRow>('subscriptions', {
      select: 'user_id,stripe_subscription_id,status,price_id,current_period_end,updated_at',
      user_id: eq(userId),
    });
  }

  async getSyncedRevision(
    userId: string,
    workspaceId: string,
    revision: number,
  ): Promise<string | null> {
    const row = await this.first<{ body: string }>('synced_workspace_revisions', {
      revision: eq(revision),
      select: 'body',
      user_id: eq(userId),
      workspace_id: eq(workspaceId),
    });
    return row?.body ?? null;
  }

  async getUsageCount(subject: string, day: string): Promise<number> {
    const row = await this.first<{ count: number }>('usage_daily', {
      day: eq(day),
      select: 'count',
      subject: eq(subject),
    });
    return Number(row?.count ?? 0);
  }

  async incrementUsageDaily({
    day,
    plan,
    subject,
    updatedAt,
  }: {
    day: string;
    plan: AccountPlan;
    subject: string;
    updatedAt: string;
  }): Promise<number> {
    const rows = await this.request<Array<{ new_count: number }>>('rpc/increment_usage_daily', {
      body: {
        p_day: day,
        p_plan: plan,
        p_subject: subject,
        p_updated_at: updatedAt,
      },
      method: 'POST',
    });
    return Number(rows[0]?.new_count ?? 1);
  }

  async refundUsageDaily({ day, subject }: { day: string; subject: string }): Promise<void> {
    await this.request<null>('rpc/refund_usage_daily', {
      body: { p_day: day, p_subject: subject },
      method: 'POST',
    });
  }

  async getCachedExplanation(
    contextHash: string,
    createdAfter: string,
  ): Promise<{ answer: string; model: string } | null> {
    return this.first<{ answer: string; model: string }>('explain_cache', {
      context_hash: eq(contextHash),
      created_at: `gte.${createdAfter}`,
      select: 'answer,model',
    });
  }

  async putCachedExplanation(row: {
    answer: string;
    context_hash: string;
    created_at: string;
    model: string;
  }): Promise<void> {
    await this.request<null>('explain_cache', {
      body: row,
      method: 'POST',
      params: { on_conflict: 'context_hash' },
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
  }

  async insertBillingEvent(row: { created_at: string; id: string; type: string }): Promise<void> {
    await this.mutate('billing_events', 'POST', row);
  }

  async insertHistory(row: HistoryRow): Promise<void> {
    await this.mutate('code_history', 'POST', row);
  }

  async insertHistoryOnce(row: HistoryRow, idempotencyKey: string): Promise<boolean> {
    // ON CONFLICT DO NOTHING: a replayed key returns no row instead of an error.
    const rows = await this.request<Array<{ id: string }> | null>('code_history', {
      body: { ...row, idempotency_key: idempotencyKey },
      method: 'POST',
      params: { on_conflict: 'user_id,idempotency_key', select: 'id' },
      prefer: 'resolution=ignore-duplicates,return=representation',
    });
    return (rows?.length ?? 0) > 0;
  }

  async listHistory(userId: string, limit: number): Promise<HistoryRow[]> {
    return this.select<HistoryRow>('code_history', {
      limit,
      order: 'last_run_at.desc',
      select: historySelect,
      user_id: eq(userId),
    });
  }

  async listSessions(userId: string, expiresAfter: string, limit: number): Promise<SessionRow[]> {
    return this.select<SessionRow>('sessions', {
      expires_at: gt(expiresAfter),
      limit,
      order: 'created_at.desc',
      select: '*',
      user_id: eq(userId),
    });
  }

  async listSyncedWorkspaces(
    userId: string,
    after: number,
    limit: number,
  ): Promise<SyncedWorkspaceRow[]> {
    return this.select<SyncedWorkspaceRow>('synced_workspaces', {
      change_seq: gt(after),
      limit,
      order: 'change_seq.asc',
      select: 'id,name,revision,meta,meta_version,change_seq,updated_at,deleted_at',
      user_id: eq(userId),
    });
  }

  async listUsage(subject: string, limit: number): Promise<UsageRow[]> {
    return this.select<UsageRow>('usage_daily', {
      limit,
      order: 'day.desc',
      select: 'day,plan,count',
      subject: eq(subject),
    });
  }

  async pruneHistory(userId: string, keep: number): Promise<void> {
    const rows = await this.select<{ id: string }>('code_history', {
      limit: 1000,
      order: 'last_run_at.desc',
      select: 'id',
      user_id: eq(userId),
    });
    const staleIds = rows.slice(keep).map((row) => row.id);
    if (staleIds.length === 0) {
      return;
    }
    await this.mutate('code_history', 'DELETE', undefined, {
      id: inList(staleIds),
      user_id: eq(userId),
    });
  }

  async pushWorkspaceRevision(row: WorkspacePushRow): Promise<WorkspaceSyncResult> {
    return this.syncCall('workspace_sync_push', {
      p_base_revision: row.base_revision,
      p_body: row.body,
      p_max_bytes: row.max_bytes,
      p_max_workspaces: row.max_workspaces,
      p_meta: row.meta,
      p_name: row.name,
      p_user_id: row.user_id,
      p_workspace_id: row.workspace_id,
    });
  }

  async updateSyncedWorkspaceMeta(
    userId: string,
    workspaceId: string,
    metaVersion: number,
    meta: unknown,
  ): Promise<WorkspaceSyncResult> {
    return this.syncCall('workspace_sync_meta', {
      p_meta: meta,
      p_meta_version: metaVersion,
      p_user_id: userId,
      p_workspace_id: workspaceId,
    });
  }

  async updateHistory(row: HistoryUpdateRow): Promise<void> {
    await this.mutate(
      'code_history',
      'PATCH',
      {
        code: row.code,
        example_id: row.example_id,
        function_name: row.function_name,
        inputs_json: row.inputs_json,
        language: row.language,
        last_run_at: row.last_run_at,
        seed: row.seed,
        title: row.title,
        updated_at: row.updated_at,
      },
      {
        id: eq(row.id),
        user_id: eq(row.user_id),
      },
    );
  }

  async updateSessionMetadata(
    tokenHash: string,
    fields: { device_label?: string; last_used_at?: string },
  ): Promise<void> {
    await this.mutate('sessions', 'PATCH', fields, { token_hash: eq(tokenHash) });
  }

  async updateUserStripeCustomerId(userId: string, customerId: string): Promise<void> {
    await this.mutate('users', 'PATCH', { stripe_customer_id: customerId }, { id: eq(userId) });
  }

  async upsertSubscription(row: SubscriptionUpsertRow): Promise<void> {
    await this.request<null>('subscriptions', {
      body: row,
      method: 'POST',
      params: { on_conflict: 'user_id' },
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
  }

  private async findUserById(id: string): Promise<UserRow | null> {
    return this.first<UserRow>('users', {
      id: eq(id),
      select: 'id,email,created_at,stripe_customer_id',
    });
  }

  private async syncCall(fn: string, body: Record<string, unknown>): Promise<WorkspaceSyncResult> {
    const result = await this.request<WorkspaceSyncResult | null>(`rpc/${fn}`, {
      body,
      method: 'POST',
    });
    if (!isRecord(result) || typeof result.status !== 'string') {
      throw new Error('Invalid workspace sync response.');
    }
    return result;
  }

  private async first<T>(
    table: string,
    params: Record<string, string | number>,
  ): Promise<T | null> {
    const rows = await this.select<T>(table, { ...params, limit: 1 });
    return rows[0] ?? null;
  }

  private async mutate(
    table: string,
    method: 'DELETE' | 'PATCH' | 'POST',
    body?: unknown,
    params?: Record<string, string | number>,
  ): Promise<void> {
    await this.request<null>(table, {
      body,
      method,
      params,
      prefer: 'return=minimal',
    });
  }

  private async select<T>(table: string, params: Record<string, string | number>): Promise<T[]> {
    return this.request<T[]>(table, { params });
  }

  private async request<T>(resource: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method ?? 'GET';
    const url = new URL(`${this.restUrl}/${resource}`);
    Object.entries(options.params ?? {}).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    });

    const headers = new Headers({
      Accept: 'application/json',
      Authorization: `Bearer ${this.serviceRoleKey}`,
      apikey: this.serviceRoleKey,
    });
    if (this.schema !== 'public') {
      headers.set('Accept-Profile', this.schema);
      if (method !== 'GET' && method !== 'HEAD') {
        headers.set('Content-Profile', this.schema);
      }
    }
    if (options.prefer) {
      headers.set('Prefer', options.prefer);
    }
    if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(url, {
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      headers,
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();

    if (!response.ok) {
      throw supabaseError(response.status, text);
    }
    if (!text || response.status === 204) {
      return null as T;
    }
    return JSON.parse(text) as T;
  }
}

const historySelect =
  'id,user_id,title,language,code,inputs_json,function_name,seed,example_id,created_at,updated_at,last_run_at';

function eq(value: string | number): string {
  return `eq.${value}`;
}

function gt(value: string | number): string {
  return `gt.${value}`;
}

function inList(values: string[]): string {
  return `in.(${values.join(',')})`;
}

function supabaseError(status: number, text: string): DatabaseRequestError {
  const payload = parseJson(text);
  if (isRecord(payload)) {
    const message =
      typeof payload.message === 'string'
        ? payload.message
        : `Supabase database request failed (${status}).`;
    const code = typeof payload.code === 'string' ? payload.code : undefined;
    return new DatabaseRequestError(message, status, code);
  }
  return new DatabaseRequestError(text || `Supabase database request failed (${status}).`, status);
}

function parseJson(value: string): unknown {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
