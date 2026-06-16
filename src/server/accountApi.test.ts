import { afterEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from './auth';
import { handleAccountApi } from './accountApi';
import { resetRateLimitsForTests } from './rateLimit';

type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const env = {
  PASSWORD_PEPPER: 'test-pepper',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  SUPABASE_URL: 'https://project.supabase.co',
};

describe('account API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRateLimitsForTests();
  });

  it('signs up without rebuilding a consumed POST request', async () => {
    const fetchMock = vi.fn<FetchMock>(async (input) => {
      const url = String(input);
      if (url.includes('/usage_daily')) {
        return json([]);
      }
      return new Response(null, { status: 201 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleAccountApi(
      new Request('https://example.com/api/auth/signup', {
        body: JSON.stringify({
          email: 'person@example.com',
          password: 'correct horse battery staple',
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
      env,
    );

    expect(response?.status).toBe(201);
    expect(response?.headers.get('Set-Cookie')).toContain('cv_session=');
    expect(await response?.json()).toMatchObject({
      accountConfigured: true,
      user: { email: 'person@example.com' },
    });
  });

  it('logs in without rebuilding a consumed POST request', async () => {
    const passwordHash = await hashPassword(env, 'correct horse battery staple');
    const fetchMock = vi.fn<FetchMock>(async (input, init) => {
      const url = String(input);
      if (url.includes('/users')) {
        return json([
          {
            created_at: '2026-06-16T00:00:00.000Z',
            email: 'person@example.com',
            id: 'd0fe3c53-39ad-42e3-85c5-dc2f923191bb',
            password_hash: passwordHash,
            stripe_customer_id: null,
          },
        ]);
      }
      if (url.includes('/usage_daily')) {
        return json([]);
      }
      return new Response(null, { status: init?.method === 'POST' ? 201 : 204 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleAccountApi(
      new Request('https://example.com/api/auth/login', {
        body: JSON.stringify({
          email: 'person@example.com',
          password: 'correct horse battery staple',
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
      env,
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get('Set-Cookie')).toContain('cv_session=');
    expect(await response?.json()).toMatchObject({
      accountConfigured: true,
      user: { email: 'person@example.com' },
    });
  });

  it('rejects oversized auth bodies before parsing JSON', async () => {
    const fetchMock = vi.fn<FetchMock>(async () => new Response(null, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleAccountApi(
      new Request('https://example.com/api/auth/signup', {
        body: '{}',
        headers: {
          'CF-Connecting-IP': '203.0.113.10',
          'Content-Length': '4097',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      }),
      env,
    );

    expect(response?.status).toBe(413);
    expect(await response?.json()).toMatchObject({
      error: expect.stringContaining('Request body is too large'),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throttles login attempts by IP', async () => {
    const fetchMock = vi.fn<FetchMock>(async () => json([]));
    vi.stubGlobal('fetch', fetchMock);

    const request = () =>
      new Request('https://example.com/api/auth/login', {
        body: JSON.stringify({
          email: 'person@example.com',
          password: 'wrong password',
        }),
        headers: {
          'CF-Connecting-IP': '203.0.113.20',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await handleAccountApi(request(), env);
      expect(response?.status).toBe(401);
    }

    const throttled = await handleAccountApi(request(), env);
    expect(throttled?.status).toBe(429);
    expect(throttled?.headers.get('Retry-After')).toBeTruthy();
    expect(await throttled?.json()).toEqual({
      error: 'Too many attempts. Try again in a minute.',
    });
  });

  it('requires PASSWORD_PEPPER for signup and login', async () => {
    const fetchMock = vi.fn<FetchMock>(async () => new Response(null, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleAccountApi(
      new Request('https://example.com/api/auth/signup', {
        body: JSON.stringify({
          email: 'person@example.com',
          password: 'correct horse battery staple',
        }),
        headers: {
          'CF-Connecting-IP': '203.0.113.30',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      }),
      {
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
        SUPABASE_URL: 'https://project.supabase.co',
      },
    );

    expect(response?.status).toBe(503);
    expect(await response?.json()).toEqual({
      error: 'Password hashing is not configured.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects cross-origin state-changing requests', async () => {
    const fetchMock = vi.fn<FetchMock>(async () => new Response(null, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleAccountApi(
      new Request('https://example.com/api/auth/logout', {
        headers: { Origin: 'https://attacker.example' },
        method: 'POST',
      }),
      env,
    );

    expect(response?.status).toBe(403);
    expect(await response?.json()).toEqual({
      error: 'Cross-origin requests are not allowed.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
  });
}
