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

type ExplainerLanguage = 'python' | 'javascript' | 'typescript';

type StepExplanationContext = {
  language: ExplainerLanguage;
  codeExcerpt: string;
  currentLine: number | null;
  currentLineText: string;
  event: 'call' | 'line' | 'return' | 'exception';
  frameName: string;
  locals: Record<string, string>;
  added: string[];
  changed: string[];
  removed: string[];
  stdout: string;
  returnValue: string | null;
  exception: string | null;
};

type DeepSeekMessage = {
  role: 'system' | 'user';
  content: string;
};

type DeepSeekCompletionResponse = {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    message?: string;
    type?: string;
  };
};

type DeepSeekStepExplanation = {
  text: string;
  model: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
};

const DEEPSEEK_CHAT_COMPLETIONS_URL = 'https://api.deepseek.com/chat/completions';
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash';
const MAX_REQUEST_BYTES = 24_000;
const MAX_CODE_CHARS = 7000;
const MAX_STDOUT_CHARS = 1200;
const MAX_FIELD_CHARS = 500;
const MAX_LOCALS = 24;
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

function buildDeepSeekMessages(context: StepExplanationContext): DeepSeekMessage[] {
  return [
    {
      role: 'system',
      content:
        'You explain one recorded code-execution step to a learner. Use the provided trace only. Keep the answer under 120 words, concrete, and beginner-friendly. Mention the active line, what changed, and why the next state makes sense. Do not invent hidden values.',
    },
    {
      role: 'user',
      content: [
        `Language: ${context.language}`,
        `Event: ${context.event}`,
        `Frame: ${context.frameName}`,
        `Current line: ${context.currentLine ?? 'unknown'}`,
        `Line text: ${context.currentLineText || '(not available)'}`,
        `Added variables: ${context.added.join(', ') || 'none'}`,
        `Changed variables: ${context.changed.join(', ') || 'none'}`,
        `Removed variables: ${context.removed.join(', ') || 'none'}`,
        `Current locals: ${JSON.stringify(context.locals)}`,
        `Return value: ${context.returnValue ?? 'none'}`,
        `Exception: ${context.exception ?? 'none'}`,
        `Stdout so far: ${context.stdout || 'none'}`,
        '',
        'Code excerpt:',
        context.codeExcerpt,
      ].join('\n'),
    },
  ];
}

function sanitizeStepExplanationContext(value: unknown): StepExplanationContext | null {
  if (!isRecord(value)) {
    return null;
  }
  const language = value.language;
  const event = value.event;
  if (!isExplainerLanguage(language) || !isTraceEvent(event)) {
    return null;
  }
  const currentLine = value.currentLine;
  if (currentLine !== null && typeof currentLine !== 'number') {
    return null;
  }

  return {
    added: sanitizeStringArray(value.added),
    changed: sanitizeStringArray(value.changed),
    codeExcerpt: clipString(value.codeExcerpt, MAX_CODE_CHARS),
    currentLine:
      typeof currentLine === 'number' && Number.isFinite(currentLine) ? currentLine : null,
    currentLineText: clipString(value.currentLineText, MAX_FIELD_CHARS),
    event,
    exception: value.exception === null ? null : clipString(value.exception, MAX_FIELD_CHARS),
    frameName: clipString(value.frameName, MAX_FIELD_CHARS),
    language,
    locals: sanitizeStringMap(value.locals),
    removed: sanitizeStringArray(value.removed),
    returnValue: value.returnValue === null ? null : clipString(value.returnValue, MAX_FIELD_CHARS),
    stdout: clipString(value.stdout, MAX_STDOUT_CHARS),
  };
}

function deepSeekCompletionToExplanation(
  payload: DeepSeekCompletionResponse | null,
  fallbackModel: string,
): DeepSeekStepExplanation | null {
  const text = payload?.choices?.[0]?.message?.content?.trim();
  if (!text) {
    return null;
  }
  return {
    model: payload?.model ?? fallbackModel,
    text,
    usage: payload?.usage
      ? {
          completionTokens: payload.usage.completion_tokens,
          promptTokens: payload.usage.prompt_tokens,
          totalTokens: payload.usage.total_tokens,
        }
      : undefined,
  };
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

function sanitizeStringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, MAX_LOCALS)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([key, item]) => [clipString(key, MAX_FIELD_CHARS), clipString(item, MAX_FIELD_CHARS)]),
  );
}

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === 'string')
    .slice(0, MAX_LOCALS)
    .map((item) => clipString(item, MAX_FIELD_CHARS));
}

function isExplainerLanguage(value: unknown): value is ExplainerLanguage {
  return value === 'python' || value === 'javascript' || value === 'typescript';
}

function isTraceEvent(value: unknown): value is StepExplanationContext['event'] {
  return value === 'call' || value === 'line' || value === 'return' || value === 'exception';
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

function clipString(value: unknown, maxChars: number): string {
  if (typeof value !== 'string') {
    return '';
  }
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n...[truncated]`;
}
