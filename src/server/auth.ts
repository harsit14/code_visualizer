import { isRecord, jsonResponse, nowIso } from './http';
import {
  getDatabase,
  isDatabaseUniqueConstraintError,
  type AppDatabase,
  type SubscriptionRow,
  type UserRow,
} from './database';
import type { AuthUser, ServerEnv, UserSubscription } from './types';

export const SESSION_COOKIE = 'cv_session';

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const PASSWORD_HASH_ALGORITHM = 'hmac_sha256_v1';
const LEGACY_PBKDF2_ALGORITHM = 'pbkdf2_sha256';
const DEFAULT_LEGACY_PBKDF2_VERIFY_LIMIT = 20_000;
const MIN_LEGACY_PBKDF2_ITERATIONS = 1_000;
const PASSWORD_SALT_BYTES = 16;
const SESSION_BYTES = 32;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const textEncoder = new TextEncoder();

export class PasswordHashUpgradeRequiredError extends Error {
  constructor() {
    super(
      'This account uses an older password hash that is too expensive for this Worker. Recreate the account or update the stored password hash after the latest deployment.',
    );
    this.name = 'PasswordHashUpgradeRequiredError';
  }
}

export class PasswordPepperMissingError extends Error {
  constructor() {
    super('PASSWORD_PEPPER is not configured.');
    this.name = 'PasswordPepperMissingError';
  }
}

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

export function hasPasswordPepper(env: ServerEnv): boolean {
  return Boolean(env.PASSWORD_PEPPER?.trim());
}

export async function createUserSession(
  db: AppDatabase,
  request: Request,
  userId: string,
): Promise<string> {
  const token = randomToken(SESSION_BYTES);
  const tokenHash = await sha256Hex(token);
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();

  await db.createSession({
    created_at: createdAt,
    expires_at: expiresAt,
    token_hash: tokenHash,
    user_id: userId,
  });

  return sessionCookie(token, request, SESSION_TTL_SECONDS);
}

export async function destroyUserSession(env: ServerEnv, request: Request): Promise<void> {
  const token = readSessionCookie(request);
  const db = getDatabase(env);
  if (!token || !db) {
    return;
  }
  const tokenHash = await sha256Hex(token);
  await db.deleteSession(tokenHash);
}

export async function getSessionContext(
  env: ServerEnv,
  request: Request,
): Promise<SessionContext | null> {
  const db = getDatabase(env);
  const token = readSessionCookie(request);
  if (!db || !token) {
    return null;
  }

  const tokenHash = await sha256Hex(token);
  const row = await db.findSessionUser(tokenHash, nowIso());

  if (!row) {
    return null;
  }

  const user = rowToUser(row);
  const subscription = await getSubscriptionForUser(db, user.id);
  return { subscription, user };
}

export async function findUserByEmail(
  db: AppDatabase,
  email: string,
): Promise<(AuthUser & { passwordHash: string }) | null> {
  const row = await db.findUserByEmail(email);

  return row
    ? {
        ...rowToUser(row),
        passwordHash: row.password_hash,
      }
    : null;
}

export async function findUserByStripeCustomerId(
  db: AppDatabase,
  customerId: string,
): Promise<AuthUser | null> {
  const row = await db.findUserByStripeCustomerId(customerId);
  return row ? rowToUser(row) : null;
}

export async function getSubscriptionForUser(
  db: AppDatabase,
  userId: string,
): Promise<UserSubscription | null> {
  const row = await db.getSubscriptionForUser(userId);

  return row ? rowToSubscription(row) : null;
}

export async function hashPassword(env: ServerEnv, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(PASSWORD_SALT_BYTES));
  const signature = await passwordSignature(env, password, salt);

  return [PASSWORD_HASH_ALGORITHM, bytesToBase64(salt), bytesToBase64(signature)].join('$');
}

export async function verifyPassword(
  env: ServerEnv,
  password: string,
  stored: string,
): Promise<boolean> {
  const [algorithm, firstRaw, secondRaw, thirdRaw] = stored.split('$');

  if (algorithm === PASSWORD_HASH_ALGORITHM) {
    if (!firstRaw || !secondRaw || thirdRaw) {
      return false;
    }
    const salt = base64ToBytes(firstRaw);
    const expected = base64ToBytes(secondRaw);
    const actual = await passwordSignature(env, password, salt);
    return timingSafeEqual(actual, expected);
  }

  if (algorithm !== LEGACY_PBKDF2_ALGORITHM || !firstRaw || !secondRaw || !thirdRaw) {
    return false;
  }

  const iterations = Number(firstRaw);
  if (!Number.isSafeInteger(iterations) || iterations < MIN_LEGACY_PBKDF2_ITERATIONS) {
    return false;
  }
  if (iterations > legacyPbkdf2VerifyLimit(env)) {
    throw new PasswordHashUpgradeRequiredError();
  }

  const salt = base64ToBytes(secondRaw);
  const expected = base64ToBytes(thirdRaw);
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
  return jsonResponse(
    {
      error:
        'Account database is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to the Worker first.',
    },
    503,
  );
}

export function isUniqueConstraintError(error: unknown): boolean {
  return (
    isDatabaseUniqueConstraintError(error) ||
    (error instanceof Error &&
      (error.message.includes('UNIQUE') || error.message.includes('constraint failed')))
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

async function passwordSignature(
  env: ServerEnv,
  password: string,
  salt: Uint8Array,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(passwordPepper(env)),
    {
      hash: 'SHA-256',
      name: 'HMAC',
    },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    textEncoder.encode(`${bytesToBase64(salt)}:${password}`),
  );
  return new Uint8Array(signature);
}

function passwordPepper(env: ServerEnv): string {
  const pepper = env.PASSWORD_PEPPER?.trim();
  if (!pepper) {
    throw new PasswordPepperMissingError();
  }
  return pepper;
}

function legacyPbkdf2VerifyLimit(env: ServerEnv): number {
  const parsed = Number(env.PBKDF2_VERIFY_ITERATIONS_LIMIT);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_LEGACY_PBKDF2_VERIFY_LIMIT;
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
