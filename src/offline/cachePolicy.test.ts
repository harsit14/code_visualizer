import { describe, expect, it } from 'vitest';
import {
  currentCacheNames,
  isAppRoute,
  isCacheableResponse,
  isShellForBuild,
  isSkipWaitingMessage,
  precacheRequestCache,
  pyodideCacheName,
  routeRequest,
  shellCacheName,
  SKIP_WAITING_MESSAGE,
  staleCacheNames,
  type RequestLike,
  type ResponseLike,
} from './cachePolicy';

const build = { version: 'abc123', pyodideVersion: '0.29.4' };
const ROOT = 'https://codemapper.win/';
const PAGES = 'https://harsit14.github.io/code_visualizer/';

function request(
  url: string,
  init: Partial<Omit<RequestLike, 'headers'>> & { headers?: string[] } = {},
) {
  const headers = new Set((init.headers ?? []).map((name) => name.toLowerCase()));
  return {
    url,
    method: init.method ?? 'GET',
    mode: init.mode ?? 'cors',
    credentials: init.credentials ?? 'same-origin',
    cache: init.cache ?? 'default',
    headers: { has: (name: string) => headers.has(name.toLowerCase()) },
  };
}

function response(
  init: Partial<Omit<ResponseLike, 'headers'>> & { headers?: Record<string, string> } = {},
) {
  const headers = new Map(
    Object.entries(init.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]),
  );
  return {
    status: init.status ?? 200,
    type: init.type ?? 'basic',
    redirected: init.redirected ?? false,
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
  };
}

describe('service worker routing', () => {
  it('resolves app routes to the cached shell, network first', () => {
    for (const path of ['', 'app', 'app/', 'app/anything']) {
      expect(routeRequest(request(`${ROOT}${path}`, { mode: 'navigate' }), ROOT, build)).toEqual({
        strategy: 'navigation',
        cacheName: shellCacheName('abc123'),
        shellUrl: ROOT,
      });
    }
    expect(
      routeRequest(request(`${PAGES}app?embed=1`, { mode: 'navigate' }), PAGES, build),
    ).toMatchObject({ strategy: 'navigation', shellUrl: PAGES });
  });

  it('opens files, not the shell, when they are navigated to directly', () => {
    expect(
      routeRequest(request(`${ROOT}screenshots/a.png`, { mode: 'navigate' }), ROOT, build),
    ).toEqual({ strategy: 'network-first', cacheName: shellCacheName('abc123') });
    expect(isAppRoute('index.html')).toBe(true);
    expect(isAppRoute('brand/step-logo.svg')).toBe(false);
  });

  it('serves hashed assets cache first from the versioned shell cache', () => {
    expect(routeRequest(request(`${PAGES}assets/App-C1A6QBAy.js`), PAGES, build)).toEqual({
      strategy: 'cache-first',
      cacheName: 'codeviz-shell-abc123',
    });
  });

  it('keeps the Pyodide runtime in a cache named after its version', () => {
    for (const file of ['pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']) {
      expect(routeRequest(request(`${ROOT}assets/pyodide/${file}`), ROOT, build)).toEqual({
        strategy: 'cache-first',
        cacheName: 'codeviz-pyodide-0.29.4',
      });
    }
  });

  it('revalidates unhashed public files but keeps a copy for offline use', () => {
    expect(routeRequest(request(`${ROOT}screenshots/dashboard-overview.png`), ROOT, build)).toEqual(
      { strategy: 'network-first', cacheName: shellCacheName('abc123') },
    );
  });

  it('never handles the API, on the root or under the base path', () => {
    for (const url of [
      `${ROOT}api/capabilities`,
      `${ROOT}api/explain-step`,
      'https://harsit14.github.io/api/account',
      `${PAGES}api/history`,
    ]) {
      const scope = url.includes('github.io') ? PAGES : ROOT;
      expect(routeRequest(request(url), scope, build)).toEqual({ strategy: 'network' });
      expect(routeRequest(request(url, { mode: 'navigate' }), scope, build)).toEqual({
        strategy: 'network',
      });
    }
  });

  it('never handles cross-origin, credentialed, partial or non-GET requests', () => {
    const passThrough = [
      request('https://cdn.example.com/assets/x.js'),
      request(`${ROOT}assets/a.js`, { credentials: 'include' }),
      request(`${ROOT}assets/a.js`, { headers: ['Authorization'] }),
      request(`${ROOT}assets/pyodide/pyodide.asm.wasm`, { headers: ['Range'] }),
      request(`${ROOT}assets/a.js`, { method: 'POST' }),
      request(`${ROOT}assets/a.js`, { cache: 'only-if-cached', mode: 'no-cors' }),
      request(`${ROOT}sw.js`),
    ];
    for (const item of passThrough) {
      expect(routeRequest(item, ROOT, build)).toEqual({ strategy: 'network' });
    }
  });

  it('ignores paths outside the base path', () => {
    expect(
      routeRequest(
        request('https://harsit14.github.io/other-project/', { mode: 'navigate' }),
        PAGES,
        build,
      ),
    ).toEqual({ strategy: 'network' });
  });
});

describe('cacheable responses', () => {
  it('stores complete same-origin responses', () => {
    expect(isCacheableResponse(response({ headers: { 'Content-Type': 'text/javascript' } }))).toBe(
      true,
    );
  });

  it.each([
    ['a partial response', { status: 206 }],
    ['an error', { status: 404 }],
    ['an opaque cross-origin response', { type: 'opaque', status: 0 }],
    ['a CORS response', { type: 'cors' }],
    ['a redirected response', { redirected: true }],
    ['a no-store response', { headers: { 'Cache-Control': 'no-store' } }],
    ['a private response', { headers: { 'Cache-Control': 'private, max-age=60' } }],
  ])('refuses %s', (_label, init) => {
    expect(isCacheableResponse(response(init))).toBe(false);
  });

  it('accepts HTML only for the shell, not an SPA fallback under an asset URL', () => {
    const html = response({ headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    expect(isCacheableResponse(html)).toBe(false);
    expect(isCacheableResponse(html, { html: true })).toBe(true);
  });

  it('matches the shell to the build that precaches it', () => {
    const shell = '<script type="module" src="/code_visualizer/assets/index-A1.js"></script>';
    expect(isShellForBuild(shell, 'assets/index-A1.js')).toBe(true);
    expect(isShellForBuild(shell, 'assets/index-B2.js')).toBe(false);
  });

  it('revalidates everything but hashed assets when precaching', () => {
    expect(precacheRequestCache('assets/index-A1.js')).toBe('default');
    expect(precacheRequestCache('./')).toBe('no-cache');
    expect(precacheRequestCache('manifest.webmanifest')).toBe('no-cache');
  });
});

describe('versioned caches', () => {
  it('names caches after the build and the Pyodide version', () => {
    expect(currentCacheNames(build)).toEqual(['codeviz-shell-abc123', 'codeviz-pyodide-0.29.4']);
    expect(pyodideCacheName('0.30.0')).not.toBe(pyodideCacheName('0.29.4'));
  });

  it('deletes earlier builds and Pyodide versions but no other caches', () => {
    const existing = [
      'codeviz-shell-old111',
      'codeviz-shell-abc123',
      'codeviz-pyodide-0.28.0',
      'codeviz-pyodide-0.29.4',
      'some-other-app',
    ];
    expect(staleCacheNames(existing, currentCacheNames(build))).toEqual([
      'codeviz-shell-old111',
      'codeviz-pyodide-0.28.0',
    ]);
  });

  it('recognises the update message only', () => {
    expect(isSkipWaitingMessage({ type: SKIP_WAITING_MESSAGE })).toBe(true);
    expect(isSkipWaitingMessage({ type: 'other' })).toBe(false);
    expect(isSkipWaitingMessage(SKIP_WAITING_MESSAGE)).toBe(false);
    expect(isSkipWaitingMessage(null)).toBe(false);
  });
});
