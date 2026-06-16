import { isRecord, nowIso } from './http';
import type { AuthUser, D1Database, ServerEnv, UserSubscription } from './types';

export const SESSION_COOKIE = 'cv_session';

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
// Keep the signup path inside Cloudflare Worker CPU limits. Stored hashes
// include their iteration count, so this can be raised later without breaking
// existing passwords.
const PASSWORD_ITERATIONS = 60_000;
const PASSWORD_SALT_BYTES = 16;
const SESSION_BYTES = 32;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const textEncoder = new TextEncoder();

type UserRow = {
  created_at: string;
  email: string;
  id: string;
  stripe_customer_id: string | null;
};

type SubscriptionRow = {
  current_period_end: string | null;
  price_id: string | null;
  status: string;
  stripe_subscription_id: string | null;
  updated_at: string;
  user_id: string;
};

export type SessionContext = {
  subscription: UserSubscription | null;
  user: AuthUser;
};

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const email = value.trim().toLowerCase();
  return EMAIL_PATTERN.test(email) && email.length <= 254 ? email : null;
}

export function validatePassword(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  if (value.length < 10 || value.length > 200) {
    return null;
  }
  return value;
}

export async function createUserSession(
  db: D1Database,
  request: Request,
  userId: string,
): Promise<string> {
  const token = randomToken(SESSION_BYTES);
  const tokenHash = await sha256Hex(token);
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();

  await db
    .prepare(
      `INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(tokenHash, userId, createdAt, expiresAt)
    .run();

  return sessionCookie(token, request, SESSION_TTL_SECONDS);
}

export async function destroyUserSession(env: ServerEnv, request: Request): Promise<void> {
  const token = readSessionCookie(request);
  if (!token || !env.DB) {
    return;
  }
  const tokenHash = await sha256Hex(token);
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
}

export async function getSessionContext(
  env: ServerEnv,
  request: Request,
): Promise<SessionContext | null> {
  const db = env.DB;
  const token = readSessionCookie(request);
  if (!db || !token) {
    return null;
  }

  const tokenHash = await sha256Hex(token);
  const row = await db
    .prepare(
      `SELECT
         users.id,
         users.email,
         users.created_at,
         users.stripe_customer_id
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
    )
    .bind(tokenHash, nowIso())
    .first<UserRow>();

  if (!row) {
    return null;
  }

  const user = rowToUser(row);
  const subscription = await getSubscriptionForUser(db, user.id);
  return { subscription, user };
}

export async function findUserByEmail(
  db: D1Database,
  email: string,
): Promise<(AuthUser & { passwordHash: string }) | null> {
  const row = await db
    .prepare(
      `SELECT id, email, password_hash, created_at, stripe_customer_id
       FROM users
       WHERE email = ?`,
    )
    .bind(email)
    .first<UserRow & { password_hash: string }>();

  return row
    ? {
        ...rowToUser(row),
        passwordHash: row.password_hash,
      }
    : null;
}

export async function findUserByStripeCustomerId(
  db: D1Database,
  customerId: string,
): Promise<AuthUser | null> {
  const row = await db
    .prepare(
      `SELECT id, email, created_at, stripe_customer_id
       FROM users
       WHERE stripe_customer_id = ?`,
    )
    .bind(customerId)
    .first<UserRow>();
  return row ? rowToUser(row) : null;
}

export async function getSubscriptionForUser(
  db: D1Database,
  userId: string,
): Promise<UserSubscription | null> {
  const row = await db
    .prepare(
      `SELECT user_id, stripe_subscription_id, status, price_id, current_period_end, updated_at
       FROM subscriptions
       WHERE user_id = ?`,
    )
    .bind(userId)
    .first<SubscriptionRow>();

  return row ? rowToSubscription(row) : null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(PASSWORD_SALT_BYTES));
  const key = await crypto.subtle.importKey('raw', textEncoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      hash: 'SHA-256',
      iterations: PASSWORD_ITERATIONS,
      name: 'PBKDF2',
      salt: toArrayBuffer(salt),
    },
    key,
    256,
  );

  return [
    'pbkdf2_sha256',
    String(PASSWORD_ITERATIONS),
    bytesToBase64(salt),
    bytesToBase64(new Uint8Array(bits)),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, iterationsRaw, saltRaw, hashRaw] = stored.split('$');
  if (algorithm !== 'pbkdf2_sha256' || !iterationsRaw || !saltRaw || !hashRaw) {
    return false;
  }

  const iterations = Number(iterationsRaw);
  if (!Number.isSafeInteger(iterations) || iterations < 100_000) {
    return false;
  }

  const salt = base64ToBytes(saltRaw);
  const expected = base64ToBytes(hashRaw);
  const key = await crypto.subtle.importKey('raw', textEncoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      hash: 'SHA-256',
      iterations,
      name: 'PBKDF2',
      salt: toArrayBuffer(salt),
    },
    key,
    expected.length * 8,
  );

  return timingSafeEqual(new Uint8Array(bits), expected);
}

export function isSubscribed(subscription: UserSubscription | null): boolean {
  return subscription?.status === 'active' || subscription?.status === 'trialing';
}

export function serializeAccount(context: SessionContext | null) {
  return {
    subscription: context?.subscription
      ? {
          currentPeriodEnd: context.subscription.currentPeriodEnd,
          priceId: context.subscription.priceId,
          status: context.subscription.status,
        }
      : null,
    user: context?.user
      ? {
          createdAt: context.user.createdAt,
          email: context.user.email,
          id: context.user.id,
        }
      : null,
  };
}

export function accountDatabaseMissing(): Response {
  return new Response(
    JSON.stringify({
      error: 'Account database is not configured. Add the Cloudflare D1 DB binding first.',
    }),
    {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
      },
      status: 503,
    },
  );
}

export function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes('UNIQUE') || error.message.includes('constraint failed'))
  );
}

export function readAuthPayload(value: unknown): { email: string; password: string } | null {
  if (!isRecord(value)) {
    return null;
  }
  const email = normalizeEmail(value.email);
  const password = validatePassword(value.password);
  return email && password ? { email, password } : null;
}

export function sessionCookie(token: string, request: Request, maxAge: number): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function clearSessionCookie(request: Request): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function readSessionCookie(request: Request): string | null {
  const cookie = request.headers.get('Cookie');
  if (!cookie) {
    return null;
  }
  const match = cookie
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${SESSION_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(SESSION_COOKIE.length + 1)) : null;
}

function rowToUser(row: UserRow): AuthUser {
  return {
    createdAt: row.created_at,
    email: row.email,
    id: row.id,
    stripeCustomerId: row.stripe_customer_id,
  };
}

function rowToSubscription(row: SubscriptionRow): UserSubscription {
  return {
    currentPeriodEnd: row.current_period_end,
    priceId: row.price_id,
    status: row.status,
    stripeSubscriptionId: row.stripe_subscription_id,
    updatedAt: row.updated_at,
    userId: row.user_id,
  };
}

function randomToken(bytes: number): string {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return bytesToBase64Url(value);
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }
  return diff === 0;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}
