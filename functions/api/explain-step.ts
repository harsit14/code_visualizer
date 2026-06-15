import {
  DEEPSEEK_CHAT_COMPLETIONS_URL,
  DEFAULT_DEEPSEEK_MODEL,
  buildDeepSeekMessages,
  deepSeekCompletionToExplanation,
  sanitizeStepExplanationContext,
  type DeepSeekCompletionResponse,
} from '../../src/engine/deepseekShared';

type Env = {
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_MODEL?: string;
};

type PagesContext = {
  request: Request;
  env: Env;
};

const MAX_REQUEST_BYTES = 24_000;
const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
};

export async function onRequestPost({ env, request }: PagesContext): Promise<Response> {
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

  const body = await readJson(request);
  const context = isRecord(body) ? sanitizeStepExplanationContext(body.context) : null;
  if (!context) {
    return json({ error: 'Invalid explanation context.' }, 400);
  }

  // Subscription/auth checks should happen here before spending DeepSeek tokens.
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

  return json(explanation);
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
