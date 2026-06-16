import { afterEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from './auth';
import { handleAccountApi } from './accountApi';

type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const env = {
  PASSWORD_PEPPER: 'test-pepper',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  SUPABASE_URL: 'https://project.supabase.co',
};

describe('account API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
});

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
  });
}
