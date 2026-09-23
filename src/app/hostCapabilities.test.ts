import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchHostCapabilities, resetHostCapabilities } from './hostCapabilities';

afterEach(() => {
  vi.unstubAllGlobals();
  resetHostCapabilities();
});

describe('host capabilities', () => {
  it('reads the capability endpoint once', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ accounts: true, history: true, ai: false }), {
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchHostCapabilities()).toEqual({
      accounts: true,
      history: true,
      ai: false,
      known: true,
    });
    await fetchHostCapabilities();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    [
      'an HTML app shell',
      async () => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } }),
    ],
    ['a network failure', async () => Promise.reject(new TypeError('Failed to fetch'))],
  ])('treats %s as a host without the API', async (_label, response) => {
    vi.stubGlobal('fetch', vi.fn(response));
    expect(await fetchHostCapabilities()).toEqual({
      accounts: false,
      history: false,
      ai: false,
      known: true,
    });
  });
});
