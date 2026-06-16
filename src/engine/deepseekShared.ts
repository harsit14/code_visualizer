export const DEEPSEEK_CHAT_COMPLETIONS_URL = 'https://api.deepseek.com/chat/completions';
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash';
export const DEEPSEEK_EXPLAINER_ENDPOINT = '/api/explain-step';

const MAX_CODE_CHARS = 7000;
const MAX_STDOUT_CHARS = 1200;
const MAX_FIELD_CHARS = 500;
const MAX_LOCALS = 24;

export type ExplainerLanguage = 'python' | 'javascript' | 'typescript';

export type DeepSeekStepExplanation = {
  text: string;
  model: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
};

export type StepExplanationContext = {
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
  variableChanges: string[];
  stdout: string;
  returnValue: string | null;
  exception: string | null;
};

export type DeepSeekMessage = {
  role: 'system' | 'user';
  content: string;
};

export type DeepSeekCompletionResponse = {
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

export function buildDeepSeekMessages(context: StepExplanationContext): DeepSeekMessage[] {
  return [
    {
      role: 'system',
      content:
        'You are the Code Visualizer step explainer. Explain exactly one recorded execution step to a learner using only the trace. Tie the active line to its role in the surrounding code, then explain the observed state change with concrete variable names and values. If the active line is a condition, loop, call, return, or mutation, say what that construct is doing in this run. Keep the answer under 140 words. Do not mention tokens, JSON, or that you are an AI. Do not invent hidden state.',
    },
    {
      role: 'user',
      content: [
        'Task: Explain what the active line does in this execution and why the shown state changed.',
        `Language: ${context.language}`,
        `Event: ${context.event}`,
        `Frame: ${context.frameName}`,
        `Active line: ${context.currentLine ?? 'unknown'}: ${
          context.currentLineText || '(not available)'
        }`,
        `Variable changes (before -> after): ${context.variableChanges.join('; ') || 'none'}`,
        `Added variables: ${context.added.join(', ') || 'none'}`,
        `Changed variables: ${context.changed.join(', ') || 'none'}`,
        `Removed variables: ${context.removed.join(', ') || 'none'}`,
        `Current locals after this step: ${JSON.stringify(context.locals)}`,
        `Return value: ${context.returnValue ?? 'none'}`,
        `Exception: ${context.exception ?? 'none'}`,
        `Stdout so far: ${context.stdout || 'none'}`,
        '',
        'Code excerpt (active line marked with =>):',
        formatNumberedCodeExcerpt(context.codeExcerpt, context.currentLine),
      ].join('\n'),
    },
  ];
}

export function sanitizeStepExplanationContext(value: unknown): StepExplanationContext | null {
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
    language,
    codeExcerpt: clipString(value.codeExcerpt, MAX_CODE_CHARS),
    currentLine:
      typeof currentLine === 'number' && Number.isFinite(currentLine) ? currentLine : null,
    currentLineText: clipString(value.currentLineText, MAX_FIELD_CHARS),
    event,
    frameName: clipString(value.frameName, MAX_FIELD_CHARS),
    locals: sanitizeStringMap(value.locals),
    added: sanitizeStringArray(value.added),
    changed: sanitizeStringArray(value.changed),
    removed: sanitizeStringArray(value.removed),
    variableChanges: sanitizeStringArray(value.variableChanges),
    stdout: clipString(value.stdout, MAX_STDOUT_CHARS),
    returnValue: value.returnValue === null ? null : clipString(value.returnValue, MAX_FIELD_CHARS),
    exception: value.exception === null ? null : clipString(value.exception, MAX_FIELD_CHARS),
  };
}

export function parseDeepSeekExplanationPayload(value: unknown): DeepSeekStepExplanation | null {
  if (!isRecord(value) || typeof value.text !== 'string' || typeof value.model !== 'string') {
    return null;
  }
  const usage = isRecord(value.usage)
    ? {
        completionTokens:
          typeof value.usage.completionTokens === 'number'
            ? value.usage.completionTokens
            : undefined,
        promptTokens:
          typeof value.usage.promptTokens === 'number' ? value.usage.promptTokens : undefined,
        totalTokens:
          typeof value.usage.totalTokens === 'number' ? value.usage.totalTokens : undefined,
      }
    : undefined;
  return { model: value.model, text: value.text, usage };
}

export function deepSeekCompletionToExplanation(
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

function formatNumberedCodeExcerpt(code: string, activeLine: number | null): string {
  return code
    .split(/\r?\n/)
    .map((line, index) => {
      const lineNumber = index + 1;
      const marker = activeLine === lineNumber ? '=>' : '  ';
      return `${marker} ${String(lineNumber).padStart(3, ' ')} | ${line}`;
    })
    .join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
