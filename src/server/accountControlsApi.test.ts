import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAccountApi } from './accountApi';
import { sha256Hex } from './auth';
import { getDatabase } from './database';
import { resetRateLimitsForTests } from './rateLimit';
import {
  ALICE,
  ALICE_LAPTOP_TOKEN,
  ALICE_PASSWORD,
  ALICE_TOKEN,
  BOB,
  BOB_TOKEN,
  cookie,
  createAccountFixture,
  TEST_PEPPER_ENV,
} from './accountTestFixtures';

vi.mock('./database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./database')>()),
  getDatabase: vi.fn(),
}));

const env = {
  ...TEST_PEPPER_ENV,
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  SUPABASE_URL: 'https://project.supabase.co',
};
let fixture: Awaited<ReturnType<typeof createAccountFixture>>;

async function use(migrated = true) {
  fixture = await createAccountFixture({ migrated });
  vi.mocked(getDatabase).mockReturnValue(fixture.database);
}

function call(
  path: string,
  {
    body,
    headers = {},
    method = 'GET',
  }: { body?: unknown; headers?: Record<string, string>; method?: string } = {},
) {
  return handleAccountApi(
    new Request(`https://app.example/api/${path}`, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '203.0.113.9',
        ...headers,
      },
      method,
    }),
    env,
  ) as Promise<Response>;
}

async function sessionIds(token: string) {
  const response = await call('account/sessions', { headers: cookie(token) });
  return (await response.json()).sessions as Array<{
    id: string;
    current: boolean;
    device: string;
  }>;
}

beforeEach(async () => {
  resetRateLimitsForTests();
  await use();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('account controls API', () => {
  it.each([
    ['account/sessions', 'GET'],
    ['account/sessions/revoke-others', 'POST'],
    [`account/sessions/${'0'.repeat(32)}`, 'DELETE'],
    ['account/export', 'GET'],
    ['account/delete', 'POST'],
  ])('requires a signed-in session for %s', async (path, method) => {
    const anonymous = await call(path, { method, body: method === 'POST' ? {} : undefined });
    expect(anonymous.status).toBe(401);
    const forged = await call(path, { method, headers: cookie('f'.repeat(43)) });
    expect(forged.status).toBe(401);
    expect(fixture.db.deleteOtherSessions).not.toHaveBeenCalled();
    expect(fixture.db.deleteAccount).not.toHaveBeenCalled();
  });

  it('rejects cross-origin requests before any account lookup', async () => {
    const response = await call('account/delete', {
      body: { confirmEmail: 'alice@example.com', password: ALICE_PASSWORD },
      headers: { ...cookie(ALICE_TOKEN), Origin: 'https://attacker.example' },
      method: 'POST',
    });
    expect(response.status).toBe(403);
    const readBack = await call('account/export', {
      headers: { ...cookie(ALICE_TOKEN), 'Sec-Fetch-Site': 'cross-site' },
    });
    expect(readBack.status).toBe(403);
    expect(fixture.db.findSessionUser).not.toHaveBeenCalled();
  });

  it('lists only the caller’s sessions, current first, without token material', async () => {
    const response = await call('account/sessions', {
      headers: {
        ...cookie(ALICE_LAPTOP_TOKEN),
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0',
      },
    });
    const text = await response.text();
    const { sessions } = JSON.parse(text);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({ current: true, device: 'Firefox on Windows' });
    expect(sessions[1]).toMatchObject({ current: false, device: 'Chrome on macOS' });
    expect(sessions[0].id).toMatch(/^[0-9a-f]{32}$/);
    for (const token of [ALICE_TOKEN, ALICE_LAPTOP_TOKEN, BOB_TOKEN]) {
      expect(text).not.toContain(token);
      expect(text).not.toContain(await sha256Hex(token));
    }
    // The used session records its last use once; the label it already had is kept.
    expect(fixture.db.updateSessionMetadata).toHaveBeenCalledWith(
      await sha256Hex(ALICE_LAPTOP_TOKEN),
      { last_used_at: expect.any(String) },
    );
  });

  it('labels a session from its User-Agent on first use and then only hourly', async () => {
    const headers = {
      ...cookie(BOB_TOKEN),
      'User-Agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
    };
    await call('account/sessions', { headers });
    await call('account/sessions', { headers });
    expect(fixture.db.updateSessionMetadata).toHaveBeenCalledOnce();
    expect(fixture.sessions.find((s) => s.user_id === BOB)).toMatchObject({
      device_label: 'Safari on iPhone',
      last_used_at: expect.any(String),
    });
  });

  it('revokes another session, which then fails authentication immediately', async () => {
    const [current, laptop] = await sessionIds(ALICE_TOKEN);
    expect(current.current).toBe(true);
    const revoked = await call(`account/sessions/${laptop.id}`, {
      headers: cookie(ALICE_TOKEN),
      method: 'DELETE',
    });
    expect(revoked.status).toBe(200);
    expect((await call('account/sessions', { headers: cookie(ALICE_LAPTOP_TOKEN) })).status).toBe(
      401,
    );
    expect((await call('history', { headers: cookie(ALICE_LAPTOP_TOKEN) })).status).toBe(401);
    const me = await (await call('me', { headers: cookie(ALICE_LAPTOP_TOKEN) })).json();
    expect(me.user).toBeNull();
    expect((await call('account/sessions', { headers: cookie(ALICE_TOKEN) })).status).toBe(200);
  });

  it('never revokes another user’s session or the current one', async () => {
    const [bobSession] = await sessionIds(BOB_TOKEN);
    const crossUser = await call(`account/sessions/${bobSession.id}`, {
      headers: cookie(ALICE_TOKEN),
      method: 'DELETE',
    });
    expect(crossUser.status).toBe(404);
    expect((await call('account/sessions', { headers: cookie(BOB_TOKEN) })).status).toBe(200);
    const [current] = await sessionIds(ALICE_TOKEN);
    const self = await call(`account/sessions/${current.id}`, {
      headers: cookie(ALICE_TOKEN),
      method: 'DELETE',
    });
    expect(self.status).toBe(400);
    expect(fixture.db.deleteUserSession).not.toHaveBeenCalled();
  });

  it('signs out everywhere else without touching other users', async () => {
    const response = await call('account/sessions/revoke-others', {
      headers: cookie(ALICE_TOKEN),
      method: 'POST',
    });
    expect(await response.json()).toEqual({ revoked: 1 });
    expect(fixture.sessions.filter((s) => s.user_id === ALICE)).toHaveLength(1);
    expect((await call('account/sessions', { headers: cookie(ALICE_LAPTOP_TOKEN) })).status).toBe(
      401,
    );
    expect((await call('account/sessions', { headers: cookie(BOB_TOKEN) })).status).toBe(200);
  });

  it('lists sessions without details before migration 0004', async () => {
    await use(false);
    const sessions = await sessionIds(ALICE_TOKEN);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({ current: true, device: null, lastUsedAt: null });
    expect(fixture.db.updateSessionMetadata).not.toHaveBeenCalled();
  });

  it('exports a versioned copy of only the caller’s data and no secrets', async () => {
    const response = await call('account/export', { headers: cookie(ALICE_TOKEN) });
    expect(response.headers.get('Content-Disposition')).toMatch(
      /^attachment; filename="code-visualizer-account-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const text = await response.text();
    const data = JSON.parse(text);
    expect(data).toMatchObject({
      format: 'code-visualizer-account-export',
      version: 1,
      account: { email: 'alice@example.com', id: ALICE, authMethod: 'legacy' },
      history: [{ id: 'alice-history', code: 'print("alice-history")' }],
      usage: [{ day: '2026-09-24', aiExplanations: 3, plan: 'free' }],
    });
    expect(data.sessions).toHaveLength(2);
    expect(text).not.toContain('bob');
    expect(text).not.toContain(BOB);
    expect(text).not.toContain('hmac_sha256');
    expect(text).not.toContain('test-pepper');
    expect(text).not.toContain(await sha256Hex(ALICE_TOKEN));
    expect(text).not.toContain(ALICE_TOKEN);
  });

  it('throttles repeated exports', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await call('account/export', { headers: cookie(ALICE_TOKEN) })).status).toBe(200);
    }
    expect((await call('account/export', { headers: cookie(ALICE_TOKEN) })).status).toBe(429);
  });
});

describe('account deletion API', () => {
  const remove = (body: unknown, token = ALICE_TOKEN, headers: Record<string, string> = {}) =>
    call('account/delete', { body, headers: { ...cookie(token), ...headers }, method: 'POST' });

  it('requires the typed email and the current password', async () => {
    expect(
      (await remove({ confirmEmail: 'bob@example.com', password: ALICE_PASSWORD })).status,
    ).toBe(400);
    expect((await remove({ confirmEmail: 'alice@example.com' })).status).toBe(400);
    const wrong = await remove({ confirmEmail: 'alice@example.com', password: 'not my password' });
    expect(wrong.status).toBe(401);
    expect(fixture.db.deleteAccount).not.toHaveBeenCalled();
    expect(fixture.users.map((user) => user.id)).toContain(ALICE);
  });

  it('deletes only the caller’s account and clears the cookie', async () => {
    const response = await remove({
      confirmEmail: ' Alice@Example.com ',
      password: ALICE_PASSWORD,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Set-Cookie')).toMatch(/^cv_session=; .*Max-Age=0/);
    expect(fixture.db.deleteAccount).toHaveBeenCalledWith(
      ALICE,
      await sha256Hex(ALICE_TOKEN),
      null,
    );
    expect(fixture.users.map((user) => user.id)).toEqual([BOB]);
    expect(fixture.history.map((item) => item.user_id)).toEqual([BOB]);
    expect(fixture.sessions.map((item) => item.user_id)).toEqual([BOB]);
    expect(fixture.usage.map((item) => item.subject)).toEqual([`user:${BOB}`]);
    expect((await call('account/sessions', { headers: cookie(ALICE_LAPTOP_TOKEN) })).status).toBe(
      401,
    );
    expect((await call('account/sessions', { headers: cookie(BOB_TOKEN) })).status).toBe(200);
  });

  it('cannot use one account’s password to delete another', async () => {
    const response = await remove(
      { confirmEmail: 'alice@example.com', password: ALICE_PASSWORD },
      BOB_TOKEN,
    );
    expect(response.status).toBe(400);
    const own = await remove(
      { confirmEmail: 'bob@example.com', password: ALICE_PASSWORD },
      BOB_TOKEN,
    );
    expect(own.status).toBe(401);
    expect(fixture.users).toHaveLength(2);
  });

  it('rejects a revoked session even with the right password', async () => {
    await call('account/sessions/revoke-others', { headers: cookie(ALICE_TOKEN), method: 'POST' });
    const response = await remove(
      { confirmEmail: 'alice@example.com', password: ALICE_PASSWORD },
      ALICE_LAPTOP_TOKEN,
    );
    expect(response.status).toBe(401);
    expect(fixture.users.map((user) => user.id)).toContain(ALICE);
  });

  it('throttles password attempts and caps the body size', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await remove({ confirmEmail: 'alice@example.com', password: `wrong password ${attempt}` });
    }
    expect(
      (await remove({ confirmEmail: 'alice@example.com', password: ALICE_PASSWORD })).status,
    ).toBe(429);
    resetRateLimitsForTests();
    const large = await remove({ confirmEmail: 'alice@example.com', padding: 'x'.repeat(5000) });
    expect(large.status).toBe(413);
    expect(fixture.db.deleteAccount).not.toHaveBeenCalled();
  });

  it('reports that deletion is unavailable before migration 0004', async () => {
    await use(false);
    const response = await remove({ confirmEmail: 'alice@example.com', password: ALICE_PASSWORD });
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain('database update');
    expect(fixture.users).toHaveLength(2);
  });

  it('requires a fresh email code for managed accounts and removes the provider identity', async () => {
    const subject = '10000000-0000-4000-8000-000000000001';
    const alice = fixture.users.find((user) => user.id === ALICE)!;
    alice.password_hash = '!managed:supabase';
    fixture.sessions.forEach((row) => {
      if (row.user_id === ALICE) row.auth_method = 'supabase';
    });
    fixture.identities.push({ subject, userId: ALICE });
    const provider = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/auth/v1/verify')) {
        return Response.json({
          user: {
            id: subject,
            email: 'alice@example.com',
            email_confirmed_at: '2026-09-01T00:00:00Z',
          },
        });
      }
      return new Response(null, { status: init?.method === 'DELETE' ? 200 : 500 });
    });
    vi.stubGlobal('fetch', provider);
    const managedEnv = { ...env, SUPABASE_ANON_KEY: 'anon-key' };
    const request = (body: unknown) =>
      handleAccountApi(
        new Request('https://app.example/api/account/delete', {
          body: JSON.stringify(body),
          headers: { ...cookie(ALICE_TOKEN), 'CF-Connecting-IP': '203.0.113.7' },
          method: 'POST',
        }),
        managedEnv,
      ) as Promise<Response>;

    expect(
      (await request({ confirmEmail: 'alice@example.com', password: ALICE_PASSWORD })).status,
    ).toBe(400);
    expect(provider).not.toHaveBeenCalled();
    const response = await request({ confirmEmail: 'alice@example.com', code: '123456' });
    expect(response.status).toBe(200);
    expect(fixture.db.deleteAccount).toHaveBeenCalledWith(
      ALICE,
      await sha256Hex(ALICE_TOKEN),
      subject,
    );
    const [url, init] = provider.mock.calls[1];
    expect(String(url)).toBe(`https://project.supabase.co/auth/v1/admin/users/${subject}`);
    expect(init?.method).toBe('DELETE');
    expect(fixture.identities).toHaveLength(0);
  });

  it('keeps a managed account when the verified identity is not its own', async () => {
    const alice = fixture.users.find((user) => user.id === ALICE)!;
    alice.password_hash = '!managed:supabase';
    fixture.sessions.forEach((row) => {
      if (row.user_id === ALICE) row.auth_method = 'supabase';
    });
    fixture.identities.push({ subject: '10000000-0000-4000-8000-000000000001', userId: ALICE });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          user: {
            id: '10000000-0000-4000-8000-000000000002',
            email: 'alice@example.com',
            email_confirmed_at: '2026-09-01T00:00:00Z',
          },
        }),
      ),
    );
    const response = (await handleAccountApi(
      new Request('https://app.example/api/account/delete', {
        body: JSON.stringify({ confirmEmail: 'alice@example.com', code: '123456' }),
        headers: cookie(ALICE_TOKEN),
        method: 'POST',
      }),
      { ...env, SUPABASE_ANON_KEY: 'anon-key' },
    )) as Response;
    expect(response.status).toBe(401);
    expect(response.headers.has('Set-Cookie')).toBe(false);
    expect(fixture.users.map((user) => user.id)).toContain(ALICE);
    expect(fixture.users.map((user) => user.id)).toContain(BOB);
  });
});
