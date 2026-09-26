/**
 * Page side of the offline service worker: registers it in production builds
 * and tracks whether a new version is waiting, so the UI can offer a reload
 * instead of swapping assets under a running session.
 */
import { useSyncExternalStore } from 'react';

// Duplicates SKIP_WAITING_MESSAGE in cachePolicy.ts (a test keeps them equal):
// importing it would make sw.js depend on a chunk shared with the page.
const SKIP_WAITING_MESSAGE = 'codeviz:skip-waiting';
const UPDATE_CHECK_MS = 60 * 60 * 1000;

type NetworkInformation = { saveData?: boolean; effectiveType?: string };
export type RegistrationContext = {
  production: boolean;
  enabled: boolean;
  supported: boolean;
  secure: boolean;
  /** Inside an iframe, including `?embed=1` embeds on other sites. */
  framed: boolean;
};

const listeners = new Set<() => void>();
let updateReady = false;
let waitingWorker: ServiceWorker | null = null;
let updateRequested = false;
let started = false;

function offerUpdate(worker: ServiceWorker | null) {
  waitingWorker = worker;
  updateReady = true;
  listeners.forEach((listener) => listener());
}

function subscribeToUpdates(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useUpdateReady() {
  return useSyncExternalStore(
    subscribeToUpdates,
    () => updateReady,
    () => false,
  );
}

/** Activates the waiting version; the page reloads once it takes control. */
export function applyUpdate(reload = () => window.location.reload()) {
  if (!waitingWorker) {
    reload();
    return;
  }
  updateRequested = true;
  waitingWorker.postMessage({ type: SKIP_WAITING_MESSAGE });
}

/** Production app pages only: never in development, frames or embeds. */
export function serviceWorkerAction(context: RegistrationContext) {
  if (!context.production || !context.supported || !context.secure) return 'none';
  if (!context.enabled) return 'unregister';
  return context.framed ? 'none' : 'register';
}

/** Precaching downloads the dashboard, so the landing page waits for intent on data saver. */
export function prefersSavingData(
  connection: NetworkInformation | undefined = (
    navigator as Navigator & { connection?: NetworkInformation }
  ).connection,
) {
  return connection?.saveData === true || /2g/.test(connection?.effectiveType ?? '');
}

export function serviceWorkerScope(base = import.meta.env.BASE_URL) {
  return base.endsWith('/') ? base : `${base}/`;
}

function currentContext(): RegistrationContext {
  return {
    production: import.meta.env.PROD,
    enabled: import.meta.env.VITE_SERVICE_WORKER !== 'false',
    supported: 'serviceWorker' in navigator,
    secure: window.isSecureContext,
    framed: window.self !== window.top,
  };
}

export async function registerServiceWorker(
  container: ServiceWorkerContainer,
  scope: string,
  reload = () => window.location.reload(),
) {
  const registration = await container.register(`${scope}sw.js`, {
    scope,
    updateViaCache: 'none',
  });
  // The first install claims the page; only later changes of controller are updates.
  let controlled = Boolean(container.controller);
  if (registration.waiting && controlled) offerUpdate(registration.waiting);
  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    installing?.addEventListener('statechange', () => {
      if (installing.state === 'installed' && container.controller) offerUpdate(installing);
    });
  });
  container.addEventListener('controllerchange', () => {
    if (updateRequested) {
      updateRequested = false;
      reload();
    } else if (controlled) {
      // Another tab activated the new version; this page still runs the old one.
      offerUpdate(null);
    }
    controlled = true;
  });
  // A long session never navigates, so look for new deploys periodically.
  window.setInterval(() => void registration.update().catch(() => {}), UPDATE_CHECK_MS);
  return registration;
}

function afterLoad(callback: () => void) {
  // Safari before 18 has no requestIdleCallback.
  const idle = () =>
    typeof window.requestIdleCallback === 'function'
      ? window.requestIdleCallback(callback, { timeout: 5000 })
      : window.setTimeout(callback, 1000);
  if (document.readyState === 'complete') idle();
  else window.addEventListener('load', idle, { once: true });
}

/** Registers once per page after load; unregisters when the build disables it. */
export function startServiceWorker(context: RegistrationContext = currentContext()) {
  if (started) return;
  started = true;
  const action = serviceWorkerAction(context);
  if (action === 'none') return;
  const container = navigator.serviceWorker;
  const scope = serviceWorkerScope();
  if (action === 'unregister') {
    void container
      .getRegistration(scope)
      .then((registration) => registration?.unregister())
      .catch(() => {});
    return;
  }
  afterLoad(() => {
    // Offline support is an enhancement; the app works without it.
    void registerServiceWorker(container, scope).catch(() => {});
  });
}

/** Test hook: forget registration and update state. */
export function resetServiceWorkerState() {
  listeners.clear();
  updateReady = false;
  waitingWorker = null;
  updateRequested = false;
  started = false;
}
