import { getSessionContext, sha256Hex } from './auth';
import { jsonResponse, nowIso } from './http';
import type { AccountPlan, AuthUser, ServerEnv } from './types';

type UsageRow = {
  count: number;
};

export type UsageSnapshot = {
  day: string;
  limit: number;
  plan: AccountPlan;
  remaining: number;
  used: number;
};

export type UsageDecision =
  | {
      headers: Record<string, string>;
      ok: true;
      snapshot: UsageSnapshot;
      user: AuthUser | null;
    }
  | {
      ok: false;
      response: Response;
    };

const DEFAULT_ANON_DAILY_LIMIT = 3;
const DEFAULT_FREE_DAILY_LIMIT = 5;
const DEFAULT_PRO_DAILY_LIMIT = 250;

export async function enforceExplainerUsage(
  env: ServerEnv,
  request: Request,
): Promise<UsageDecision> {
  if (env.DISABLE_USAGE_GATE === '1') {
    const snapshot = {
      day: usageDay(),
      limit: Number.MAX_SAFE_INTEGER,
      plan: 'pro' as const,
      remaining: Number.MAX_SAFE_INTEGER,
      used: 0,
    };
    return {
      headers: usageHeaders(snapshot),
      ok: true,
      snapshot,
      user: null,
    };
  }

  if (!env.DB) {
    return {
      ok: false,
      response: jsonResponse(
        {
          error:
            'Account database is not configured. Add the Cloudflare D1 DB binding before enabling the hosted AI explainer publicly.',
        },
        503,
      ),
    };
  }

  const session = await getSessionContext(env, request);
  const plan: AccountPlan = session ? 'free' : 'anonymous';
  const limit = limitForPlan(env, plan);
  const day = usageDay();
  const subject = session?.user.id
    ? `user:${session.user.id}`
    : `anon:${await anonymousSubject(env, request)}`;

  const row = await env.DB.prepare(
    `INSERT INTO usage_daily (subject, day, plan, count, updated_at)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(subject, day)
     DO UPDATE SET count = count + 1, plan = excluded.plan, updated_at = excluded.updated_at
     RETURNING count`,
  )
    .bind(subject, day, plan, nowIso())
    .first<UsageRow>();

  const used = Number(row?.count ?? 1);
  const snapshot: UsageSnapshot = {
    day,
    limit,
    plan,
    remaining: Math.max(0, limit - used),
    used,
  };

  if (used > limit) {
    return {
      ok: false,
      response: jsonResponse(
        {
          error:
            plan === 'anonymous'
              ? 'Daily guest AI explanation limit reached. Create a free account or try again tomorrow.'
              : 'Daily free account AI explanation limit reached. Try again tomorrow.',
          usage: snapshot,
        },
        429,
        usageHeaders(snapshot),
      ),
    };
  }

  return {
    headers: usageHeaders(snapshot),
    ok: true,
    snapshot,
    user: session?.user ?? null,
  };
}

export function usageHeaders(snapshot: UsageSnapshot): Record<string, string> {
  return {
    'X-Code-Visualizer-Plan': snapshot.plan,
    'X-RateLimit-Limit': String(snapshot.limit),
    'X-RateLimit-Remaining': String(snapshot.remaining),
    'X-RateLimit-Reset': nextUtcMidnightSeconds(),
    'X-RateLimit-Used': String(snapshot.used),
  };
}

export function usageDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function limitForPlan(env: ServerEnv, plan: AccountPlan): number {
  if (plan === 'pro') {
    return readLimit(env.PRO_DAILY_EXPLAIN_LIMIT, DEFAULT_PRO_DAILY_LIMIT);
  }
  if (plan === 'free') {
    return readLimit(env.FREE_DAILY_EXPLAIN_LIMIT, DEFAULT_FREE_DAILY_LIMIT);
  }
  return readLimit(env.ANON_DAILY_EXPLAIN_LIMIT, DEFAULT_ANON_DAILY_LIMIT);
}

async function anonymousSubject(env: ServerEnv, request: Request): Promise<string> {
  const address =
    request.headers.get('CF-Connecting-IP') ??
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ??
    'unknown';
  const agent = request.headers.get('User-Agent') ?? 'unknown';
  const salt = env.ANON_USAGE_SALT ?? 'code-visualizer';
  return sha256Hex(`${salt}:${address}:${agent}`);
}

function readLimit(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nextUtcMidnightSeconds(): string {
  const now = new Date();
  const reset = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) / 1000;
  return String(reset);
}
