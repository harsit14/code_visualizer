import {
  accountDatabaseMissing,
  clearSessionCookie,
  createUserSession,
  destroyUserSession,
  findUserByEmail,
  getSessionContext,
  hashPassword,
  isUniqueConstraintError,
  readAuthPayload,
  serializeAccount,
  verifyPassword,
} from './auth';
import { createCheckoutSession, createPortalSession, handleStripeWebhook } from './billing';
import { jsonResponse, methodNotAllowed, nowIso, readJson } from './http';
import { limitForPlan, usageDay } from './usage';
import type { AccountPlan, ServerEnv } from './types';

type UsageRow = {
  count: number;
};

export async function handleAccountApi(request: Request, env: ServerEnv): Promise<Response | null> {
  const url = new URL(request.url);

  try {
    if (url.pathname === '/api/me') {
      return request.method === 'GET' ? accountStatus(env, request) : methodNotAllowed(['GET']);
    }

    if (url.pathname === '/api/auth/signup') {
      return request.method === 'POST' ? signUp(env, request) : methodNotAllowed(['POST']);
    }

    if (url.pathname === '/api/auth/login') {
      return request.method === 'POST' ? signIn(env, request) : methodNotAllowed(['POST']);
    }

    if (url.pathname === '/api/auth/logout') {
      return request.method === 'POST' ? signOut(env, request) : methodNotAllowed(['POST']);
    }

    if (url.pathname === '/api/billing/checkout') {
      return request.method === 'POST'
        ? createCheckoutSession(env, request)
        : methodNotAllowed(['POST']);
    }

    if (url.pathname === '/api/billing/portal') {
      return request.method === 'POST'
        ? createPortalSession(env, request)
        : methodNotAllowed(['POST']);
    }

    if (url.pathname === '/api/stripe/webhook') {
      return request.method === 'POST'
        ? handleStripeWebhook(env, request)
        : methodNotAllowed(['POST']);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected account API error.';
    return jsonResponse({ error: message }, 500);
  }

  return null;
}

async function accountStatus(env: ServerEnv, request: Request): Promise<Response> {
  if (!env.DB) {
    return jsonResponse({
      accountConfigured: false,
      billingConfigured: Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_ID),
      subscription: null,
      usage: null,
      user: null,
    });
  }

  const context = await getSessionContext(env, request);
  return jsonResponse({
    accountConfigured: true,
    billingConfigured: Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_ID),
    ...serializeAccount(context),
    usage: await currentUsage(
      env,
      request,
      context?.user.id ?? null,
      context ? 'free' : 'anonymous',
    ),
  });
}

async function signUp(env: ServerEnv, request: Request): Promise<Response> {
  if (!env.DB) {
    return accountDatabaseMissing();
  }

  const payload = readAuthPayload(await readJson(request));
  if (!payload) {
    return jsonResponse(
      {
        error: 'Enter a valid email and a password with at least 10 characters.',
      },
      400,
    );
  }

  const userId = crypto.randomUUID();
  const createdAt = nowIso();
  const passwordHash = await hashPassword(payload.password);

  try {
    await env.DB.prepare(
      `INSERT INTO users (id, email, password_hash, created_at)
       VALUES (?, ?, ?, ?)`,
    )
      .bind(userId, payload.email, passwordHash, createdAt)
      .run();
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return jsonResponse({ error: 'An account already exists for that email.' }, 409);
    }
    throw error;
  }

  const cookie = await createUserSession(env.DB, request, userId);
  return jsonResponse(
    {
      subscription: null,
      user: {
        createdAt,
        email: payload.email,
        id: userId,
      },
    },
    201,
    { 'Set-Cookie': cookie },
  );
}

async function signIn(env: ServerEnv, request: Request): Promise<Response> {
  if (!env.DB) {
    return accountDatabaseMissing();
  }

  const payload = readAuthPayload(await readJson(request));
  if (!payload) {
    return jsonResponse({ error: 'Enter your email and password.' }, 400);
  }

  const user = await findUserByEmail(env.DB, payload.email);
  if (!user || !(await verifyPassword(payload.password, user.passwordHash))) {
    return jsonResponse({ error: 'Invalid email or password.' }, 401);
  }

  const cookie = await createUserSession(env.DB, request, user.id);
  const context = await getSessionContext(env, withCookie(request, cookie));
  return jsonResponse(serializeAccount(context), 200, { 'Set-Cookie': cookie });
}

async function signOut(env: ServerEnv, request: Request): Promise<Response> {
  await destroyUserSession(env, request);
  return jsonResponse({ ok: true }, 200, {
    'Set-Cookie': clearSessionCookie(request),
  });
}

async function currentUsage(
  env: ServerEnv,
  request: Request,
  userId: string | null,
  fallbackPlan: AccountPlan,
) {
  if (!env.DB) {
    return null;
  }
  const context = await getSessionContext(env, request);
  const plan: AccountPlan =
    context?.subscription?.status === 'active' || context?.subscription?.status === 'trialing'
      ? 'pro'
      : userId
        ? 'free'
        : fallbackPlan;
  const day = usageDay();
  const subject = userId ? `user:${userId}` : null;
  const row =
    subject === null
      ? null
      : await env.DB.prepare('SELECT count FROM usage_daily WHERE subject = ? AND day = ?')
          .bind(subject, day)
          .first<UsageRow>();
  const used = Number(row?.count ?? 0);
  const limit = limitForPlan(env, plan);
  return {
    day,
    limit,
    plan,
    remaining: Math.max(0, limit - used),
    used,
  };
}

function withCookie(request: Request, cookie: string): Request {
  const headers = new Headers(request.headers);
  const [pair] = cookie.split(';');
  headers.set('Cookie', pair);
  return new Request(request, { headers });
}
