import { describe, expect, it, vi } from 'vitest';
import runner from './worker';
const env = (fetch = vi.fn(async () => new Response('asset'))) => ({
  ASSETS: { fetch },
  RUNNER_APP_ORIGIN: 'https://app.example',
});

describe('credential-free runner deployment', () => {
  it('never routes account APIs or unexpected methods into static assets', async () => {
    const bindings = env();
    for (const path of ['/api/me', '/api/history', '/api/explain-step', '/'])
      expect(
        (await runner.fetch(new Request(`https://runner.example${path}`), bindings)).status,
      ).toBe(404);
    expect(
      (
        await runner.fetch(
          new Request('https://runner.example/runner.html', { method: 'POST' }),
          bindings,
        )
      ).status,
    ).toBe(404);
    expect(bindings.ASSETS.fetch).not.toHaveBeenCalled();
  });
  it('delivers distinct document and worker policies and strips credentials', async () => {
    const fetch = vi.fn(async (request: Request) => {
      expect(request.headers.has('Cookie')).toBe(false);
      expect(request.headers.has('Authorization')).toBe(false);
      return new Response('asset', { headers: { 'Set-Cookie': 'unexpected=1' } });
    });
    const bindings = { ASSETS: { fetch }, RUNNER_APP_ORIGIN: 'https://app.example' };
    const document = await runner.fetch(
      new Request('https://runner.example/runner.html'),
      bindings,
    );
    expect(document.headers.get('Content-Security-Policy')).toContain(
      'frame-ancestors https://app.example',
    );
    expect(document.headers.get('Content-Security-Policy')).toContain("worker-src 'self'");
    expect(document.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
    const worker = await runner.fetch(
      new Request('https://runner.example/assets/pyodideWorker.js', {
        headers: { Cookie: 'cv_session=secret', Authorization: 'Bearer secret' },
      }),
      bindings,
    );
    expect(worker.headers.has('Set-Cookie')).toBe(false);
    expect(worker.headers.get('Content-Security-Policy')).toContain("worker-src 'none'");
    expect(worker.headers.get('Content-Security-Policy')).toContain("connect-src 'self'");
  });
  it('rejects redirects and missing origin configuration', async () => {
    expect(
      (
        await runner.fetch(
          new Request('https://runner.example/assets/a.js'),
          env(vi.fn(async () => Response.redirect('https://other.example'))),
        )
      ).status,
    ).toBe(502);
    expect(
      (
        await runner.fetch(new Request('https://runner.example/runner.html'), {
          ...env(),
          RUNNER_APP_ORIGIN: '',
        })
      ).status,
    ).toBe(503);
  });
});
