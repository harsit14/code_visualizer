import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEEPSEEK_CHAT_COMPLETIONS_URL } from '../../src/engine/deepseekShared';
import { networkOf, resetExplainerBurstsForTests } from '../../src/server/usage';
import { onRequestPost } from './explain-step';

const SUPABASE = 'https://project.supabase.co';
const baseEnv = {
  DEEPSEEK_API_KEY: 'sk-server-only',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  SUPABASE_URL: SUPABASE,
};

function context(line = 1) {
  return {
    added: ['total'],
    changed: [],
    codeExcerpt: `total = ${line}`,
    currentLine: 1,
    currentLineText: `total = ${line}`,
    event: 'line',
    exception: null,
    frameName: '<module>',
    language: 'python',
    locals: { total: String(line) },
    removed: [],
    returnValue: null,
    stdout: '',
    variableChanges: [],
  };
}

type Provider = 'ok' | 'error' | 'timeout';

/** A tiny stand-in for PostgREST plus the AI provider. */
function backend({ migrated = true } = {}) {
  const counts = new Map<string, number>();
  const cache = new Map<string, { answer: string; model: string }>();
  let provider: Provider = 'ok';
  const calls = { provider: 0 };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.href === DEEPSEEK_CHAT_COMPLETIONS_URL) {
      calls.provider += 1;
      if (provider === 'timeout') throw new DOMException('timed out', 'TimeoutError');
      if (provider === 'error')
        return new Response('{"error":{"message":"busy"}}', { status: 500 });
      return Response.json({ choices: [{ message: { content: 'An answer.' } }], model: 'm1' });
    }
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (url.pathname.endsWith('/rpc/increment_usage_daily')) {
      const next = (counts.get(body.p_subject) ?? 0) + 1;
      counts.set(body.p_subject, next);
      return Response.json([{ new_count: next }]);
    }
    if (url.pathname.endsWith('/rpc/refund_usage_daily')) {
      if (!migrated) return new Response('{"message":"missing"}', { status: 404 });
      counts.set(body.p_subject, Math.max(0, (counts.get(body.p_subject) ?? 0) - 1));
      return new Response(null, { status: 204 });
    }
    if (url.pathname.endsWith('/explain_cache')) {
      if (!migrated) return new Response('{"message":"missing"}', { status: 404 });
      if (init?.method === 'POST') {
        cache.set(body.context_hash, { answer: body.answer, model: body.model });
        return new Response(null, { status: 201 });
      }
      const hash = url.searchParams.get('context_hash')?.replace(/^eq\./, '') ?? '';
      const row = cache.get(hash);
      return Response.json(row ? [row] : []);
    }
    return new Response('[]', { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    counts,
    calls,
    setProvider(next: Provider) {
      provider = next;
    },
    anonCount: () => [...counts].filter(([key]) => key.startsWith('anon:')).map(([, v]) => v),
  };
}

function explain(
  body: unknown,
  env: Record<string, string> = baseEnv,
  headers: Record<string, string> = {},
) {
  return onRequestPost({
    env,
    request: new Request('https://example.com/api/explain-step', {
      body: JSON.stringify({ context: body }),
      headers: {
        'CF-Connecting-IP': '203.0.113.7',
        'Content-Type': 'application/json',
        ...headers,
      },
      method: 'POST',
    }),
  });
}

beforeEach(() => resetExplainerBurstsForTests());
afterEach(() => vi.unstubAllGlobals());

describe('AI explainer quota', () => {
  it('charges a delivered answer once and serves repeats from the cache for free', async () => {
    const server = backend();
    const first = await explain(context());
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ text: 'An answer.', cached: false });
    const repeat = await explain(context());
    expect(await repeat.json()).toMatchObject({ text: 'An answer.', cached: true });
    expect(server.calls.provider).toBe(1);
    expect(server.anonCount()).toEqual([1]);
    expect(server.counts.get('global:explain')).toBe(1);
  });

  it('refunds the reservation when the provider fails or times out', async () => {
    const server = backend();
    server.setProvider('error');
    const failed = await explain(context());
    expect(failed.status).toBe(502);
    expect((await failed.json()).error).toContain('No explanation was used');
    server.setProvider('timeout');
    const slow = await explain(context(2));
    expect(slow.status).toBe(504);
    expect(server.anonCount()).toEqual([0]);
    expect(server.counts.get('global:explain')).toBe(0);
  });

  it('does not keep counting after the limit is reached', async () => {
    const server = backend();
    const env = { ...baseEnv, ANON_DAILY_EXPLAIN_LIMIT: '1' };
    expect((await explain(context(1), env)).status).toBe(200);
    const over = await explain(context(2), env);
    expect(over.status).toBe(429);
    expect((await over.json()).usage).toMatchObject({ used: 1, remaining: 0 });
    expect(server.anonCount()).toEqual([1]);
    expect(server.calls.provider).toBe(1);
  });

  it('counts guests by network, not by user agent', async () => {
    const server = backend();
    const env = { ...baseEnv, ANON_DAILY_EXPLAIN_LIMIT: '1' };
    await explain(context(1), env, { 'User-Agent': 'browser-a' });
    const other = await explain(context(2), env, { 'User-Agent': 'browser-b' });
    expect(other.status).toBe(429);
    expect(server.anonCount()).toEqual([1]);
  });

  it('stops everyone at the global daily cap', async () => {
    const server = backend();
    const env = { ...baseEnv, EXPLAIN_GLOBAL_DAILY_LIMIT: '1' };
    expect((await explain(context(1), env)).status).toBe(200);
    const capped = await explain(context(2), env, { 'CF-Connecting-IP': '198.51.100.9' });
    expect(capped.status).toBe(503);
    expect(server.counts.get('global:explain')).toBe(1);
  });

  it('limits bursts from one guest', async () => {
    backend();
    const statuses = [];
    const env = { ...baseEnv, ANON_DAILY_EXPLAIN_LIMIT: '100' };
    for (let index = 0; index < 9; index += 1) {
      statuses.push((await explain(context(index + 10), env)).status);
    }
    expect(statuses.slice(0, 8).every((status) => status === 200)).toBe(true);
    expect(statuses[8]).toBe(429);
  });

  it('still answers before the refund and cache migration is applied', async () => {
    const server = backend({ migrated: false });
    expect((await explain(context())).status).toBe(200);
    server.setProvider('error');
    expect((await explain(context(2))).status).toBe(502);
  });
});

describe('networkOf', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    ['2001:db8:85a3:8d3:1319:8a2e:370:7348', '2001:0db8:85a3:08d3::/64'],
    ['2001:db8::1', '2001:0db8:0000:0000::/64'],
    ['::1', '0000:0000:0000:0000::/64'],
  ])('%s → %s', (address, expected) => {
    expect(networkOf(address)).toBe(expected);
  });
});
