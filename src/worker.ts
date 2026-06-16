import { onRequest, onRequestOptions, onRequestPost } from '../functions/api/explain-step';
import { handleAccountApi } from './server/accountApi';
import type { ServerEnv } from './server/types';

const JSON_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Code-Visualizer-Function': 'worker-api',
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
    return env.ASSETS.fetch(request);
  },
};
