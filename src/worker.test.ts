import { describe, expect, it, vi } from 'vitest';
import worker from './worker';

describe('worker', () => {
  it('handles the explainer API before static assets', async () => {
    const assetsFetch = vi.fn(async () => new Response('asset'));
    const response = await worker.fetch(new Request('https://example.com/api/explain-step'), {
      ASSETS: { fetch: assetsFetch },
    });

    expect(response.status).toBe(405);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(await response.json()).toEqual({ error: 'Method not allowed.' });
    expect(assetsFetch).not.toHaveBeenCalled();
  });

  it('serves non-api routes from static assets', async () => {
    const assetsFetch = vi.fn(async () => new Response('asset'));
    const response = await worker.fetch(new Request('https://example.com/'), {
      ASSETS: { fetch: assetsFetch },
    });

    expect(await response.text()).toBe('asset');
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
    expect(response.headers.get('Strict-Transport-Security')).toBe(
      'max-age=31536000; includeSubDomains',
    );
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(assetsFetch).toHaveBeenCalledTimes(1);
  });

  it('serves account API routes before static assets', async () => {
    const assetsFetch = vi.fn(async () => new Response('asset'));
    const response = await worker.fetch(new Request('https://example.com/api/me'), {
      ASSETS: { fetch: assetsFetch },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      accountConfigured: false,
      user: null,
    });
    expect(assetsFetch).not.toHaveBeenCalled();
  });

  it('serves history API routes before static assets', async () => {
    const assetsFetch = vi.fn(async () => new Response('asset'));
    const response = await worker.fetch(new Request('https://example.com/api/history'), {
      ASSETS: { fetch: assetsFetch },
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('Account database is not configured'),
    });
    expect(assetsFetch).not.toHaveBeenCalled();
  });
});
