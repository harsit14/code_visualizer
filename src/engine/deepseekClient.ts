import {
  DEEPSEEK_EXPLAINER_ENDPOINT,
  DEFAULT_DEEPSEEK_MODEL,
  type DeepSeekStepExplanation,
  type StepExplanationContext,
  parseDeepSeekExplanationPayload,
} from './deepseekShared';
import { diffLocals, expandSelf, formatValue, stdoutAtStep, typeNameOf } from './trace';
import { effectiveFrame } from './traceNavigation';
import type { EncodedValue, Language, SessionResult, TraceStep } from './types';

const MAX_CODE_CHARS = 7000;
const MAX_STDOUT_CHARS = 1200;
const MAX_LOCALS = 24;
const MAX_VALUE_CHARS = 300;
const EXCERPT_RADIUS = 12;

/** What the learner allows the AI request to include. */
export type ExplanationPrivacy = {
  /** Code around the active line; when off only the active line is sent. */
  includeCode: boolean;
  /** Variable, return and change values; when off only names and types are sent. */
  includeValues: boolean;
  /** Recent printed output. */
  includeOutput: boolean;
};

export const DEFAULT_EXPLANATION_PRIVACY: ExplanationPrivacy = {
  includeCode: true,
  includeValues: true,
  includeOutput: true,
};

type ExplainStepOptions = {
  code: string;
  language: Language;
  currentStep: TraceStep | undefined;
  previousStep: TraceStep | undefined;
  frameIndex: number | null;
  result: SessionResult | null;
  endpoint?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  privacy?: ExplanationPrivacy;
};

type ExplainerErrorPayload = {
  error?: string;
};

type ParsedResponse = {
  contentType: string;
  payload: unknown;
  text: string;
};

export type { DeepSeekStepExplanation, StepExplanationContext };
export { DEFAULT_DEEPSEEK_MODEL, DEEPSEEK_EXPLAINER_ENDPOINT };

/**
 * Lines around the active line, shrunk from the far ends until they fit, so the
 * active line is always included.
 */
function excerptAround(lines: string[], activeIndex: number): { start: number; text: string } {
  let start = Math.max(0, activeIndex - EXCERPT_RADIUS);
  let end = Math.min(lines.length, activeIndex + EXCERPT_RADIUS + 1);
  const size = () => lines.slice(start, end).join('\n').length;
  while (size() > MAX_CODE_CHARS && end - start > 1) {
    if (activeIndex - start >= end - 1 - activeIndex && start < activeIndex) start += 1;
    else if (end - 1 > activeIndex) end -= 1;
    else start += 1;
  }
  return { start, text: clipText(lines.slice(start, end).join('\n'), MAX_CODE_CHARS) };
}

export function buildStepExplanationContext(
  {
    code,
    currentStep,
    frameIndex,
    language,
    previousStep,
    result,
  }: Omit<ExplainStepOptions, 'endpoint' | 'fetchImpl' | 'signal' | 'privacy'>,
  privacy: ExplanationPrivacy = DEFAULT_EXPLANATION_PRIVACY,
): StepExplanationContext | null {
  if (!currentStep) {
    return null;
  }
  const frame = effectiveFrame(currentStep, frameIndex);
  const previousFrame = previousStep?.stack.find((candidate) => candidate.id === frame?.id);
  const locals = frame ? expandSelf(frame.locals) : {};
  const previousLocals = previousFrame ? expandSelf(previousFrame.locals) : undefined;
  const diff = diffLocals(previousLocals, locals);
  const formattedLocals = formatLocals(locals, privacy.includeValues);
  const formattedPreviousLocals = previousLocals
    ? formatLocals(previousLocals, privacy.includeValues)
    : {};

  const codeLines = code.split(/\r?\n/);
  const currentLineText = currentStep.line > 0 ? (codeLines[currentStep.line - 1] ?? '') : '';
  const exception = currentStep.exc ?? result?.run?.exception ?? result?.error ?? null;
  const stdout = result?.run ? stdoutAtStep(result.run.stdout, currentStep) : '';
  const excerpt = privacy.includeCode
    ? excerptAround(codeLines, Math.max(0, currentStep.line - 1))
    : { start: Math.max(0, currentStep.line - 1), text: currentLineText };

  return {
    language,
    statePhase:
      currentStep.phase ??
      (currentStep.event === 'line' ? (language === 'python' ? 'before' : 'after') : 'event'),
    codeStartLine: excerpt.start + 1,
    codeExcerpt: excerpt.text,
    currentLine: currentStep.line > 0 ? currentStep.line : null,
    currentLineText: currentLineText.trim(),
    event: currentStep.event,
    frameName: frame?.func ?? currentStep.func,
    locals: formattedLocals,
    added: [...diff.added].sort(),
    changed: [...diff.changed].sort(),
    removed: [...diff.removed].sort(),
    variableChanges: describeLocalChanges(
      diff,
      formattedPreviousLocals,
      formattedLocals,
      privacy.includeValues,
    ),
    // The most recent output is the most relevant to this step.
    stdout: privacy.includeOutput ? clipTail(stdout, MAX_STDOUT_CHARS) : '',
    returnValue: currentStep.ret
      ? privacy.includeValues
        ? clipText(formatValue(currentStep.ret), MAX_VALUE_CHARS)
        : `<${typeNameOf(currentStep.ret)}>`
      : null,
    exception: exception ? `${exception.type}: ${exception.msg}` : null,
  };
}

export async function explainStepWithDeepSeek({
  code,
  currentStep,
  endpoint = DEEPSEEK_EXPLAINER_ENDPOINT,
  fetchImpl = fetch,
  frameIndex,
  language,
  previousStep,
  result,
  signal,
  privacy = DEFAULT_EXPLANATION_PRIVACY,
}: ExplainStepOptions): Promise<DeepSeekStepExplanation> {
  const context = buildStepExplanationContext(
    {
      code,
      currentStep,
      frameIndex,
      language,
      previousStep,
      result,
    },
    privacy,
  );
  if (!context) {
    throw new Error('Run code and select a step before requesting an explanation.');
  }

  const response = await fetchImpl(endpoint, {
    body: JSON.stringify({ context }),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
    signal,
  });

  const parsed = await parseResponse(response);

  if (!response.ok) {
    throw new Error(explainerErrorMessage(response, parsed));
  }

  if (!parsed.contentType.includes('application/json')) {
    throw new Error(nonJsonResponseMessage(parsed));
  }

  const explanation = parseDeepSeekExplanationPayload(parsed.payload);
  if (!explanation) {
    throw new Error('The explainer service returned an invalid response.');
  }
  return explanation;
}

async function parseResponse(response: Response): Promise<ParsedResponse> {
  const contentType = response.headers.get('Content-Type')?.toLowerCase() ?? '';
  const text = await response.text();
  if (!contentType.includes('application/json')) {
    return { contentType, payload: null, text };
  }
  try {
    return { contentType, payload: JSON.parse(text) as unknown, text };
  } catch {
    return { contentType, payload: null, text };
  }
}

function explainerErrorMessage(response: Response, parsed: ParsedResponse): string {
  const detail = isExplainerErrorPayload(parsed.payload)
    ? parsed.payload.error
    : response.statusText;
  if (response.status === 404) {
    return 'AI explainer service is not available on this host. Deploy with Cloudflare Pages Functions or run locally with wrangler pages dev.';
  }
  if (!parsed.contentType.includes('application/json')) {
    return nonJsonResponseMessage(parsed);
  }
  return detail
    ? `AI explainer request failed (${response.status}): ${detail}`
    : `AI explainer request failed (${response.status}).`;
}

function nonJsonResponseMessage(parsed: ParsedResponse): string {
  if (looksLikeAppShell(parsed.text)) {
    return 'AI explainer route is serving the app shell instead of the Cloudflare Function. Check that the latest GitHub commit deployed, the project root is the repo root, and /api/* is included in _routes.json.';
  }
  return 'AI explainer route returned a non-JSON response. Check the Cloudflare Pages Function logs for /api/explain-step.';
}

function looksLikeAppShell(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return normalized.startsWith('<!doctype html') || normalized.includes('<div id="root">');
}

function isExplainerErrorPayload(value: unknown): value is ExplainerErrorPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    (typeof value.error === 'string' || value.error === undefined)
  );
}

function formatLocals(
  locals: Record<string, EncodedValue>,
  includeValues: boolean,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(locals)
      .slice(0, MAX_LOCALS)
      .map(([name, value]) => [
        name,
        includeValues ? clipText(formatValue(value), MAX_VALUE_CHARS) : `<${typeNameOf(value)}>`,
      ]),
  );
}

function describeLocalChanges(
  diff: ReturnType<typeof diffLocals>,
  previousLocals: Record<string, string>,
  currentLocals: Record<string, string>,
  includeValues: boolean,
): string[] {
  return [...new Set([...diff.added, ...diff.changed, ...diff.removed])]
    .sort()
    .slice(0, MAX_LOCALS)
    .map((name) => {
      if (!includeValues) {
        return `${name}: ${diff.added.has(name) ? 'created' : diff.removed.has(name) ? 'removed' : 'changed'}`;
      }
      if (diff.added.has(name)) {
        return `${name}: created as ${currentLocals[name] ?? '(unknown)'}`;
      }
      if (diff.removed.has(name)) {
        return `${name}: removed (was ${previousLocals[name] ?? '(unknown)'})`;
      }
      return `${name}: ${previousLocals[name] ?? '(unknown)'} -> ${
        currentLocals[name] ?? '(unknown)'
      }`;
    });
}

function clipText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n...[truncated]`;
}

function clipTail(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `[earlier output truncated]...\n${text.slice(text.length - maxChars)}`;
}
