import { runnerHeaders } from './securityHeaders';
import type { AssetBinding } from '../server/types';

type RunnerEnv = { ASSETS: AssetBinding; RUNNER_APP_ORIGIN: string };
export default {
  async fetch(request: Request, env: RunnerEnv): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (
      !['GET', 'HEAD'].includes(request.method) ||
      (path !== '/runner.html' && !path.startsWith('/assets/'))
    ) {
      return new Response('Not found', { status: 404 });
    }
    let headers: Record<string, string>;
    try {
      headers = runnerHeaders(env.RUNNER_APP_ORIGIN, path === '/runner.html');
    } catch {
      return new Response('Runner app origin is not configured.', { status: 503 });
    }
    const assetRequest = new Request(request);
    assetRequest.headers.delete('Cookie');
    assetRequest.headers.delete('Authorization');
    const asset = await env.ASSETS.fetch(assetRequest);
    // Do not permit static bindings or redirects to introduce cookies or off-origin assets.
    if (asset.status >= 300 && asset.status < 400)
      return new Response('Runner asset redirect refused.', { status: 502 });
    const response = new Response(asset.body, asset);
    response.headers.delete('Set-Cookie');
    for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    return response;
  },
};
