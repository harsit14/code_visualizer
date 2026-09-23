import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAccountApi } from './accountApi';
import { DatabaseRequestError, getDatabase } from './database';
import { sha256Hex } from './auth';

vi.mock('./database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./database')>()),
  getDatabase: vi.fn(),
}));
const env = {
  MANAGED_AUTH_ENABLED: 'true',
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'private-service-key',
  SUPABASE_ANON_KEY: 'public-anon-key',
};
const subject = '10000000-0000-4000-8000-000000000001';
const appUser = {
  id: '20000000-0000-4000-8000-000000000001',
  email: 'person@example.com',
  created_at: '2026-09-23T00:00:00Z',
  stripe_customer_id: null,
};
const db = {
  consumeAuthLimit: vi.fn(),
  completeManagedAuth: vi.fn(),
  findSessionUser: vi.fn(),
  getSubscriptionForUser: vi.fn(),
};
const provider = vi.fn();
function request(path: string, body: object, headers: Record<string, string> = {}) {
  return new Request(`https://app.example/api/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.5', ...headers },
    body: JSON.stringify(body),
  });
}
function providerResult(user: object = {}) {
  return Response.json({
    access_token: 'provider-secret-access',
    refresh_token: 'provider-secret-refresh',
    user: {
      id: subject,
      email: appUser.email,
      email_confirmed_at: '2026-09-23T00:00:00Z',
      ...user,
    },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDatabase).mockReturnValue(
    db as unknown as NonNullable<ReturnType<typeof getDatabase>>,
  );
  db.consumeAuthLimit.mockResolvedValue({ allowed: true, retry_after: 60 });
  db.completeManagedAuth.mockResolvedValue(appUser);
  db.findSessionUser.mockResolvedValue(null);
  db.getSubscriptionForUser.mockResolvedValue(null);
  provider.mockImplementation(async () => providerResult());
  vi.stubGlobal('fetch', provider);
});
afterEach(() => vi.unstubAllGlobals());
describe('managed email auth API', () => {
  it('sends codes with no provider/session tokens in the response and private limiter keys', async () => {
    const response = await handleAccountApi(
      request('email-code', { email: ' Person@Example.com ' }),
      env,
    );
    expect(response?.status).toBe(200);
    expect(await response?.text()).not.toContain('provider-secret');
    const [url, init] = provider.mock.calls[0];
    expect(String(url)).toBe('https://project.supabase.co/auth/v1/otp');
    expect(JSON.parse(init.body)).toEqual({ email: appUser.email, create_user: true });
    expect(init.headers.apikey).toBe('public-anon-key');
    expect(init.redirect).toBe('error');
    expect(db.consumeAuthLimit.mock.calls).toHaveLength(2);
    expect(db.consumeAuthLimit.mock.calls[0][0]).toMatch(/^[a-f0-9]{64}$/);
    expect(db.consumeAuthLimit.mock.calls[0][0]).not.toBe(db.consumeAuthLimit.mock.calls[1][0]);
    expect(db.completeManagedAuth).not.toHaveBeenCalled();
  });
  it('issues only an opaque HttpOnly cookie after verified identity and atomic mapping', async () => {
    const response = await handleAccountApi(
      request('verify-code', {
        email: appUser.email,
        code: '123456',
        appUserId: 'attacker-chosen',
      }),
      env,
    );
    expect(response?.status).toBe(200);
    const text = await response!.text();
    expect(text).toContain(appUser.id);
    expect(text).not.toContain('provider-secret');
    expect(response?.headers.get('Set-Cookie')).toMatch(
      /cv_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure/,
    );
    expect(db.completeManagedAuth).toHaveBeenCalledWith(
      subject,
      appUser.email,
      null,
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
  });
  it.each([
    { email: 'other@example.com' },
    { email_confirmed_at: null },
    { id: 'invalid' },
    { factors: [{ status: 'verified' }] },
  ])('rejects invalid or insufficient provider proof %j', async (user) => {
    provider.mockImplementation(async () => providerResult(user));
    const response = await handleAccountApi(
      request('verify-code', { email: appUser.email, code: '123456' }),
      env,
    );
    expect([401, 403]).toContain(response?.status);
    expect(db.completeManagedAuth).not.toHaveBeenCalled();
    expect(response?.headers.has('Set-Cookie')).toBe(false);
  });
  it('requires existing account proof to link and uses only the actual cookie hash', async () => {
    const noProof = await handleAccountApi(
      request('verify-code', { email: appUser.email, code: '123456', link: true }),
      env,
    );
    expect(noProof?.status).toBe(401);
    expect(provider).not.toHaveBeenCalled();
    db.findSessionUser.mockResolvedValue(appUser);
    const token = 'a'.repeat(43);
    const response = await handleAccountApi(
      request(
        'verify-code',
        { email: appUser.email, code: '123456', link: true, legacyTokenHash: 'forged' },
        { Cookie: `cv_session=${token}` },
      ),
      env,
    );
    expect(response?.status).toBe(200);
    expect(db.completeManagedAuth).toHaveBeenCalledWith(
      subject,
      appUser.email,
      await sha256Hex(token),
      expect.any(String),
    );
  });
  it('preserves a legacy account on identity conflict without exposing database internals', async () => {
    db.completeManagedAuth.mockRejectedValueOnce(
      new DatabaseRequestError('legacy_link_required', 400),
    );
    const conflict = await handleAccountApi(
      request('verify-code', { email: appUser.email, code: '123456' }),
      env,
    );
    expect(conflict?.status).toBe(409);
    expect(await conflict?.json()).toMatchObject({ code: 'legacy_link_required' });
    expect(conflict?.headers.has('Set-Cookie')).toBe(false);
    db.completeManagedAuth.mockRejectedValueOnce(new Error('private database detail'));
    const failure = await handleAccountApi(
      request('verify-code', { email: appUser.email, code: '123456' }),
      env,
    );
    expect(failure?.status).toBe(503);
    expect(await failure?.text()).not.toContain('private database detail');
  });
  it('fails closed on limiter outage and honors shared retry windows', async () => {
    db.consumeAuthLimit.mockRejectedValueOnce(new Error('database offline'));
    expect(
      (await handleAccountApi(request('email-code', { email: appUser.email }), env))?.status,
    ).toBe(503);
    expect(provider).not.toHaveBeenCalled();
    db.consumeAuthLimit.mockResolvedValueOnce({ allowed: false, retry_after: 42 });
    const response = await handleAccountApi(request('email-code', { email: appUser.email }), env);
    expect(response?.status).toBe(429);
    expect(response?.headers.get('Retry-After')).toBe('42');
    expect(provider).not.toHaveBeenCalled();
  });
  it('rejects cross-origin auth and disables unverified signup in managed mode', async () => {
    expect(
      (
        await handleAccountApi(
          request('email-code', { email: appUser.email }, { Origin: 'https://runner.example' }),
          env,
        )
      )?.status,
    ).toBe(403);
    expect(
      (
        await handleAccountApi(
          request('signup', { email: appUser.email, password: 'long-password' }),
          env,
        )
      )?.status,
    ).toBe(409);
    expect(provider).not.toHaveBeenCalled();
  });
  it('handles expired codes and provider outages without creating sessions', async () => {
    provider.mockResolvedValueOnce(Response.json({ error: 'expired' }, { status: 403 }));
    expect(
      (
        await handleAccountApi(
          request('verify-code', { email: appUser.email, code: '123456' }),
          env,
        )
      )?.status,
    ).toBe(401);
    provider.mockRejectedValueOnce(new Error('timeout'));
    expect(
      (await handleAccountApi(request('email-code', { email: appUser.email }), env))?.status,
    ).toBe(503);
    expect(db.completeManagedAuth).not.toHaveBeenCalled();
  });
});
