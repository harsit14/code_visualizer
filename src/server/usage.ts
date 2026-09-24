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
      /** Returns the reserved explanation when no answer is delivered. */
      refund: () => Promise<void>;
    }
  | {
      ok: false;
      response: Response;
    };

const DEFAULT_ANON_DAILY_LIMIT = 3;
const DEFAULT_FREE_DAILY_LIMIT = 5;
const DEFAULT_PRO_DAILY_LIMIT = 250;
const DEFAULT_GLOBAL_DAILY_LIMIT = 2000;
const ADMIN_DAILY_LIMIT = Number.MAX_SAFE_INTEGER;
const GLOBAL_SUBJECT = 'global:explain';
const BURST_LIMIT = 8;
const BURST_WINDOW_MS = 60_000;

const noRefund = async () => {};

/**
 * Refunds are best effort: before migration 0003 is applied the RPC does not
 * exist, and the request still answers normally.
 */
async function refundQuietly(env: ServerEnv, subject: string, day: string) {
  try {
    await getDatabase(env)?.refundUsageDaily({ day, subject });
  } catch {
    // Missing migration or a transient database error; the reservation stands.
  }
}

/**
 * Reserves one AI explanation for the caller. The reservation counts toward the
 * daily limits immediately (so concurrent requests cannot overshoot) and is
 * refunded if the request is over a limit or no answer is delivered.
 */
export async function reserveExplainerUsage(
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
      refund: noRefund,
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

  const burst = enforceBurstLimit(subject);
  if (burst) return { ok: false, response: burst };

  const updatedAt = nowIso();
  const globalLimit = readLimit(env.EXPLAIN_GLOBAL_DAILY_LIMIT, DEFAULT_GLOBAL_DAILY_LIMIT);
  const countsGlobally = plan !== 'admin';
  if (countsGlobally) {
    const globalUsed = await db.incrementUsageDaily({
      day,
      plan: 'pro',
      subject: GLOBAL_SUBJECT,
      updatedAt,
    });
    if (globalUsed > globalLimit) {
      await refundQuietly(env, GLOBAL_SUBJECT, day);
      return {
        ok: false,
        response: jsonResponse(
          {
            error:
              'The AI explainer has reached its overall limit for today. Local step explanations still work.',
          },
          503,
          { 'Retry-After': nextUtcMidnightSeconds() },
        ),
      };
    }
  }

  const used = await db.incrementUsageDaily({ day, plan, subject, updatedAt });
  const refund = async () => {
    await refundQuietly(env, subject, day);
    if (countsGlobally) await refundQuietly(env, GLOBAL_SUBJECT, day);
  };

  if (used > limit) {
    // The over-limit attempt is returned so the counter reflects delivered answers.
    await refund();
    const snapshot: UsageSnapshot = { day, limit, plan, remaining: 0, used: limit };
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

  const snapshot: UsageSnapshot = {
    day,
    limit,
    plan,
    remaining: Math.max(0, limit - used),
    used,
  };
  return {
    headers: usageHeaders(snapshot),
    ok: true,
    snapshot,
    user: session?.user ?? null,
    refund,
  };
}

const bursts = new Map<string, { count: number; resetAt: number }>();

/** Per-isolate burst guard; the durable daily limits still apply across isolates. */
function enforceBurstLimit(subject: string): Response | null {
  const now = Date.now();
  const bucket = bursts.get(subject);
  if (!bucket || bucket.resetAt <= now) {
    bursts.set(subject, { count: 1, resetAt: now + BURST_WINDOW_MS });
    if (bursts.size > 5000) {
      for (const [key, value] of bursts) if (value.resetAt <= now) bursts.delete(key);
    }
    return null;
  }
  if (bucket.count >= BURST_LIMIT) {
    return jsonResponse({ error: 'Too many explanation requests. Wait a minute and retry.' }, 429, {
      'Retry-After': String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))),
    });
  }
  bucket.count += 1;
  return null;
}

export function resetExplainerBurstsForTests() {
  bursts.clear();
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
  return isAdminUserId(env, user.id) ? 'admin' : 'free';
}

/** Privileges are provisioned by immutable database ID, never signup email. */
export function isAdminUserId(env: ServerEnv, id: string): boolean {
  return (
    Boolean(id) && new Set((env.ADMIN_USER_IDS ?? '').split(/[\s,;]+/).filter(Boolean)).has(id)
  );
}

/**
 * Guests are counted by the edge-reported address only: a changed User-Agent does
 * not reset the quota, and client-supplied forwarding headers are ignored. IPv6
 * addresses are grouped by /64 because one connection usually owns the prefix.
 */
export async function anonymousSubject(env: ServerEnv, request: Request): Promise<string> {
  const address = request.headers.get('CF-Connecting-IP')?.trim() || 'unknown';
  const salt = env.ANON_USAGE_SALT ?? 'code-visualizer';
  return sha256Hex(`${salt}:${networkOf(address)}`);
}

export function networkOf(address: string): string {
  if (!address.includes(':')) return address;
  const [head] = address.split('::');
  const groups = address.includes('::')
    ? [
        ...head.split(':').filter(Boolean),
        ...Array(8 - address.split(':').filter(Boolean).length).fill('0'),
      ]
    : address.split(':');
  return `${groups
    .slice(0, 4)
    .map((group) => group.toLowerCase().padStart(4, '0'))
    .join(':')}::/64`;
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
