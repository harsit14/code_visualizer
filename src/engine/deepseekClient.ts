import {
  DEEPSEEK_EXPLAINER_ENDPOINT,
  DEFAULT_DEEPSEEK_MODEL,
  type DeepSeekStepExplanation,
  type StepExplanationContext,
  parseDeepSeekExplanationPayload,
} from './deepseekShared';
import { diffLocals, expandSelf, formatValue, stdoutAtStep } from './trace';
import { effectiveFrame } from './traceNavigation';
import type { EncodedValue, Language, SessionResult, TraceStep } from './types';

const MAX_CODE_CHARS = 7000;
const MAX_STDOUT_CHARS = 1200;
const MAX_LOCALS = 24;

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
};

type ExplainerErrorPayload = {
  error?: string;
};

export type { DeepSeekStepExplanation, StepExplanationContext };
export { DEFAULT_DEEPSEEK_MODEL, DEEPSEEK_EXPLAINER_ENDPOINT };

export function buildStepExplanationContext({
  code,
  currentStep,
  frameIndex,
  language,
  previousStep,
  result,
}: Omit<ExplainStepOptions, 'endpoint' | 'fetchImpl' | 'signal'>): StepExplanationContext | null {
  if (!currentStep) {
    return null;
  }
  const frame = effectiveFrame(currentStep, frameIndex);
  const previousFrame = previousStep?.stack.find((candidate) => candidate.id === frame?.id);
  const locals = frame ? expandSelf(frame.locals) : {};
  const previousLocals = previousFrame ? expandSelf(previousFrame.locals) : undefined;
  const diff = diffLocals(previousLocals, locals);

  const currentLineText =
    currentStep.line > 0 ? (code.split(/\r?\n/)[currentStep.line - 1] ?? '') : '';
  const exception = currentStep.exc ?? result?.run?.exception ?? result?.error ?? null;
  const stdout = result?.run ? stdoutAtStep(result.run.stdout, currentStep) : '';

  return {
    language,
    codeExcerpt: clipText(code, MAX_CODE_CHARS),
    currentLine: currentStep.line > 0 ? currentStep.line : null,
    currentLineText: currentLineText.trim(),
    event: currentStep.event,
    frameName: frame?.func ?? currentStep.func,
    locals: formatLocals(locals),
    added: [...diff.added].sort(),
    changed: [...diff.changed].sort(),
    removed: [...diff.removed].sort(),
    stdout: clipText(stdout, MAX_STDOUT_CHARS),
    returnValue: currentStep.ret ? formatValue(currentStep.ret) : null,
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
}: ExplainStepOptions): Promise<DeepSeekStepExplanation> {
  const context = buildStepExplanationContext({
    code,
    currentStep,
    frameIndex,
    language,
    previousStep,
    result,
  });
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

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(explainerErrorMessage(response, payload));
  }

  const explanation = parseDeepSeekExplanationPayload(payload);
  if (!explanation) {
    throw new Error('The explainer service returned an invalid response.');
  }
  return explanation;
}

function explainerErrorMessage(response: Response, payload: unknown): string {
  const detail = isExplainerErrorPayload(payload) ? payload.error : response.statusText;
  if (response.status === 404) {
    return 'AI explainer service is not available on this host. Deploy with Cloudflare Pages Functions or run locally with wrangler pages dev.';
  }
  return detail
    ? `AI explainer request failed (${response.status}): ${detail}`
    : `AI explainer request failed (${response.status}).`;
}

function isExplainerErrorPayload(value: unknown): value is ExplainerErrorPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    (typeof value.error === 'string' || value.error === undefined)
  );
}

function formatLocals(locals: Record<string, EncodedValue>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(locals)
      .slice(0, MAX_LOCALS)
      .map(([name, value]) => [name, formatValue(value)]),
  );
}

function clipText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n...[truncated]`;
}
