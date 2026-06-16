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
