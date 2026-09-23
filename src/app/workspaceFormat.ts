import type { Language, SessionResult } from '../engine/types';
import { validateSessionResult } from '../engine/resultSchema';
import { normalizeBookmarks, type TraceBookmark } from '../engine/traceSearch';
import type { PracticeNotebook } from './practiceNotebook';
import type { PracticeTestCase } from './practiceCases';

export const MAX_WORKSPACE_BYTES = 25 * 1024 * 1024;
export type WorkspaceContent = {
  code: string;
  language: Language;
  functionName: string | null;
  inputDrafts: Record<string, string> | null;
  seed: number | null;
  cases: PracticeTestCase[];
  notebook: PracticeNotebook;
  watches: string[];
  breakpoints: number[];
  result: SessionResult | null;
  step: number;
  /** Annotated trace steps; absent in backups written before bookmarks existed. */
  bookmarks: TraceBookmark[];
};
export type WorkspaceRevision = {
  id: string;
  name: string;
  revision: number;
  savedAt: number;
  content: WorkspaceContent;
};

const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const string = (v: unknown): v is string => typeof v === 'string' && v.length <= 200_000;
const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const integer = (v: unknown): v is number => number(v) && Number.isSafeInteger(v) && v >= 0;
const nullableString = (v: unknown) => v === null || string(v);
const nullableNumber = (v: unknown) => v === null || number(v);
const strings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length <= 500 && v.every(string);

/** All fields are checked before the editor or local database is touched. */
export function parseWorkspace(text: string): WorkspaceRevision {
  if (new TextEncoder().encode(text).length > MAX_WORKSPACE_BYTES) {
    throw new Error('Workspace backups must be no larger than 25 MB.');
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('Workspace file is not valid JSON.');
  }
  if (!record(value) || value.format !== 'code-visualizer-workspace' || value.version !== 1) {
    throw new Error('Unsupported workspace backup. Choose a version 1 workspace export.');
  }
  const w = value.workspace;
  if (
    !record(w) ||
    !string(w.id) ||
    !/^[a-zA-Z0-9-]{1,80}$/.test(w.id) ||
    !string(w.name) ||
    !w.name.trim() ||
    w.name.length > 120 ||
    !integer(w.revision) ||
    w.revision < 1 ||
    !integer(w.savedAt) ||
    !record(w.content)
  ) {
    throw new Error('Invalid workspace identity or revision.');
  }
  const c = w.content;
  if (
    !string(c.code) ||
    !['python', 'javascript', 'typescript'].includes(c.language as string) ||
    !nullableString(c.functionName) ||
    !nullableNumber(c.seed) ||
    !(
      c.inputDrafts === null ||
      (record(c.inputDrafts) &&
        Object.keys(c.inputDrafts).length <= 500 &&
        Object.entries(c.inputDrafts).every(
          ([k, v]) => !['__proto__', 'constructor', 'prototype'].includes(k) && string(v),
        ))
    ) ||
    !strings(c.watches) ||
    !Array.isArray(c.breakpoints) ||
    c.breakpoints.length > 10_000 ||
    !c.breakpoints.every((line) => integer(line) && line > 0) ||
    !integer(c.step)
  ) {
    throw new Error('Invalid workspace source, inputs or replay position.');
  }
  if (
    c.bookmarks !== undefined &&
    !(
      Array.isArray(c.bookmarks) &&
      c.bookmarks.length <= 500 &&
      c.bookmarks.every(
        (bookmark) =>
          record(bookmark) &&
          integer(bookmark.step) &&
          string(bookmark.note) &&
          bookmark.note.length <= 500,
      )
    )
  ) {
    throw new Error('Invalid workspace bookmarks.');
  }
  if (
    !record(c.notebook) ||
    !string(c.notebook.notes) ||
    !string(c.notebook.patterns) ||
    !['new', 'practicing', 'reviewed'].includes(c.notebook.status as string) ||
    !nullableNumber(c.notebook.updatedAt)
  ) {
    throw new Error('Invalid workspace notebook.');
  }
  if (
    !Array.isArray(c.cases) ||
    c.cases.length > 500 ||
    !c.cases.every(
      (t) =>
        record(t) &&
        string(t.id) &&
        t.id.length > 0 &&
        string(t.name) &&
        strings(t.inputs) &&
        string(t.expected) &&
        nullableString(t.actual) &&
        (t.actualLiteral === undefined || nullableString(t.actualLiteral)) &&
        nullableString(t.error) &&
        nullableNumber(t.runtimeMs) &&
        nullableNumber(t.memoryMb) &&
        ['idle', 'running', 'ran', 'pass', 'fail', 'error', 'inconclusive'].includes(
          t.status as string,
        ),
    ) ||
    new Set(c.cases.map((t) => t.id)).size !== c.cases.length
  ) {
    throw new Error('Invalid workspace practice cases.');
  }
  const result = c.result === null ? null : validateSessionResult(c.result, c.language as Language);
  const content = c as WorkspaceContent;
  // Pick known fields, discarding unrelated properties from untrusted files.
  return {
    id: w.id,
    name: w.name.trim(),
    revision: w.revision,
    savedAt: w.savedAt,
    content: {
      code: content.code,
      language: content.language,
      functionName: content.functionName,
      inputDrafts: content.inputDrafts,
      seed: content.seed,
      cases: content.cases.map((t) => ({
        ...t,
        status: t.status === 'running' ? 'idle' : t.status,
      })),
      notebook: content.notebook,
      watches: [...new Set(content.watches)],
      breakpoints: [...new Set(content.breakpoints)],
      result,
      step: Math.min(content.step, Math.max(0, (result?.run?.steps.length ?? 0) - 1)),
      bookmarks: normalizeBookmarks(
        (content.bookmarks ?? []).map(({ step, note }) => ({ step, note })),
        result?.run?.steps.length ?? 0,
      ),
    },
  };
}

export function serializeWorkspace(workspace: WorkspaceRevision): string {
  const text = JSON.stringify({ format: 'code-visualizer-workspace', version: 1, workspace });
  parseWorkspace(text);
  return text;
}
