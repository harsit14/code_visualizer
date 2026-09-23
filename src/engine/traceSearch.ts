/**
 * Searching a recorded trace for lines, functions, events, printed output and
 * variable changes, plus the bookmark shape stored with workspaces.
 */
import { describeStepChange, type ValueChange } from './stepChange';
import type { TraceStep } from './types';

export type TraceBookmark = { step: number; note: string };

export type TraceQuery =
  | { kind: 'line'; line: number }
  | { kind: 'function'; name: string }
  | { kind: 'event'; event: TraceStep['event'] }
  | { kind: 'output'; text: string }
  | { kind: 'variable'; name: string; value: string | null }
  | { kind: 'text'; text: string };

/** `line` is the line that produced a change for variable/text hits, else the step's line. */
export type TraceSearchHit = { step: number; line: number; func: string; detail: string };

export const TRACE_SEARCH_HELP =
  'Try a variable (total), a value (total = 6), line 12, fn helper, return, exception or print done.';

const EVENT_WORDS: Record<string, TraceStep['event']> = {
  call: 'call',
  calls: 'call',
  return: 'return',
  returns: 'return',
  exception: 'exception',
  exceptions: 'exception',
  error: 'exception',
  errors: 'exception',
};

const IDENTIFIER = /^[A-Za-z_$][\w$]*(?:(?:\.[A-Za-z_$][\w$]*)|(?:\[[^\]]+\]))*$/;

function unquote(text: string): string {
  const trimmed = text.trim();
  const quoted = /^(['"`])(.*)\1$/s.exec(trimmed);
  return quoted ? quoted[2] : trimmed;
}

export function parseTraceQuery(input: string): TraceQuery | null {
  const text = input.trim();
  if (!text) return null;
  const line = /^(?:line\s*|l|:)(\d+)$/i.exec(text);
  if (line) return { kind: 'line', line: Number(line[1]) };
  const fn =
    /^(?:fn|in|function|def)\s+([A-Za-z_$<][\w$<>.]*)$/i.exec(text) ??
    /^([A-Za-z_$][\w$.]*)\(\)$/.exec(text);
  if (fn) return { kind: 'function', name: fn[1] };
  const event = EVENT_WORDS[text.toLowerCase()];
  if (event) return { kind: 'event', event };
  const output = /^(?:print|printed|output|stdout)\s+(.+)$/i.exec(text);
  if (output) return { kind: 'output', text: unquote(output[1]) };
  if (/^(['"`]).*\1$/s.test(text)) return { kind: 'output', text: unquote(text) };
  const assignment = /^(.+?)\s*={1,3}\s*(.+)$/.exec(text);
  if (assignment && IDENTIFIER.test(assignment[1].trim())) {
    return { kind: 'variable', name: assignment[1].trim(), value: unquote(assignment[2]) };
  }
  if (IDENTIFIER.test(text)) return { kind: 'variable', name: text, value: null };
  return { kind: 'text', text };
}

function matchesVariable(change: ValueChange, name: string): boolean {
  return (
    change.root === name ||
    change.path === name ||
    change.path.startsWith(`${name}[`) ||
    change.path.startsWith(`${name}.`)
  );
}

function describeChange(change: ValueChange): string {
  return `${change.path}: ${change.before ?? 'absent'} → ${change.after ?? 'removed'}`;
}

function sameValue(formatted: string | null, wanted: string): boolean {
  return formatted !== null && unquote(formatted) === wanted;
}

function eventLabel(step: TraceStep): string {
  if (step.event === 'exception' && step.exc) return `${step.exc.type}: ${step.exc.msg}`;
  if (step.event === 'call') return `call ${step.func}()`;
  if (step.event === 'return')
    return step.func === '<module>' ? 'program end' : `${step.func}() returned`;
  return 'line';
}

/** Returns matching steps in trace order, capped at `limit`, with the total count. */
export function searchTrace(
  steps: readonly TraceStep[],
  query: TraceQuery,
  stdout = '',
  limit = 50,
): { hits: TraceSearchHit[]; total: number } {
  const hits: TraceSearchHit[] = [];
  let total = 0;
  const push = (index: number, detail: string, line = steps[index].line) => {
    total += 1;
    if (hits.length < limit) hits.push({ step: index, line, func: steps[index].func, detail });
  };
  const needle = query.kind === 'text' || query.kind === 'output' ? query.text.toLowerCase() : '';

  steps.forEach((step, index) => {
    switch (query.kind) {
      case 'line':
        if (step.line === query.line) push(index, eventLabel(step));
        return;
      case 'function':
        if (
          step.func === query.name ||
          step.stack[step.stack.length - 1]?.qualname === query.name
        ) {
          push(index, `${eventLabel(step)} · line ${step.line}`);
        }
        return;
      case 'event':
        if (step.event === query.event) push(index, eventLabel(step));
        return;
      case 'output': {
        const printed = stdout.slice(steps[index - 1]?.stdoutLen ?? 0, step.stdoutLen);
        if (printed.toLowerCase().includes(needle)) push(index, `printed ${printed.trim()}`);
        return;
      }
      case 'variable': {
        const change = describeStepChange(steps, index, stdout, Number.POSITIVE_INFINITY);
        const match = change?.changes.find(
          (item) =>
            matchesVariable(item, query.name) &&
            (query.value === null || sameValue(item.after, query.value)),
        );
        if (match) push(index, describeChange(match), change?.line ?? step.line);
        return;
      }
      case 'text': {
        const change = describeStepChange(steps, index, stdout, Number.POSITIVE_INFINITY);
        const match = change?.changes.find((item) =>
          describeChange(item).toLowerCase().includes(needle),
        );
        if (match) {
          push(index, describeChange(match), change?.line ?? step.line);
        } else if (change?.output.toLowerCase().includes(needle)) {
          push(index, `printed ${change.output.trim()}`);
        } else if (step.exc && `${step.exc.type}: ${step.exc.msg}`.toLowerCase().includes(needle)) {
          push(index, eventLabel(step));
        }
        return;
      }
    }
  });
  // A bare word that never changed as a variable is searched as text instead.
  if (query.kind === 'variable' && query.value === null && total === 0) {
    return searchTrace(steps, { kind: 'text', text: query.name }, stdout, limit);
  }
  return { hits, total };
}

/** Keeps bookmarks sorted, unique by step and inside the trace. */
export function normalizeBookmarks(
  bookmarks: readonly TraceBookmark[],
  totalSteps: number,
): TraceBookmark[] {
  const byStep = new Map<number, TraceBookmark>();
  for (const bookmark of bookmarks) {
    if (Number.isInteger(bookmark.step) && bookmark.step >= 0 && bookmark.step < totalSteps) {
      byStep.set(bookmark.step, { step: bookmark.step, note: bookmark.note.slice(0, 500) });
    }
  }
  return [...byStep.values()].sort((a, b) => a.step - b.step);
}
