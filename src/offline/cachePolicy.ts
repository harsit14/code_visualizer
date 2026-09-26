/**
 * Routing and caching decisions for the offline service worker, kept free of
 * service worker APIs so they can be unit-tested. Paths are relative to the
 * worker scope, which is the deployment base path.
 */

/** Every cache this app owns starts with this prefix; other caches are left alone. */
export const CACHE_PREFIX = 'codeviz-';
/** Posted by the page when the learner accepts an update. */
export const SKIP_WAITING_MESSAGE = 'codeviz:skip-waiting';
/** The scope URL itself, which serves index.html. */
export const SHELL_PATH = './';

/** Injected into sw.js at build time. */
export type ServiceWorkerBuild = {
  /** False builds ship a worker that removes itself and its caches. */
  enabled: boolean;
  /** Hash of this build's precached files. */
  version: string;
  pyodideVersion: string;
  /** Scope-relative paths fetched on install. */
  precache: string[];
  /** Entry script the fetched shell must reference, so a newer deploy is not cached as this build. */
  shellEntry: string;
};

export type RequestLike = {
  url: string;
  method: string;
  mode: string;
  credentials: string;
  cache?: string;
  headers: { has(name: string): boolean };
};

export type ResponseLike = {
  status: number;
  type: string;
  redirected: boolean;
  headers: { get(name: string): string | null };
};

export type Route =
  /** Not handled: the browser fetches it as if there were no service worker. */
  | { strategy: 'network' }
  /** Network first; offline, SPA routes resolve to the cached shell. */
  | { strategy: 'navigation'; cacheName: string; shellUrl: string }
  /** Immutable files: hashed build assets and the versioned Pyodide runtime. */
  | { strategy: 'cache-first'; cacheName: string }
  /** Unhashed public files such as icons and screenshots. */
  | { strategy: 'network-first'; cacheName: string };

const NETWORK: Route = { strategy: 'network' };

export function shellCacheName(version: string) {
  return `${CACHE_PREFIX}shell-${version}`;
}

export function pyodideCacheName(pyodideVersion: string) {
  return `${CACHE_PREFIX}pyodide-${pyodideVersion}`;
}

export function currentCacheNames(build: Pick<ServiceWorkerBuild, 'version' | 'pyodideVersion'>) {
  return [shellCacheName(build.version), pyodideCacheName(build.pyodideVersion)];
}

/** Caches from earlier builds or Pyodide versions, to delete on activate. */
export function staleCacheNames(existing: readonly string[], keep: readonly string[]) {
  return existing.filter((name) => name.startsWith(CACHE_PREFIX) && !keep.includes(name));
}

function isApiPath(pathname: string, scopePath: string) {
  return (
    pathname === '/api' ||
    pathname.startsWith('/api/') ||
    pathname === `${scopePath}api` ||
    pathname.startsWith(`${scopePath}api/`)
  );
}

/** Client routes (`/`, `/app`, `/app/…`) as opposed to files such as `/screenshots/a.png`. */
export function isAppRoute(relativePath: string) {
  const lastSegment = relativePath.split('/').pop() ?? '';
  return !lastSegment.includes('.') || lastSegment.endsWith('.html');
}

export function routeRequest(
  request: RequestLike,
  scope: string,
  build: Pick<ServiceWorkerBuild, 'version' | 'pyodideVersion'>,
): Route {
  const url = new URL(request.url);
  const scopeUrl = new URL(scope);
  if (request.method !== 'GET' || url.origin !== scopeUrl.origin) return NETWORK;
  // Credentialed and partial requests never touch the cache.
  if (
    request.credentials === 'include' ||
    request.headers.has('authorization') ||
    request.headers.has('range')
  ) {
    return NETWORK;
  }
  // DevTools issues these and fetch() rejects them from a service worker.
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return NETWORK;
  if (isApiPath(url.pathname, scopeUrl.pathname)) return NETWORK;
  if (!url.pathname.startsWith(scopeUrl.pathname)) return NETWORK;

  const path = url.pathname.slice(scopeUrl.pathname.length);
  const shellCache = shellCacheName(build.version);
  if (request.mode === 'navigate') {
    return isAppRoute(path)
      ? { strategy: 'navigation', cacheName: shellCache, shellUrl: scopeUrl.href }
      : { strategy: 'network-first', cacheName: shellCache };
  }
  if (path === 'sw.js') return NETWORK;
  if (path.startsWith('assets/pyodide/')) {
    return { strategy: 'cache-first', cacheName: pyodideCacheName(build.pyodideVersion) };
  }
  if (path.startsWith('assets/')) return { strategy: 'cache-first', cacheName: shellCache };
  return { strategy: 'network-first', cacheName: shellCache };
}

/**
 * Only complete, same-origin, shareable responses are stored. HTML is accepted
 * only for the shell: a static host answering a missing asset with the SPA
 * fallback must not be cached under the asset's URL.
 */
export function isCacheableResponse(response: ResponseLike, { html = false } = {}) {
  if (response.status !== 200 || response.type !== 'basic' || response.redirected) return false;
  const cacheControl = response.headers.get('cache-control') ?? '';
  if (/\b(no-store|private)\b/i.test(cacheControl)) return false;
  const contentType = response.headers.get('content-type') ?? '';
  return html || !contentType.includes('text/html');
}

/** Hashed assets can come from the HTTP cache; everything else is revalidated. */
export function precacheRequestCache(path: string): 'default' | 'no-cache' {
  return path.startsWith('assets/') ? 'default' : 'no-cache';
}

export function isShellForBuild(html: string, shellEntry: string) {
  return html.includes(shellEntry);
}

export function isSkipWaitingMessage(data: unknown) {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: unknown }).type === SKIP_WAITING_MESSAGE
  );
}
