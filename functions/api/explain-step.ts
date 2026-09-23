import { enforceExplainerUsage } from '../../src/server/usage';
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
const JSON_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Code-Visualizer-Function': 'explain-step',
};

export async function onRequestPost(context: PagesContext): Promise<Response> {
  try {
    return await handlePost(context);
  } catch (error) {
    console.error('AI explainer route crashed', error);
    return json({ error: runtimeErrorMessage(error) }, 500);
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

  const quota = await enforceExplainerUsage(env, request);
  if (!quota.ok) {
    return quota.response;
  }

  const model = env.DEEPSEEK_MODEL?.trim() || DEFAULT_DEEPSEEK_MODEL;
  const deepSeekResponse = await fetch(DEEPSEEK_CHAT_COMPLETIONS_URL, {
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
    signal: AbortSignal.timeout(20_000),
  });

  const payload = await readJson(deepSeekResponse);
  if (!deepSeekResponse.ok) {
    const detail =
      isDeepSeekError(payload) && payload.error.message
        ? payload.error.message
        : deepSeekResponse.statusText;
    return json({ error: `DeepSeek request failed: ${detail}` }, 502);
  }

  const explanation = deepSeekCompletionToExplanation(
    payload as DeepSeekCompletionResponse | null,
    model,
  );
  if (!explanation) {
    return json({ error: 'DeepSeek returned an empty explanation.' }, 502);
  }

  return json(explanation, 200, quota.headers);
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

function isDeepSeekError(value: unknown): value is { error: { message?: string } } {
  return (
    isRecord(value) &&
    isRecord(value.error) &&
    (typeof value.error.message === 'string' || value.error.message === undefined)
  );
}

function runtimeErrorMessage(error: unknown): string {
  return error instanceof Error
    ? `AI explainer crashed before returning JSON: ${error.message}`
    : 'AI explainer crashed before returning JSON.';
}
