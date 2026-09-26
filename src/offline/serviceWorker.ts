/**
 * Offline service worker, built to `sw.js` by offlineShellPlugin. It precaches
 * this build's app shell, caches the Pyodide runtime on first use, and waits
 * for the page to accept an update instead of swapping assets under a running
 * session. It must stay self-contained: a classic worker script cannot import.
 */
import {
  currentCacheNames,
  isCacheableResponse,
  isShellForBuild,
  isSkipWaitingMessage,
  precacheRequestCache,
  routeRequest,
  SHELL_PATH,
  staleCacheNames,
  CACHE_PREFIX,
  type Route,
  type ServiceWorkerBuild,
} from './cachePolicy';

// Replaced with this build's precache manifest by offlineShellPlugin.
declare const __CODEVIZ_SW_BUILD__: ServiceWorkerBuild;

// Minimal service worker types; the app compiles against the DOM library only.
type ExtendableEvent = Event & { waitUntil(promise: Promise<unknown>): void };
type FetchEvent = ExtendableEvent & {
  request: Request;
  preloadResponse?: Promise<Response | undefined>;
  respondWith(response: Promise<Response>): void;
};
type ExtendableMessageEvent = ExtendableEvent & { data: unknown };
type ServiceWorkerScope = {
  registration: ServiceWorkerRegistration & {
    navigationPreload?: { enable(): Promise<void> };
  };
  clients: { claim(): Promise<void> };
  skipWaiting(): Promise<void>;
  addEventListener(type: 'install' | 'activate', listener: (event: ExtendableEvent) => void): void;
  addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void;
  addEventListener(type: 'message', listener: (event: ExtendableMessageEvent) => void): void;
};

const worker = self as unknown as ServiceWorkerScope;
const build = __CODEVIZ_SW_BUILD__;
const scope = worker.registration.scope;
// Hosts may send `Vary: Origin`, and the browser adds an Origin header to module
// script requests but not to the worker's own fetches, so a Vary-respecting match
// would miss files that are cached. Same-origin files never differ by Origin.
const MATCH: CacheQueryOptions = { ignoreVary: true };

async function precacheShell() {
  const [shellCache] = currentCacheNames(build);
  const cache = await caches.open(shellCache);
  await Promise.all(
    build.precache.map(async (path) => {
      const url = new URL(path, scope).href;
      if (await cache.match(url, MATCH)) return;
      // Hashed files are identical in every cache, so reuse an earlier build's copy.
      if (path.startsWith('assets/')) {
        const earlier = await caches.match(url, MATCH);
        if (earlier) return cache.put(url, earlier);
      }
      const response = await fetch(
        new Request(url, { cache: precacheRequestCache(path), credentials: 'same-origin' }),
      );
      const isShell = path === SHELL_PATH;
      if (!isCacheableResponse(response, { html: isShell })) {
        throw new Error(`Could not precache ${path} (${response.status}).`);
      }
      if (isShell && !isShellForBuild(await response.clone().text(), build.shellEntry)) {
        // A newer deploy is live; fail so the browser installs that build's worker instead.
        throw new Error('The served app shell belongs to a different build.');
      }
      await cache.put(url, response);
    }),
  );
}

async function activate() {
  const stale = staleCacheNames(await caches.keys(), currentCacheNames(build));
  await Promise.all(stale.map((name) => caches.delete(name)));
  await worker.registration.navigationPreload?.enable();
  await worker.clients.claim();
}

/** Navigations use the preload the browser already started. */
async function fromNetwork(event: FetchEvent) {
  return (await event.preloadResponse) ?? fetch(event.request);
}

function store(event: FetchEvent, cacheName: string, response: Response) {
  if (!isCacheableResponse(response)) return;
  const copy = response.clone();
  event.waitUntil(caches.open(cacheName).then((cache) => cache.put(event.request, copy)));
}

async function respond(event: FetchEvent, route: Exclude<Route, { strategy: 'network' }>) {
  const { cacheName } = route;
  if (route.strategy === 'cache-first') {
    const cached = await caches.match(event.request, { ...MATCH, cacheName });
    if (cached) return cached;
    const response = await fromNetwork(event);
    store(event, cacheName, response);
    return response;
  }
  try {
    const response = await fromNetwork(event);
    // Navigations are never stored: the shell stays the one this build precached.
    if (route.strategy === 'network-first') store(event, cacheName, response);
    return response;
  } catch (error) {
    const cached = await caches.match(
      route.strategy === 'navigation' ? route.shellUrl : event.request,
      { ...MATCH, cacheName },
    );
    if (cached) return cached;
    throw error;
  }
}

async function removeOfflineSupport() {
  const names = await caches.keys();
  await Promise.all(
    names.filter((name) => name.startsWith(CACHE_PREFIX)).map((name) => caches.delete(name)),
  );
  await worker.registration.unregister();
}

if (build.enabled) {
  worker.addEventListener('install', (event) => event.waitUntil(precacheShell()));
  worker.addEventListener('activate', (event) => event.waitUntil(activate()));
  worker.addEventListener('message', (event) => {
    if (isSkipWaitingMessage(event.data)) void worker.skipWaiting();
  });
  worker.addEventListener('fetch', (event) => {
    const route = routeRequest(event.request, scope, build);
    if (route.strategy !== 'network') event.respondWith(respond(event, route));
  });
} else {
  // Disabled builds replace an installed worker with one that cleans up after itself.
  worker.addEventListener('install', () => void worker.skipWaiting());
  worker.addEventListener('activate', (event) => event.waitUntil(removeOfflineSupport()));
}
