import { getSessionContext, sha256Hex } from './auth';
import { getDatabase } from './database';
import { jsonResponse, nowIso } from './http';
import type { AccountPlan, AuthUser, ServerEnv } from './types';

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
const ADMIN_DAILY_LIMIT = Number.MAX_SAFE_INTEGER;

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

  const db = getDatabase(env);
  if (!db) {
    return {
      ok: false,
      response: jsonResponse(
        {
          error:
            'Account database is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before enabling the hosted AI explainer publicly.',
        },
        503,
      ),
    };
  }

  const session = await getSessionContext(env, request);
  const plan = planForUser(env, session?.user ?? null);
  const limit = limitForPlan(env, plan);
  const day = usageDay();
  const subject = session?.user.id
    ? `user:${session.user.id}`
    : `anon:${await anonymousSubject(env, request)}`;

  const used = await db.incrementUsageDaily({
    day,
    plan,
    subject,
    updatedAt: nowIso(),
  });
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
  if (plan === 'admin') {
    return ADMIN_DAILY_LIMIT;
  }
  if (plan === 'pro') {
    return readLimit(env.PRO_DAILY_EXPLAIN_LIMIT, DEFAULT_PRO_DAILY_LIMIT);
  }
  if (plan === 'free') {
    return readLimit(env.FREE_DAILY_EXPLAIN_LIMIT, DEFAULT_FREE_DAILY_LIMIT);
  }
  return readLimit(env.ANON_DAILY_EXPLAIN_LIMIT, DEFAULT_ANON_DAILY_LIMIT);
}

export function planForUser(env: ServerEnv, user: AuthUser | null): AccountPlan {
  if (!user) {
    return 'anonymous';
  }
  return isAdminEmail(env, user.email) ? 'admin' : 'free';
}

export function isAdminEmail(env: ServerEnv, email: string): boolean {
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return adminEmailSet(env).has(normalized);
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

function adminEmailSet(env: ServerEnv): Set<string> {
  return new Set(
    (env.ADMIN_EMAILS ?? '')
      .split(/[\s,;]+/)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

function nextUtcMidnightSeconds(): string {
  const now = new Date();
  const reset = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) / 1000;
  return String(reset);
}
