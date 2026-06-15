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
    expect(assetsFetch).toHaveBeenCalledTimes(1);
  });
});
