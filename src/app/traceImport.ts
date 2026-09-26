import { validateSessionResult } from '../engine/resultSchema';
import { MAX_CHECKPOINTS, normalizeCheckpoints } from '../engine/traceCheckpoints';
import { normalizeBookmarks, type TraceBookmark } from '../engine/traceSearch';
import type { Language, SessionResult } from '../engine/types';

export const MAX_TRACE_FILE_BYTES = 20 * 1024 * 1024;
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string';
const integer = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const optional = (v: unknown, check: (item: unknown) => boolean) => v === undefined || check(v);
const oneOf = (v: unknown, values: readonly unknown[]) => values.includes(v);

export type ImportedTrace = {
  code: string;
  language: Language;
  result: SessionResult;
  step: number;
  /** Optional in version 2 files; files written before annotations import with none. */
  bookmarks: TraceBookmark[];
  checkpoints: number[];
};

/** Validate all replay-consumed fields before changing any application state. */
export function parseTraceImport(text: string): ImportedTrace {
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
  if (
    !optional(
      payload.bookmarks,
      (b) =>
        Array.isArray(b) &&
        b.length <= 500 &&
        b.every((item) => record(item) && integer(item.step) && str(item.note)),
    ) ||
    !optional(
      payload.checkpoints,
      (c) => Array.isArray(c) && c.length <= MAX_CHECKPOINTS && c.every(integer),
    )
  )
    throw new Error('Invalid trace bookmarks or checkpoints.');
  const result = validateSessionResult(payload.result, (payload.language ?? 'python') as Language);
  const run = result.run;
  const totalSteps = record(run) && Array.isArray(run.steps) ? run.steps.length : 0;
  const bookmarks = normalizeBookmarks(
    ((payload.bookmarks ?? []) as TraceBookmark[]).map(({ step, note }) => ({ step, note })),
    totalSteps,
  );
  return {
    code: payload.code,
    language: (payload.language ?? 'python') as Language,
    result: result as SessionResult,
    step: Math.min((payload.step as number | undefined) ?? 0, Math.max(0, totalSteps - 1)),
    bookmarks,
    checkpoints: normalizeCheckpoints((payload.checkpoints ?? []) as number[], bookmarks),
  };
}
