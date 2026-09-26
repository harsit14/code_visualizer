// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerServiceWorker, resetServiceWorkerState } from '../offline/registration';
import { OfflineStatus } from './OfflineStatus';

function setOnline(online: boolean) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
  act(() => {
    window.dispatchEvent(new Event(online ? 'online' : 'offline'));
  });
}

afterEach(() => {
  cleanup();
  resetServiceWorkerState();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('OfflineStatus', () => {
  it('stays empty while online and up to date', () => {
    render(<OfflineStatus />);
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('explains what still works offline and returns after being dismissed', () => {
    render(<OfflineStatus />);
    setOnline(false);
    expect(screen.getByRole('status').textContent).toContain(
      'Offline — saved workspaces, imported traces and lessons still work; Python runs if the runtime was cached.',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss offline notice' }));
    expect(screen.getByRole('status').textContent).toBe('');

    setOnline(true);
    setOnline(false);
    expect(screen.getByRole('status').textContent).toContain('Offline —');
  });

  it('offers a waiting update and activates it on reload', async () => {
    vi.useFakeTimers({ toFake: ['setInterval'] });
    const waiting = { postMessage: vi.fn() };
    const registration = Object.assign(new EventTarget(), {
      update: vi.fn(async () => undefined),
      waiting,
    });
    const container = Object.assign(new EventTarget(), {
      controller: {},
      register: vi.fn(async () => registration),
    });
    render(<OfflineStatus />);
    await act(async () => {
      await registerServiceWorker(container as unknown as ServiceWorkerContainer, '/', vi.fn());
    });

    expect(screen.getByRole('status').textContent).toContain('Update available — reload');
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(waiting.postMessage).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull();
  });
});
