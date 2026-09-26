import {
  accountDatabaseMissing,
  clearSessionCookie,
  findUserByEmail,
  getSessionContext,
  hasPasswordPepper,
  normalizeEmail,
  PasswordHashUpgradeRequiredError,
  sha256Hex,
  verifyPassword,
  type SessionContext,
} from './auth';
import {
  DatabaseRequestError,
  getDatabase,
  isMissingSchemaError,
  type AppDatabase,
  type SessionRow,
} from './database';
import {
  isRecord,
  isRequestBodyTooLargeError,
  jsonResponse,
  methodNotAllowed,
  nowIso,
  readLimitedJson,
  requestBodyTooLargeResponse,
} from './http';
import { HISTORY_LIMIT, rowToHistoryItem } from './historyApi';
import { deleteProviderIdentity, managedAuthEnabled, verifyEmailCode } from './managedAuth';
import { enforceAuthRateLimit, enforceIpRateLimit } from './rateLimit';
import type { ServerEnv } from './types';

const SESSION_LIST_LIMIT = 50;
const USAGE_EXPORT_DAYS = 400;
const DELETE_BODY_LIMIT_BYTES = 4096;
const EXPORT_FORMAT = 'code-visualizer-account-export';
const EXPORT_VERSION = 1;
const SESSION_ID_PATTERN = /^[0-9a-f]{32}$/;

type AccountAuth = { context: SessionContext; db: AppDatabase };

/** Sessions, data export and deletion for the signed-in account (`/api/account/*`). */
export async function handleAccountControlsApi(
  request: Request,
  env: ServerEnv,
): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (pathname === '/api/account/sessions') {
    return request.method === 'GET' ? listSessions(env, request) : methodNotAllowed(['GET']);
  }
  if (pathname === '/api/account/sessions/revoke-others') {
    return request.method === 'POST'
      ? revokeOtherSessions(env, request)
      : methodNotAllowed(['POST']);
  }
  const session = pathname.match(/^\/api\/account\/sessions\/([^/]+)$/);
  if (session) {
    return request.method === 'DELETE'
      ? revokeSession(env, request, session[1])
      : methodNotAllowed(['DELETE']);
  }
  if (pathname === '/api/account/export') {
    return request.method === 'GET' ? exportAccount(env, request) : methodNotAllowed(['GET']);
  }
  if (pathname === '/api/account/delete') {
    return request.method === 'POST' ? deleteAccount(env, request) : methodNotAllowed(['POST']);
  }
  return null;
}

async function listSessions(env: ServerEnv, request: Request): Promise<Response> {
  const auth = await requireAccount(env, request);
  if (auth instanceof Response) return auth;
  const rows = await auth.db.listSessions(auth.context.user.id, nowIso(), SESSION_LIST_LIMIT);
  const sessions = await Promise.all(
    rows.map(async (row) => ({
      id: await sessionPublicId(row.token_hash),
      ...sessionDetails(row, auth.context.tokenHash),
    })),
  );
  // Current session first; the rest stay newest first.
  sessions.sort((left, right) => Number(right.current) - Number(left.current));
  return jsonResponse({ sessions });
}

async function revokeSession(env: ServerEnv, request: Request, id: string): Promise<Response> {
  const auth = await requireAccount(env, request);
  if (auth instanceof Response) return auth;
  const { tokenHash, user } = auth.context;
  // Only the caller's own sessions are searched, so another user's ID is "not found".
  const rows = SESSION_ID_PATTERN.test(id)
    ? await auth.db.listSessions(user.id, nowIso(), SESSION_LIST_LIMIT)
    : [];
  let target: SessionRow | null = null;
  for (const row of rows) {
    if ((await sessionPublicId(row.token_hash)) === id) {
      target = row;
      break;
    }
  }
  if (!target) {
    return jsonResponse({ error: 'Session not found. It may have already ended.' }, 404);
  }
  if (target.token_hash === tokenHash) {
    return jsonResponse({ error: 'Use Sign out to end the session on this device.' }, 400);
  }
  await auth.db.deleteUserSession(target.token_hash, user.id);
  return jsonResponse({ ok: true });
}

async function revokeOtherSessions(env: ServerEnv, request: Request): Promise<Response> {
  const auth = await requireAccount(env, request);
  if (auth instanceof Response) return auth;
  const revoked = await auth.db.deleteOtherSessions(auth.context.user.id, auth.context.tokenHash);
  return jsonResponse({ revoked });
}

async function exportAccount(env: ServerEnv, request: Request): Promise<Response> {
  const auth = await requireAccount(env, request);
  if (auth instanceof Response) return auth;
  const { tokenHash, user } = auth.context;
  const limited = enforceIpRateLimit(request, {
    limit: 5,
    namespace: `account:export:${user.id}`,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const [sessions, history, usage] = await Promise.all([
    auth.db.listSessions(user.id, nowIso(), SESSION_LIST_LIMIT),
    auth.db.listHistory(user.id, HISTORY_LIMIT),
    auth.db.listUsage(`user:${user.id}`, USAGE_EXPORT_DAYS),
  ]);
  const exportedAt = nowIso();
  // Built field by field so hashes, tokens and provider IDs can never slip in.
  return jsonResponse(
    {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt,
      account: {
        authMethod: user.authMethod ?? 'legacy',
        createdAt: user.createdAt,
        email: user.email,
        id: user.id,
      },
      sessions: sessions.map((row) => sessionDetails(row, tokenHash)),
      history: history.map(rowToHistoryItem),
      usage: usage.map((row) => ({
        aiExplanations: Number(row.count),
        day: row.day,
        plan: row.plan,
      })),
      limits: {
        historyItems: HISTORY_LIMIT,
        sessions: SESSION_LIST_LIMIT,
        usageDays: USAGE_EXPORT_DAYS,
      },
    },
    200,
    {
      'Content-Disposition': `attachment; filename="code-visualizer-account-${exportedAt.slice(0, 10)}.json"`,
    },
  );
}

/**
 * Deletion needs the typed account email plus fresh proof of the sign-in
 * method: the current password for password accounts, or a new email code for
 * email-code accounts. The database re-checks the session and identity.
 */
async function deleteAccount(env: ServerEnv, request: Request): Promise<Response> {
  const auth = await requireAccount(env, request);
  if (auth instanceof Response) return auth;
  const { tokenHash, user } = auth.context;
  const limited = await enforceAuthRateLimit(env, request, 'account:delete');
  if (limited) return limited;
  if (managedAuthEnabled(env) || env.AUTH_RATE_LIMIT_MODE === 'database') {
    const targetLimit = await enforceAuthRateLimit(env, request, 'account:delete', user.email);
    if (targetLimit) return targetLimit;
  }

  let body: unknown;
  try {
    body = await readLimitedJson(request, DELETE_BODY_LIMIT_BYTES);
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) return requestBodyTooLargeResponse(error);
    throw error;
  }
  if (!isRecord(body) || normalizeEmail(body.confirmEmail) !== user.email) {
    return jsonResponse({ error: 'Type your account email exactly to confirm.' }, 400);
  }

  let providerSubject: string | null = null;
  if (user.authMethod === 'supabase') {
    if (typeof body.code !== 'string' || !/^\d{6,10}$/.test(body.code)) {
      return jsonResponse({ error: 'Enter the code from your email.' }, 400);
    }
    providerSubject = await verifyEmailCode(env, user.email, body.code);
  } else {
    const proof = await verifyCurrentPassword(env, auth.db, user.id, user.email, body.password);
    if (proof) return proof;
  }

  try {
    await auth.db.deleteAccount(user.id, tokenHash, providerSubject);
  } catch (error) {
    if (isMissingSchemaError(error)) {
      return jsonResponse(
        {
          error:
            'Account deletion is not available yet. The site owner needs to apply the latest database update.',
        },
        503,
      );
    }
    if (error instanceof DatabaseRequestError && error.message.includes('session_required')) {
      return jsonResponse({ error: 'Your session has ended. Sign in again to continue.' }, 401);
    }
    if (
      error instanceof DatabaseRequestError &&
      error.message.includes('reauthentication_required')
    ) {
      return jsonResponse({ error: 'That verification does not match this account.' }, 401);
    }
    throw error;
  }

  if (providerSubject && !(await deleteProviderIdentity(env, providerSubject))) {
    console.error('Account deleted; provider identity cleanup failed');
  }
  return jsonResponse({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie(request) });
}

async function verifyCurrentPassword(
  env: ServerEnv,
  db: AppDatabase,
  userId: string,
  email: string,
  password: unknown,
): Promise<Response | null> {
  if (typeof password !== 'string' || password.length === 0 || password.length > 200) {
    return jsonResponse({ error: 'Enter your current password.' }, 400);
  }
  if (!hasPasswordPepper(env)) {
    return jsonResponse({ error: 'Password hashing is not configured.' }, 503);
  }
  const stored = await findUserByEmail(db, email);
  let matches = false;
  try {
    matches = stored?.id === userId && (await verifyPassword(env, password, stored.passwordHash));
  } catch (error) {
    if (error instanceof PasswordHashUpgradeRequiredError) {
      return jsonResponse({ error: error.message }, 409);
    }
    throw error;
  }
  return matches ? null : jsonResponse({ error: 'That password is incorrect.' }, 401);
}

async function requireAccount(env: ServerEnv, request: Request): Promise<AccountAuth | Response> {
  const db = getDatabase(env);
  if (!db) {
    return accountDatabaseMissing();
  }
  const context = await getSessionContext(env, request);
  if (!context) {
    return jsonResponse({ error: 'Sign in to manage your account.' }, 401);
  }
  return { context, db };
}

/** A stable ID for one session that reveals neither its cookie nor its stored hash. */
async function sessionPublicId(tokenHash: string): Promise<string> {
  return (await sha256Hex(`cv-session-id:${tokenHash}`)).slice(0, 32);
}

function sessionDetails(row: SessionRow, currentTokenHash: string) {
  return {
    createdAt: row.created_at,
    current: row.token_hash === currentTokenHash,
    device: row.device_label ?? null,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at ?? null,
  };
}
