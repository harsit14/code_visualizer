import { jsonResponse } from './http';

type RateLimitOptions = {
  limit: number;
  namespace: string;
  windowMs: number;
};

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, RateLimitBucket>();

export function enforceIpRateLimit(
  request: Request,
  { limit, namespace, windowMs }: RateLimitOptions,
): Response | null {
  const now = Date.now();
  const key = `${namespace}:${clientIp(request)}`;
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }

  if (bucket.count >= limit) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    return jsonResponse({ error: 'Too many attempts. Try again in a minute.' }, 429, {
      'Retry-After': String(retryAfter),
      'X-RateLimit-Limit': String(limit),
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': String(Math.ceil(bucket.resetAt / 1000)),
    });
  }

  bucket.count += 1;
  return null;
}

export function resetRateLimitsForTests(): void {
  buckets.clear();
}

function clientIp(request: Request): string {
  return (
    request.headers.get('CF-Connecting-IP') ??
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

/** Durable fixed-window limiter. No process-local fallback when the DB fails. */
export async function enforceAuthRateLimit(
  env: import('./types').ServerEnv,
  request: Request,
  namespace: string,
  email?: string,
): Promise<Response | null> {
  const durable = env.MANAGED_AUTH_ENABLED === 'true' || env.AUTH_RATE_LIMIT_MODE === 'database';
  if (!durable) return enforceIpRateLimit(request, { namespace, limit: 5, windowMs: 60_000 });
  try {
    const { getDatabase } = await import('./database');
    const db = getDatabase(env);
    if (!db || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing rate limit database');
    // Trust only the edge-provided IP. Missing edge metadata uses one shared bucket.
    const target =
      email === undefined
        ? `ip:${request.headers.get('CF-Connecting-IP') ?? 'unknown'}`
        : `email:${email}`;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(env.SUPABASE_SERVICE_ROLE_KEY),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const digest = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(`auth-limit:${namespace}:${target}`),
    );
    const bucket = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    const result = await db.consumeAuthLimit(bucket, 5, 60);
    if (result.allowed) return null;
    return jsonResponse({ error: 'Too many attempts. Try again in a minute.' }, 429, {
      'Retry-After': String(Math.max(1, Math.ceil(result.retry_after))),
    });
  } catch {
    return jsonResponse(
      { error: 'Sign-in protection is temporarily unavailable. Please try again.' },
      503,
      { 'Retry-After': '60' },
    );
  }
}
