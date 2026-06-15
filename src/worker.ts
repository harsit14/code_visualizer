import { onRequest, onRequestOptions, onRequestPost } from '../functions/api/explain-step';

type AssetBinding = {
  fetch(request: Request): Promise<Response>;
};

type Env = {
  ASSETS: AssetBinding;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_MODEL?: string;
};

const JSON_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Code-Visualizer-Function': 'worker-api',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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
      return new Response(JSON.stringify({ error: 'API route not found.' }), {
        headers: JSON_HEADERS,
        status: 404,
      });
    }

    return env.ASSETS.fetch(request);
  },
};
