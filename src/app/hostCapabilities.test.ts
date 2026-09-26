import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchHostCapabilities, resetHostCapabilities } from './hostCapabilities';

afterEach(() => {
  vi.unstubAllGlobals();
  resetHostCapabilities();
});

describe('host capabilities', () => {
  it('skips the request on static hosts', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect((await fetchHostCapabilities(true)).ai).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads the capability endpoint once', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ accounts: true, history: true, ai: false }), {
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchHostCapabilities(false)).toEqual({
      accounts: true,
      history: true,
      ai: false,
      known: true,
    });
    await fetchHostCapabilities(false);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('treats an HTML app shell as a host without the API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } }),
      ),
    );
    expect(await fetchHostCapabilities(false)).toEqual({
      accounts: false,
      history: false,
      ai: false,
      known: true,
    });
  });

  it('offers nothing while the host is unreachable and asks again later', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accounts: true, history: true, ai: true }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchHostCapabilities(false)).toEqual({
      accounts: false,
      history: false,
      ai: false,
      known: false,
    });
    expect(await fetchHostCapabilities(false)).toEqual({
      accounts: true,
      history: true,
      ai: true,
      known: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
