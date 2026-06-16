import { onRequest, onRequestOptions, onRequestPost } from '../functions/api/explain-step';
import { handleAccountApi } from './server/accountApi';
import type { ServerEnv } from './server/types';

const JSON_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Code-Visualizer-Function': 'worker-api',
};
const STATIC_SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
};

export default {
  async fetch(request: Request, env: ServerEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/explain-step') {
      if (request.method === 'POST') {
        return onRequestPost({ env, request });
      }
      if (request.method === 'OPTIONS') {
        return onRequestOptions();
      }
      return onRequest();
    }

    if (url.pathname.startsWith('/api/')) {
      const apiResponse = await handleAccountApi(request, env);
      if (apiResponse) {
        return apiResponse;
      }
      return new Response(JSON.stringify({ error: 'API route not found.' }), {
        headers: JSON_HEADERS,
        status: 404,
      });
    }

    if (!env.ASSETS) {
      return new Response('Static assets are not configured.', { status: 503 });
    }
    return withStaticSecurityHeaders(await env.ASSETS.fetch(request));
  },
};

function withStaticSecurityHeaders(response: Response): Response {
  const secured = new Response(response.body, response);
  Object.entries(STATIC_SECURITY_HEADERS).forEach(([header, value]) => {
    secured.headers.set(header, value);
  });
  return secured;
}
