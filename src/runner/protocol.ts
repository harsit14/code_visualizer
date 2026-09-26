import {
  COMPLEXITY_AXES,
  isAnalysisInfo,
  isComplexityResult,
  isEngineError,
  validateSessionResult,
} from '../engine/resultSchema';
import type { EngineRequest, Language, WorkerOutbound } from '../engine/types';

export const RUNNER_PROTOCOL = 1;
export const MAX_MESSAGE_CHARS = 20 * 1024 * 1024;
export const MAX_SOURCE_CHARS = 200_000;
export type RunnerLanguage = Language;
export type RequestKind = EngineRequest['op'];
export const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const optional = (v: unknown, check: (v: unknown) => boolean) => v === undefined || check(v);
export const isLanguage = (v: unknown): v is Language =>
  v === 'python' || v === 'javascript' || v === 'typescript';

export function runnerUrl(raw: string, appOrigin?: string): URL {
  const url = new URL(raw);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/runner.html' ||
    url.origin === appOrigin
  ) {
    throw new Error(
      'Runner URL must use a separate HTTPS origin and end in /runner.html (HTTP is allowed on localhost).',
    );
  }
  return url;
}
export function appOrigin(raw: string): string {
  const url = new URL(raw);
  if (
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  )
    throw new Error('Configure an exact HTTPS app origin (HTTP is allowed on localhost).');
  return url.origin;
}
export function parseMessage(raw: unknown): Record<string, unknown> {
  if (!text(raw, MAX_MESSAGE_CHARS))
    throw new Error('Runner message exceeds its size limit or is not JSON text.');
  const parsed: unknown = JSON.parse(raw);
  if (!record(parsed)) throw new Error('Invalid runner message.');
  return parsed;
}
export function validateRequest(value: unknown, language: Language): RequestKind {
  if (!record(value)) throw new Error('Invalid runner request.');
  if (language !== 'python') {
    if (value.language !== language || !text(value.source, MAX_SOURCE_CHARS))
      throw new Error('Invalid JavaScript request.');
    return 'run';
  }
  if (value.type === 'prewarm') return 'analyze';
  if (value.type !== 'request' || !text(value.requestId, 128) || !record(value.request))
    throw new Error('Invalid Python request.');
  const request = value.request;
  if (
    !['run', 'analyze', 'complexity'].includes(String(request.op)) ||
    !text(request.source, MAX_SOURCE_CHARS)
  )
    throw new Error('Invalid operation or source.');
  if (!optional(request.function, (v) => text(v, 500)) || !optional(request.seed, finite))
    throw new Error('Invalid function or seed.');
  if (
    request.op === 'complexity' &&
    (!optional(request.param, (v) => text(v, 500)) ||
      !optional(request.axis, (v) => COMPLEXITY_AXES.some((axis) => axis === v)) ||
      !optional(
        request.sizes,
        (v) =>
          Array.isArray(v) &&
          v.length <= 10 &&
          v.every((size) => finite(size) && Number.isInteger(size) && size >= 1 && size <= 4096),
      ) ||
      !optional(
        request.inputs,
        (v) => Array.isArray(v) && v.length <= 100 && v.every((i) => text(i, 10_000)),
      ))
  )
    throw new Error('Invalid complexity options.');
  if (request.options !== undefined) {
    const o = request.options;
    if (
      !record(o) ||
      !optional(o.mode, (v) => v === 'script' || v === 'function') ||
      !optional(o.function, (v) => text(v, 500)) ||
      !optional(o.expected, (v) => text(v, 10_000)) ||
      !optional(
        o.inputs,
        (v) => Array.isArray(v) && v.length <= 100 && v.every((i) => text(i, 10_000)),
      ) ||
      !optional(o.seed, finite) ||
      !optional(o.maxSteps, (v) => finite(v) && Number.isInteger(v) && v > 0 && v <= 10_000) ||
      !optional(o.maxSeconds, (v) => finite(v) && v > 0 && v <= 30)
    )
      throw new Error('Invalid runner options.');
  }
  return request.op as RequestKind;
}
export function validateResponse(value: unknown, language: Language, op: RequestKind): unknown {
  if (language !== 'python') return validateSessionResult(value, language);
  if (!record(value)) throw new Error('Invalid worker envelope.');
  if (value.type === 'runtime-error') {
    if (!text(value.message, 2000)) throw new Error('Invalid runtime error.');
    return value;
  }
  if (value.type === 'status') {
    const s = value.status;
    if (
      !record(s) ||
      !['idle', 'loading', 'ready', 'running', 'interrupting', 'restarting', 'error'].includes(
        String(s.phase),
      ) ||
      !text(s.message, 2000) ||
      typeof s.interruptSupported !== 'boolean' ||
      !optional(s.progress, (v) => finite(v) && v >= 0 && v <= 1) ||
      !optional(s.stage, (v) =>
        [
          'idle',
          'runtime-loading',
          'engine-preparing',
          'analyzing',
          'instrumenting',
          'trace-generating',
          'executing',
          'ready',
          'interrupting',
          'restarting',
          'error',
        ].includes(String(v)),
      )
    )
      throw new Error('Invalid runner status.');
    return value as WorkerOutbound;
  }
  if (
    value.type !== 'response' ||
    !text(value.requestId, 128) ||
    !finite(value.durationMs) ||
    !record(value.data)
  )
    throw new Error('Invalid worker response.');
  const data = value.data;
  // Worker boot/dispatch failures have only an error. Normalize run failures.
  if (
    data.error &&
    isEngineError(data.error) &&
    data.status === undefined &&
    data.samples === undefined &&
    data.analysis === undefined
  ) {
    if (op === 'run')
      value.data = {
        status: 'error',
        mode: 'empty',
        analysis: null,
        run: null,
        error: data.error,
        durationMs: value.durationMs,
      };
    else if (op === 'complexity')
      value.data = { functionName: null, seed: null, samples: [], error: data.error };
    return value;
  }
  if (op === 'run') value.data = validateSessionResult(data, language);
  else if (op === 'analyze') {
    if (!isAnalysisInfo(data.analysis)) throw new Error('Invalid analysis response.');
  } else if (!isComplexityResult(data)) throw new Error('Invalid complexity response.');
  return value;
}
