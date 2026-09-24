import { sha256Hex } from '../../src/server/auth';
import { getDatabase } from '../../src/server/database';
import { reserveExplainerUsage } from '../../src/server/usage';
import type { ServerEnv } from '../../src/server/types';

type Env = {
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_MODEL?: string;
} & ServerEnv;

type PagesContext = {
  request: Request;
  env: Env;
};

import {
  buildDeepSeekMessages,
  sanitizeStepExplanationContext,
  deepSeekCompletionToExplanation,
  DEEPSEEK_CHAT_COMPLETIONS_URL,
  DEFAULT_DEEPSEEK_MODEL,
  type DeepSeekCompletionResponse,
} from '../../src/engine/deepseekShared';
import {
  readLimitedJson,
  isRequestBodyTooLargeError,
  rejectUntrustedBrowserRequest,
} from '../../src/server/http';

const MAX_REQUEST_BYTES = 24_000;
const PROVIDER_TIMEOUT_MS = 20_000;
const CACHE_DAYS = 30;
const JSON_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Code-Visualizer-Function': 'explain-step',
};

export async function onRequestPost(context: PagesContext): Promise<Response> {
  try {
    return await handlePost(context);
  } catch (error) {
    // Logged without the request body so source and variables stay out of logs.
    console.error('AI explainer route failed', error instanceof Error ? error.name : 'unknown');
    return json({ error: 'The AI explainer failed unexpectedly. Try again later.' }, 500);
  }
}

async function handlePost({ env, request }: PagesContext): Promise<Response> {
  const crossOrigin = rejectUntrustedBrowserRequest(request);
  if (crossOrigin) return crossOrigin;
  const apiKey = env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    return json({ error: 'AI explainer is not configured.' }, 503);
  }

  if (!request.headers.get('Content-Type')?.includes('application/json')) {
    return json({ error: 'Expected application/json.' }, 415);
  }

  const contentLength = Number(request.headers.get('Content-Length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return json({ error: 'Explanation request is too large.' }, 413);
  }

  let body: unknown;
  try {
    body = await readLimitedJson(request, MAX_REQUEST_BYTES);
  } catch (error) {
    if (isRequestBodyTooLargeError(error))
      return json({ error: 'Explanation request is too large.' }, 413);
    throw error;
  }
  const context = isRecord(body) ? sanitizeStepExplanationContext(body.context) : null;
  if (!context) {
    return json({ error: 'Invalid explanation context.' }, 400);
  }

  const model = env.DEEPSEEK_MODEL?.trim() || DEFAULT_DEEPSEEK_MODEL;
  const contextHash = await sha256Hex(JSON.stringify({ model, context }));
  const cached = await readCachedExplanation(env, contextHash);
  if (cached) {
    // An identical request was already answered: no provider call, no quota.
    return json({ ...cached, cached: true });
  }

  const quota = await reserveExplainerUsage(env, request);
  if (!quota.ok) {
    return quota.response;
  }

  let deepSeekResponse: Response;
  try {
    deepSeekResponse = await fetch(DEEPSEEK_CHAT_COMPLETIONS_URL, {
      body: JSON.stringify({
        max_tokens: 360,
        messages: buildDeepSeekMessages(context),
        model,
        stream: false,
        temperature: 0.2,
        thinking: { type: 'disabled' },
      }),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch (error) {
    await quota.refund();
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    return json(
      {
        error: timedOut
          ? 'The AI service took too long to answer. No explanation was used from your quota; try again.'
          : 'Could not reach the AI service. No explanation was used from your quota; try again.',
      },
      timedOut ? 504 : 502,
    );
  }

  const payload = await readJson(deepSeekResponse);
  const explanation = deepSeekResponse.ok
    ? deepSeekCompletionToExplanation(payload as DeepSeekCompletionResponse | null, model)
    : null;
  if (!explanation) {
    await quota.refund();
    return json(
      {
        error:
          'The AI service could not answer this step right now. No explanation was used from your quota.',
      },
      502,
    );
  }

  await writeCachedExplanation(env, contextHash, explanation.model, explanation.text);
  return json({ ...explanation, cached: false }, 200, quota.headers);
}

async function readCachedExplanation(
  env: Env,
  contextHash: string,
): Promise<{ model: string; text: string } | null> {
  try {
    const since = new Date(Date.now() - CACHE_DAYS * 86_400_000).toISOString();
    const row = await getDatabase(env)?.getCachedExplanation(contextHash, since);
    return row ? { model: row.model, text: row.answer } : null;
  } catch {
    // The cache is optional (migration 0003); fall through to a normal request.
    return null;
  }
}

async function writeCachedExplanation(env: Env, contextHash: string, model: string, text: string) {
  try {
    await getDatabase(env)?.putCachedExplanation({
      answer: text.slice(0, 8000),
      context_hash: contextHash,
      created_at: new Date().toISOString(),
      model: model.slice(0, 120),
    });
  } catch {
    // Caching is best effort.
  }
}

export function onRequestOptions(): Response {
  return new Response(null, {
    headers: {
      ...JSON_HEADERS,
      Allow: 'POST, OPTIONS',
    },
    status: 204,
  });
}

export function onRequest(): Response {
  return json({ error: 'Method not allowed.' }, 405, {
    Allow: 'POST, OPTIONS',
  });
}

function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    headers: { ...JSON_HEADERS, ...headers },
    status,
  });
}

async function readJson(request: Request | Response): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
