// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isSkipWaitingMessage } from './cachePolicy';
import {
  applyUpdate,
  prefersSavingData,
  registerServiceWorker,
  resetServiceWorkerState,
  serviceWorkerAction,
  serviceWorkerScope,
  startServiceWorker,
  useUpdateReady,
  type RegistrationContext,
} from './registration';

class FakeWorker extends EventTarget {
  state = 'installing';
  postMessage = vi.fn();
  install() {
    this.state = 'installed';
    this.dispatchEvent(new Event('statechange'));
  }
}

class FakeRegistration extends EventTarget {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  update = vi.fn(async () => undefined);
  unregister = vi.fn(async () => true);
}

class FakeContainer extends EventTarget {
  controller: object | null = null;
  registration = new FakeRegistration();
  register = vi.fn(async () => this.registration);
  getRegistration = vi.fn(async () => this.registration);
}

const production: RegistrationContext = {
  production: true,
  enabled: true,
  supported: true,
  secure: true,
  framed: false,
};

async function registerWith(container: FakeContainer) {
  const reload = vi.fn();
  await act(async () => {
    await registerServiceWorker(container as unknown as ServiceWorkerContainer, '/', reload);
  });
  return reload;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  resetServiceWorkerState();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('when to register', () => {
  it('registers only production app pages outside frames', () => {
    expect(serviceWorkerAction(production)).toBe('register');
    expect(serviceWorkerAction({ ...production, production: false })).toBe('none');
    expect(serviceWorkerAction({ ...production, supported: false })).toBe('none');
    expect(serviceWorkerAction({ ...production, secure: false })).toBe('none');
    expect(serviceWorkerAction({ ...production, framed: true })).toBe('none');
  });

  it('removes an installed worker when the build disables it', async () => {
    const container = new FakeContainer();
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container });
    startServiceWorker({ ...production, enabled: false });
    await vi.waitFor(() => expect(container.registration.unregister).toHaveBeenCalled());
    expect(container.getRegistration).toHaveBeenCalledWith('/');
    expect(container.register).not.toHaveBeenCalled();
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });

  it('waits for intent on data saver or 2G', () => {
    expect(prefersSavingData({ saveData: true, effectiveType: '4g' })).toBe(true);
    expect(prefersSavingData({ effectiveType: 'slow-2g' })).toBe(true);
    expect(prefersSavingData({ effectiveType: '4g' })).toBe(false);
    expect(prefersSavingData(undefined)).toBe(false);
  });

  it('scopes the worker to the base path', () => {
    expect(serviceWorkerScope('/code_visualizer/')).toBe('/code_visualizer/');
    expect(serviceWorkerScope('/code_visualizer')).toBe('/code_visualizer/');
  });
});

describe('updates', () => {
  it('registers sw.js under the scope without the HTTP cache', async () => {
    const container = new FakeContainer();
    await registerServiceWorker(
      container as unknown as ServiceWorkerContainer,
      '/code_visualizer/',
    );
    expect(container.register).toHaveBeenCalledWith('/code_visualizer/sw.js', {
      scope: '/code_visualizer/',
      updateViaCache: 'none',
    });
  });

  it('does not offer an update or reload when the first install claims the page', async () => {
    const container = new FakeContainer();
    const { result } = renderHook(useUpdateReady);
    const reload = await registerWith(container);
    act(() => {
      container.controller = {};
      container.dispatchEvent(new Event('controllerchange'));
    });
    expect(result.current).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('offers a waiting version and reloads only after it takes over', async () => {
    const container = new FakeContainer();
    container.controller = {};
    const waiting = new FakeWorker();
    container.registration.waiting = waiting;
    const { result } = renderHook(useUpdateReady);
    const reload = await registerWith(container);
    expect(result.current).toBe(true);

    applyUpdate(reload);
    expect(isSkipWaitingMessage(waiting.postMessage.mock.calls[0][0])).toBe(true);
    expect(reload).not.toHaveBeenCalled();
    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledOnce();
  });

  it('offers a version found while the page is open', async () => {
    const container = new FakeContainer();
    container.controller = {};
    const { result } = renderHook(useUpdateReady);
    await registerWith(container);
    const installing = new FakeWorker();
    container.registration.installing = installing;
    act(() => {
      container.registration.dispatchEvent(new Event('updatefound'));
      installing.install();
    });
    expect(result.current).toBe(true);
  });

  it('asks for a reload when another tab activated the new version', async () => {
    const container = new FakeContainer();
    container.controller = {};
    const { result } = renderHook(useUpdateReady);
    const reload = await registerWith(container);
    act(() => {
      container.dispatchEvent(new Event('controllerchange'));
    });
    expect(result.current).toBe(true);
    expect(reload).not.toHaveBeenCalled();
    applyUpdate(reload);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('checks for new deploys during long sessions', async () => {
    const container = new FakeContainer();
    await registerWith(container);
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(container.registration.update).toHaveBeenCalledOnce();
  });
});
