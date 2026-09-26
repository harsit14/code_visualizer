import type { Language, SessionResult } from '../engine/types';
import { validateSessionResult } from '../engine/resultSchema';
import { MAX_CHECKPOINTS, normalizeCheckpoints } from '../engine/traceCheckpoints';
import { normalizeBookmarks, type TraceBookmark } from '../engine/traceSearch';
import type { PracticeNotebook } from './practiceNotebook';
import type { PracticeTestCase } from './practiceCases';
import { EMPTY_META, parseWorkspaceMeta, type WorkspaceMeta } from './workspaceTags';

export const MAX_WORKSPACE_BYTES = 25 * 1024 * 1024;
/** Version 2 adds optional library metadata (tags, review state); version 1 still imports. */
export const WORKSPACE_FORMAT_VERSION = 2;
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
  /** Bookmarked steps in presentation order; absent before checkpoints existed. */
  checkpoints: number[];
};
export type WorkspaceRevision = {
  id: string;
  name: string;
  revision: number;
  savedAt: number;
  content: WorkspaceContent;
};
export type WorkspaceBackup = { workspace: WorkspaceRevision; meta: WorkspaceMeta };

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
export function parseWorkspaceBackup(text: string): WorkspaceBackup {
  if (new TextEncoder().encode(text).length > MAX_WORKSPACE_BYTES) {
    throw new Error('Workspace backups must be no larger than 25 MB.');
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('Workspace file is not valid JSON.');
  }
  if (
    !record(value) ||
    value.format !== 'code-visualizer-workspace' ||
    (value.version !== 1 && value.version !== WORKSPACE_FORMAT_VERSION)
  ) {
    throw new Error('Unsupported workspace backup. Choose a version 1 or 2 workspace export.');
  }
  const workspace = validateWorkspaceRevision(value.workspace);
  return {
    workspace,
    meta:
      value.version === 1 || value.meta === undefined
        ? { ...EMPTY_META, tags: [] }
        : parseWorkspaceMeta(value.meta),
  };
}

export const parseWorkspace = (text: string): WorkspaceRevision =>
  parseWorkspaceBackup(text).workspace;

/** Checks one workspace object and returns only its known fields. */
export function validateWorkspaceRevision(w: unknown): WorkspaceRevision {
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
    c.checkpoints !== undefined &&
    !(
      Array.isArray(c.checkpoints) &&
      c.checkpoints.length <= MAX_CHECKPOINTS &&
      c.checkpoints.every(integer)
    )
  ) {
    throw new Error('Invalid workspace checkpoints.');
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
  const bookmarks = normalizeBookmarks(
    (content.bookmarks ?? []).map(({ step, note }) => ({ step, note })),
    result?.run?.steps.length ?? 0,
  );
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
      bookmarks,
      checkpoints: normalizeCheckpoints(content.checkpoints ?? [], bookmarks),
    },
  };
}

/** Encodes an already validated workspace; use serializeWorkspace for anything else. */
export function encodeWorkspace(workspace: WorkspaceRevision, meta?: WorkspaceMeta): string {
  return JSON.stringify({
    format: 'code-visualizer-workspace',
    version: WORKSPACE_FORMAT_VERSION,
    workspace,
    ...(meta ? { meta } : {}),
  });
}

/** Meta is included in backups; stored revisions omit it because tags live on the head. */
export function serializeWorkspace(workspace: WorkspaceRevision, meta?: WorkspaceMeta): string {
  const text = encodeWorkspace(workspace, meta);
  parseWorkspaceBackup(text);
  return text;
}
