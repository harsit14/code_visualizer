import { isRecord } from './http';
import type { AccountPlan, ServerEnv } from './types';

export type UserRow = {
  created_at: string;
  email: string;
  id: string;
  stripe_customer_id: string | null;
};

export type UserWithPasswordRow = UserRow & {
  password_hash: string;
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

export type AppDatabase = {
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
  deleteHistoryItem(id: string, userId: string): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
  findOwnedHistoryId(id: string, userId: string): Promise<string | null>;
  findSessionUser(tokenHash: string, expiresAfter: string): Promise<UserRow | null>;
  findUserByEmail(email: string): Promise<UserWithPasswordRow | null>;
  findUserByStripeCustomerId(customerId: string): Promise<UserRow | null>;
  getHistoryItem(id: string, userId: string): Promise<HistoryRow | null>;
  getSubscriptionForUser(userId: string): Promise<SubscriptionRow | null>;
  getUsageCount(subject: string, day: string): Promise<number>;
  incrementUsageDaily(params: {
    day: string;
    plan: AccountPlan;
    subject: string;
    updatedAt: string;
  }): Promise<number>;
  insertBillingEvent(row: { created_at: string; id: string; type: string }): Promise<void>;
  insertHistory(row: HistoryRow): Promise<void>;
  listHistory(userId: string, limit: number): Promise<HistoryRow[]>;
  pruneHistory(userId: string, keep: number): Promise<void>;
  updateHistory(row: HistoryUpdateRow): Promise<void>;
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

  async deleteHistoryItem(id: string, userId: string): Promise<void> {
    await this.mutate('code_history', 'DELETE', undefined, {
      id: eq(id),
      user_id: eq(userId),
    });
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.mutate('sessions', 'DELETE', undefined, {
      token_hash: eq(tokenHash),
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

  async findSessionUser(tokenHash: string, expiresAfter: string): Promise<UserRow | null> {
    const session = await this.first<{ user_id: string }>('sessions', {
      expires_at: gt(expiresAfter),
      select: 'user_id',
      token_hash: eq(tokenHash),
    });
    return session ? this.findUserById(session.user_id) : null;
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
      select:
        'user_id,stripe_subscription_id,status,price_id,current_period_end,updated_at',
      user_id: eq(userId),
    });
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

  async insertBillingEvent(row: { created_at: string; id: string; type: string }): Promise<void> {
    await this.mutate('billing_events', 'POST', row);
  }

  async insertHistory(row: HistoryRow): Promise<void> {
    await this.mutate('code_history', 'POST', row);
  }

  async listHistory(userId: string, limit: number): Promise<HistoryRow[]> {
    return this.select<HistoryRow>('code_history', {
      limit,
      order: 'last_run_at.desc',
      select: historySelect,
      user_id: eq(userId),
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

  async updateUserStripeCustomerId(userId: string, customerId: string): Promise<void> {
    await this.mutate(
      'users',
      'PATCH',
      { stripe_customer_id: customerId },
      { id: eq(userId) },
    );
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

  private async first<T>(table: string, params: Record<string, string | number>): Promise<T | null> {
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

  private async select<T>(
    table: string,
    params: Record<string, string | number>,
  ): Promise<T[]> {
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
  return new DatabaseRequestError(
    text || `Supabase database request failed (${status}).`,
    status,
  );
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
