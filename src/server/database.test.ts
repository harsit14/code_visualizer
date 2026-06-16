import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getDatabase,
  isDatabaseUniqueConstraintError,
} from './database';

type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

describe('Supabase database adapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is unavailable until Supabase secrets are configured', () => {
    expect(getDatabase({})).toBeNull();
    expect(getDatabase({ SUPABASE_URL: 'https://project.supabase.co' })).toBeNull();
  });

  it('increments usage through the Supabase RPC endpoint', async () => {
    const fetchMock = vi.fn<FetchMock>(
      async () =>
        new Response(JSON.stringify([{ new_count: 7 }]), {
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const db = getDatabase({
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      SUPABASE_URL: 'https://project.supabase.co',
    });

    await expect(
      db?.incrementUsageDaily({
        day: '2026-06-16',
        plan: 'free',
        subject: 'user:abc',
        updatedAt: '2026-06-16T12:00:00.000Z',
      }),
    ).resolves.toBe(7);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://project.supabase.co/rest/v1/rpc/increment_usage_daily');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(
      JSON.stringify({
        p_day: '2026-06-16',
        p_plan: 'free',
        p_subject: 'user:abc',
        p_updated_at: '2026-06-16T12:00:00.000Z',
      }),
    );
    expect(new Headers(init?.headers).get('apikey')).toBe('service-role-key');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer service-role-key');
  });

  it('recognizes Supabase unique constraint errors', async () => {
    const fetchMock = vi.fn<FetchMock>(
      async () =>
        new Response(
          JSON.stringify({
            code: '23505',
            message: 'duplicate key value violates unique constraint "users_email_key"',
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 409,
          },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const db = getDatabase({
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      SUPABASE_URL: 'https://project.supabase.co',
    });

    try {
      await db?.createUser({
        created_at: '2026-06-16T12:00:00.000Z',
        email: 'person@example.com',
        id: '80c2c8f7-8a11-47ed-a084-6ec71d47d260',
        password_hash: 'hmac_sha256_v1$salt$hash',
      });
      throw new Error('Expected createUser to fail.');
    } catch (error) {
      expect(isDatabaseUniqueConstraintError(error)).toBe(true);
    }
  });
});
