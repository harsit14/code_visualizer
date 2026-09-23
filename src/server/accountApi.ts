import {
  accountDatabaseMissing,
  normalizeEmail,
  randomToken,
  readSessionCookie,
  SESSION_TTL_SECONDS,
  sessionCookie,
  sha256Hex,
  clearSessionCookie,
  createUserSession,
  destroyUserSession,
  findUserByEmail,
  getSessionContext,
  hashPassword,
  hasPasswordPepper,
  isUniqueConstraintError,
  PasswordHashUpgradeRequiredError,
  readAuthPayload,
  serializeAccount,
  verifyPassword,
} from './auth';
import { DatabaseRequestError, getDatabase } from './database';
import {
  isRequestBodyTooLargeError,
  jsonResponse,
  isRecord,
  methodNotAllowed,
  nowIso,
  readLimitedJson,
  rejectUntrustedBrowserRequest,
  requestBodyTooLargeResponse,
} from './http';
import { handleHistoryApi } from './historyApi';
import { enforceAuthRateLimit } from './rateLimit';
import {
  managedAuthEnabled,
  ManagedAuthError,
  sendEmailCode,
  verifyEmailCode,
} from './managedAuth';
import { limitForPlan, planForUser, usageDay } from './usage';
import type { AuthUser, ServerEnv } from './types';

const AUTH_BODY_LIMIT_BYTES = 4096;

export async function handleAccountApi(request: Request, env: ServerEnv): Promise<Response | null> {
  const url = new URL(request.url);

  try {
    const crossOriginResponse = rejectUntrustedBrowserRequest(request);
    if (crossOriginResponse) {
      return crossOriginResponse;
    }

    const historyResponse = await handleHistoryApi(request, env);
    if (historyResponse) {
      return historyResponse;
    }

    if (url.pathname === '/api/capabilities') {
      return request.method === 'GET' ? capabilities(env) : methodNotAllowed(['GET']);
    }

    if (url.pathname === '/api/me') {
      return request.method === 'GET'
        ? await accountStatus(env, request)
        : methodNotAllowed(['GET']);
    }

    if (url.pathname === '/api/auth/email-code' || url.pathname === '/api/auth/verify-code') {
      return request.method === 'POST'
        ? await emailCodeAuth(env, request, url.pathname.endsWith('/verify-code'))
        : methodNotAllowed(['POST']);
    }

    if (url.pathname === '/api/auth/signup') {
      return request.method === 'POST' ? await signUp(env, request) : methodNotAllowed(['POST']);
    }

    if (url.pathname === '/api/auth/login') {
      return request.method === 'POST' ? await signIn(env, request) : methodNotAllowed(['POST']);
    }

    if (url.pathname === '/api/auth/logout') {
      return request.method === 'POST' ? await signOut(env, request) : methodNotAllowed(['POST']);
    }
  } catch (error) {
    if (error instanceof ManagedAuthError)
      return jsonResponse({ error: error.message }, error.status);
    return jsonResponse(
      { error: 'Account service is temporarily unavailable. Please try again.' },
      503,
    );
  }

  return null;
}

/** Which server features this deployment offers, so the UI can hide the rest. */
function capabilities(env: ServerEnv): Response {
  const database = Boolean(getDatabase(env));
  return jsonResponse({
    accounts: database,
    history: database,
    ai: Boolean(env.DEEPSEEK_API_KEY?.trim()),
    authMode: managedAuthEnabled(env) ? 'email-code' : 'password',
  });
}

async function accountStatus(env: ServerEnv, request: Request): Promise<Response> {
  if (!getDatabase(env)) {
    return jsonResponse({
      authMode: managedAuthEnabled(env) ? 'email-code' : 'password',
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
    authMode: managedAuthEnabled(env) ? 'email-code' : 'password',
    accountConfigured: true,
    billingConfigured: false,
    ...account,
    subscription: null,
    usage: await currentUsage(env, context?.user ?? null),
  });
}

async function signUp(env: ServerEnv, request: Request): Promise<Response> {
  if (managedAuthEnabled(env))
    return jsonResponse({ error: 'Use a verified email code to create your account.' }, 409);
  const limited = await enforceAuthRateLimit(env, request, 'auth:signup');
  if (limited) {
    return limited;
  }
  const db = getDatabase(env);
  if (!db) {
    return accountDatabaseMissing();
  }
  if (!hasPasswordPepper(env)) {
    return jsonResponse({ error: 'Password hashing is not configured.' }, 503);
  }

  const body = await readAuthJson(request);
  if (body instanceof Response) {
    return body;
  }
  const payload = readAuthPayload(body);
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
    await db.createUser({
      created_at: createdAt,
      email: payload.email,
      id: userId,
      password_hash: passwordHash,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return jsonResponse({ error: 'An account already exists for that email.' }, 409);
    }
    throw error;
  }

  const cookie = await createUserSession(db, request, userId);
  return jsonResponse(
    {
      authMode: managedAuthEnabled(env) ? 'email-code' : 'password',
      accountConfigured: true,
      billingConfigured: false,
      subscription: null,
      user: {
        createdAt,
        email: payload.email,
        id: userId,
      },
      usage: await currentUsage(env, {
        createdAt,
        email: payload.email,
        id: userId,
        stripeCustomerId: null,
      }),
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
  const limited = await enforceAuthRateLimit(env, request, 'auth:login');
  if (limited) {
    return limited;
  }
  const db = getDatabase(env);
  if (!db) {
    return accountDatabaseMissing();
  }
  if (!hasPasswordPepper(env)) {
    return jsonResponse({ error: 'Password hashing is not configured.' }, 503);
  }

  const body = await readAuthJson(request);
  if (body instanceof Response) {
    return body;
  }
  const payload = readAuthPayload(body);
  if (!payload) {
    return jsonResponse({ error: 'Enter your email and password.' }, 400);
  }

  if (managedAuthEnabled(env) || env.AUTH_RATE_LIMIT_MODE === 'database') {
    const targetLimit = await enforceAuthRateLimit(env, request, 'auth:login', payload.email);
    if (targetLimit) return targetLimit;
  }
  const user = await findUserByEmail(db, payload.email);
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

  const cookie = await createUserSession(db, request, user.id);
  return jsonResponse(
    {
      authMode: managedAuthEnabled(env) ? 'email-code' : 'password',
      accountConfigured: true,
      billingConfigured: false,
      subscription: null,
      user: {
        createdAt: user.createdAt,
        email: user.email,
        id: user.id,
      },
      usage: await currentUsage(env, user),
    },
    200,
    {
      'Set-Cookie': cookie,
    },
  );
}

async function readAuthJson(request: Request): Promise<unknown | Response> {
  try {
    return await readLimitedJson(request, AUTH_BODY_LIMIT_BYTES);
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      return requestBodyTooLargeResponse(error);
    }
    throw error;
  }
}

async function signOut(env: ServerEnv, request: Request): Promise<Response> {
  await destroyUserSession(env, request);
  return jsonResponse({ ok: true }, 200, {
    'Set-Cookie': clearSessionCookie(request),
  });
}

async function currentUsage(env: ServerEnv, user: AuthUser | null) {
  const db = getDatabase(env);
  if (!db) {
    return null;
  }
  const plan = planForUser(env, user);
  const day = usageDay();
  const subject = user ? `user:${user.id}` : null;
  const row = subject === null ? null : await db.getUsageCount(subject, day);
  const used = Number(row ?? 0);
  const limit = limitForPlan(env, plan);
  return {
    day,
    limit,
    plan,
    remaining: Math.max(0, limit - used),
    used,
  };
}

async function emailCodeAuth(env: ServerEnv, request: Request, verify: boolean): Promise<Response> {
  if (!managedAuthEnabled(env))
    return jsonResponse({ error: 'Email-code sign-in is not enabled.' }, 404);
  const namespace = verify ? 'auth:verify' : 'auth:send';
  const limited = await enforceAuthRateLimit(env, request, namespace);
  if (limited) return limited;
  const body = await readAuthJson(request);
  if (body instanceof Response) return body;
  const email = isRecord(body) ? normalizeEmail(body.email) : null;
  if (!isRecord(body) || !email || (body.link !== undefined && typeof body.link !== 'boolean'))
    return jsonResponse({ error: 'Enter a valid email address.' }, 400);
  const targetLimit = await enforceAuthRateLimit(env, request, namespace, email);
  if (targetLimit) return targetLimit;
  const db = getDatabase(env)!;
  let legacyTokenHash: string | null = null;
  if (body.link === true) {
    const context = await getSessionContext(env, request);
    const token = readSessionCookie(request);
    if (
      !token ||
      !context ||
      context.user.email !== email ||
      context.user.authMethod === 'supabase'
    )
      return jsonResponse(
        { error: 'Sign in with your existing password before linking this account.' },
        401,
      );
    legacyTokenHash = await sha256Hex(token);
  }
  if (!verify) {
    await sendEmailCode(env, email);
    return jsonResponse({
      message:
        'If email delivery is available, a sign-in code is on its way. Check your inbox and spam folder.',
    });
  }
  if (typeof body.code !== 'string' || !/^\d{6,10}$/.test(body.code))
    return jsonResponse({ error: 'Enter the code from your email.' }, 400);
  const subject = await verifyEmailCode(env, email, body.code);
  const token = randomToken(32);
  try {
    const user = await db.completeManagedAuth(
      subject,
      email,
      legacyTokenHash,
      await sha256Hex(token),
    );
    return jsonResponse(
      {
        authMode: 'email-code',
        accountConfigured: true,
        billingConfigured: false,
        subscription: null,
        usage: null,
        user: {
          id: user.id,
          email: user.email,
          createdAt: user.created_at,
          authMethod: 'supabase',
        },
      },
      200,
      { 'Set-Cookie': sessionCookie(token, request, SESSION_TTL_SECONDS) },
    );
  } catch (error) {
    if (error instanceof DatabaseRequestError) {
      if (error.message.includes('legacy_link_required'))
        return jsonResponse(
          {
            error:
              'An existing account needs linking. Sign in with its password, then choose Enable email sign-in. Email ownership alone cannot recover its history.',
            code: 'legacy_link_required',
          },
          409,
        );
      if (error.message.includes('fresh_legacy_login_required'))
        return jsonResponse(
          {
            error:
              'For linking, sign out and sign in with your existing password again, then request a fresh code within 10 minutes.',
          },
          409,
        );
      if (error.message.includes('identity_conflict') || error.code === '23505')
        return jsonResponse(
          {
            error:
              'These accounts cannot be linked automatically. Contact the site owner for recovery.',
          },
          409,
        );
      if (error.message.includes('invalid_identity'))
        return jsonResponse({ error: 'Email ownership could not be verified.' }, 401);
    }
    throw error;
  }
}
