import { normalizeEmail } from './auth';
import { isRecord } from './http';
import type { ServerEnv } from './types';

export class ManagedAuthError extends Error {
  constructor(
    message: string,
    readonly status = 503,
  ) {
    super(message);
  }
}
export function managedAuthEnabled(env: ServerEnv): boolean {
  return env.MANAGED_AUTH_ENABLED === 'true';
}

async function providerRequest(
  env: ServerEnv,
  path: 'otp' | 'verify',
  body: object,
): Promise<unknown> {
  const key = env.SUPABASE_ANON_KEY?.trim();
  let url: URL;
  try {
    url = new URL(env.SUPABASE_URL ?? '');
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      !key
    )
      throw new Error();
  } catch {
    throw new ManagedAuthError('Email sign-in is not configured. Please try again later.');
  }
  let response: Response;
  try {
    response = await fetch(new URL(`/auth/v1/${path}`, url), {
      method: 'POST',
      headers: { apikey: key!, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    });
  } catch {
    throw new ManagedAuthError('Email sign-in is temporarily unavailable. Please try again.');
  }
  if (!response.ok) {
    if (response.status === 429)
      throw new ManagedAuthError('Too many attempts. Wait a minute before trying again.', 429);
    if (path === 'verify' && [400, 401, 403, 422].includes(response.status))
      throw new ManagedAuthError('That code is invalid or expired. Request a new code.', 401);
    throw new ManagedAuthError('Email sign-in is temporarily unavailable. Please try again.');
  }
  try {
    return await response.json();
  } catch {
    throw new ManagedAuthError('Email sign-in returned an invalid response. Please try again.');
  }
}
export async function sendEmailCode(env: ServerEnv, email: string): Promise<void> {
  await providerRequest(env, 'otp', { email, create_user: true });
}
export async function verifyEmailCode(
  env: ServerEnv,
  email: string,
  token: string,
): Promise<string> {
  const payload = await providerRequest(env, 'verify', { email, token, type: 'email' });
  const user = isRecord(payload) ? payload.user : null;
  if (
    !isRecord(user) ||
    typeof user.id !== 'string' ||
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(user.id) ||
    normalizeEmail(user.email) !== email ||
    typeof user.email_confirmed_at !== 'string' ||
    !Number.isFinite(Date.parse(user.email_confirmed_at)) ||
    (typeof user.banned_until === 'string' && Date.parse(user.banned_until) > Date.now())
  ) {
    throw new ManagedAuthError('Email ownership could not be verified.', 401);
  }
  if (
    Array.isArray(user.factors) &&
    user.factors.some((f) => isRecord(f) && f.status === 'verified')
  ) {
    throw new ManagedAuthError(
      'This identity requires additional verification. Contact the site owner for account access.',
      403,
    );
  }
  // Provider access/refresh tokens are deliberately discarded; the app issues its own
  // opaque HttpOnly session, checked against the provider identity by SQL on each use.
  return user.id;
}
