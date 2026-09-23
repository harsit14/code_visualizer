import { validateSessionResult } from '../engine/resultSchema';
import type { Language, SessionResult } from '../engine/types';

export const MAX_TRACE_FILE_BYTES = 20 * 1024 * 1024;
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string';
const integer = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const optional = (v: unknown, check: (item: unknown) => boolean) => v === undefined || check(v);
const oneOf = (v: unknown, values: readonly unknown[]) => values.includes(v);

/** Validate all replay-consumed fields before changing any application state. */
export function parseTraceImport(text: string): {
  code: string;
  language: Language;
  result: SessionResult;
  step: number;
} {
  if (new TextEncoder().encode(text).length > MAX_TRACE_FILE_BYTES) {
    throw new Error('Trace files must be no larger than 20 MB.');
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('Selected file is not valid JSON.');
  }
  if (!record(payload) || !oneOf(payload.version, [1, 2])) {
    throw new Error('Unsupported trace version. Import a version 1 or 2 Code Visualizer export.');
  }
  if (
    !str(payload.code) ||
    payload.code.length > 200_000 ||
    !optional(payload.language, (l) => oneOf(l, ['python', 'javascript', 'typescript'])) ||
    !optional(payload.step, integer)
  )
    throw new Error('Invalid trace source, language or position.');
  const result = validateSessionResult(payload.result, (payload.language ?? 'python') as Language);
  const run = result.run;
  return {
    code: payload.code,
    language: (payload.language ?? 'python') as Language,
    result: result as SessionResult,
    step: Math.min(
      (payload.step as number | undefined) ?? 0,
      record(run) && Array.isArray(run.steps) ? Math.max(0, run.steps.length - 1) : 0,
    ),
  };
}
