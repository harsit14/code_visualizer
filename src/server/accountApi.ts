import {
  accountDatabaseMissing,
  clearSessionCookie,
  createUserSession,
  destroyUserSession,
  findUserByEmail,
  getSessionContext,
  hashPassword,
  isUniqueConstraintError,
  PasswordHashUpgradeRequiredError,
  readAuthPayload,
  serializeAccount,
  verifyPassword,
} from './auth';
import { jsonResponse, methodNotAllowed, nowIso, readJson } from './http';
import { handleHistoryApi } from './historyApi';
import { limitForPlan, planForUser, usageDay } from './usage';
import type { AuthUser, ServerEnv } from './types';

type UsageRow = {
  count: number;
};

export async function handleAccountApi(request: Request, env: ServerEnv): Promise<Response | null> {
  const url = new URL(request.url);

  try {
    const historyResponse = await handleHistoryApi(request, env);
    if (historyResponse) {
      return historyResponse;
    }

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
      billingConfigured: false,
      subscription: null,
      usage: null,
      user: null,
    });
  }

  const context = await getSessionContext(env, request);
  const account = serializeAccount(context);
  return jsonResponse({
    accountConfigured: true,
    billingConfigured: false,
    ...account,
    subscription: null,
    usage: await currentUsage(env, context?.user ?? null),
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

  const userId = createUserId();
  const createdAt = nowIso();
  const passwordHash = await hashPassword(env, payload.password);

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
  const context = await getSessionContext(env, withCookie(request, cookie));
  return jsonResponse(
    {
      accountConfigured: true,
      billingConfigured: false,
      ...serializeAccount(context),
      subscription: null,
      usage: await currentUsage(env, context?.user ?? null),
    },
    201,
    { 'Set-Cookie': cookie },
  );
}

function createUserId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20,
  )}-${hex.slice(20)}`;
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
  if (!user) {
    return jsonResponse({ error: 'Invalid email or password.' }, 401);
  }

  let passwordMatches = false;
  try {
    passwordMatches = await verifyPassword(env, payload.password, user.passwordHash);
  } catch (error) {
    if (error instanceof PasswordHashUpgradeRequiredError) {
      return jsonResponse({ error: error.message }, 409);
    }
    throw error;
  }

  if (!passwordMatches) {
    return jsonResponse({ error: 'Invalid email or password.' }, 401);
  }

  const cookie = await createUserSession(env.DB, request, user.id);
  const context = await getSessionContext(env, withCookie(request, cookie));
  return jsonResponse(
    {
      accountConfigured: true,
      billingConfigured: false,
      ...serializeAccount(context),
      subscription: null,
      usage: await currentUsage(env, context?.user ?? null),
    },
    200,
    {
      'Set-Cookie': cookie,
    },
  );
}

async function signOut(env: ServerEnv, request: Request): Promise<Response> {
  await destroyUserSession(env, request);
  return jsonResponse({ ok: true }, 200, {
    'Set-Cookie': clearSessionCookie(request),
  });
}

async function currentUsage(
  env: ServerEnv,
  user: AuthUser | null,
) {
  if (!env.DB) {
    return null;
  }
  const plan = planForUser(env, user);
  const day = usageDay();
  const subject = user ? `user:${user.id}` : null;
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
