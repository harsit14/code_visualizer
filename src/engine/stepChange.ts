/**
 * Explains what happened between two consecutive trace steps: which statement
 * ran, which values it changed (down to list indices, dict keys and object
 * attributes), and what it printed.
 *
 * Line steps show state *before* their line runs, so the statement responsible
 * for the current state is usually the previous step's line. Legacy JavaScript
 * traces with "after" line steps are explained from the current line instead.
 */
import { expandSelf, formatValue } from './trace';
import type { EncodedValue, FrameSnapshot, TraceStep } from './types';

export type ValueChange = {
  /** Display path such as `lookup[11]`, `nums[2]` or `node.next`. */
  path: string;
  /** Variable the path starts from. */
  root: string;
  /** `null` when the value did not exist before. */
  before: string | null;
  /** `null` when the value was removed. */
  after: string | null;
};

export type StepChangeKind =
  | 'start'
  | 'enter'
  | 'statement'
  | 'resume'
  | 'call'
  | 'return'
  | 'exception';

export type StepChange = {
  kind: StepChangeKind;
  /** Line whose execution produced this state; `null` when nothing ran yet. */
  line: number | null;
  /** Function whose frame the explanation refers to. */
  func: string;
  summary: string;
  changes: ValueChange[];
  /** Changes beyond the display limit. */
  hiddenChanges: number;
  /** Text printed between the previous step and this one. */
  output: string;
};

const PREVIEW_LIMIT = 48;
const MAX_DIFF_DEPTH = 3;

function preview(value: EncodedValue | null | undefined): string {
  const text = formatValue(value);
  return text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT - 1)}…` : text;
}

function frameName(frame: FrameSnapshot | undefined): string {
  if (!frame) return 'the program';
  return frame.func === '<module>' ? 'the module' : `${frame.func}()`;
}

function same(a: EncodedValue | undefined, b: EncodedValue | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function containerId(value: EncodedValue): number | undefined {
  return value.k === 'seq' || value.k === 'dict' || value.k === 'obj' ? value.id : undefined;
}

function identity(value: EncodedValue): number | undefined {
  return value.k === 'tree' || value.k === 'listnode' ? value.id : containerId(value);
}

function isSetLike(value: EncodedValue): boolean {
  return value.k === 'seq' && (value.t === 'set' || value.t === 'frozenset' || value.t === 'Set');
}

function keyLabel(key: EncodedValue): string {
  return formatValue(key);
}

class ChangeCollector {
  readonly items: ValueChange[] = [];
  private seen = new Set<number>();

  add(
    root: string,
    path: string,
    before: EncodedValue | undefined,
    after: EncodedValue | undefined,
  ) {
    this.items.push({
      root,
      path,
      before: before === undefined ? null : preview(before),
      after: after === undefined ? null : preview(after),
    });
  }

  diff(
    root: string,
    path: string,
    before: EncodedValue | undefined,
    after: EncodedValue | undefined,
    depth = 0,
  ): void {
    if (same(before, after)) return;
    if (before === undefined || after === undefined) {
      this.add(root, path, before, after);
      return;
    }
    const id = identity(after);
    const inPlace = id !== undefined && id === identity(before) && before.k === after.k;
    // An object mutated in place is explained once, under the first name that reaches it.
    if (inPlace) {
      if (this.seen.has(id)) return;
      this.seen.add(id);
    }
    if (!inPlace || containerId(after) === undefined || depth >= MAX_DIFF_DEPTH) {
      this.add(root, path, before, after);
      return;
    }

    if (before.k === 'seq' && after.k === 'seq') {
      this.diffSequence(root, path, before, after, depth);
    } else if (before.k === 'dict' && after.k === 'dict') {
      const previous = new Map(before.entries.map(([key, value]) => [keyLabel(key), value]));
      const current = new Map(after.entries.map(([key, value]) => [keyLabel(key), value]));
      // Keys outside a truncated snapshot are unknown, not added or removed.
      for (const [key, value] of current) {
        if (previous.has(key) || !before.truncated) {
          this.diff(root, `${path}[${key}]`, previous.get(key), value, depth + 1);
        }
      }
      for (const [key, value] of previous) {
        if (!current.has(key) && !after.truncated) {
          this.add(root, `${path}[${key}]`, value, undefined);
        }
      }
    } else if (before.k === 'obj' && after.k === 'obj') {
      for (const [attr, value] of Object.entries(after.attrs)) {
        this.diff(root, `${path}.${attr}`, before.attrs[attr], value, depth + 1);
      }
      for (const [attr, value] of Object.entries(before.attrs)) {
        if (!(attr in after.attrs)) this.add(root, `${path}.${attr}`, value, undefined);
      }
    } else {
      this.add(root, path, before, after);
    }
  }

  private diffSequence(
    root: string,
    path: string,
    before: Extract<EncodedValue, { k: 'seq' }>,
    after: Extract<EncodedValue, { k: 'seq' }>,
    depth: number,
  ) {
    if (isSetLike(after)) {
      const previous = new Set(before.items.map((item) => JSON.stringify(item)));
      const current = new Set(after.items.map((item) => JSON.stringify(item)));
      const added = after.items.filter((item) => !previous.has(JSON.stringify(item)));
      const removed = before.items.filter((item) => !current.has(JSON.stringify(item)));
      if (added.length || removed.length) {
        const parts = [
          added.length ? `added ${added.map((item) => preview(item)).join(', ')}` : '',
          removed.length ? `removed ${removed.map((item) => preview(item)).join(', ')}` : '',
        ].filter(Boolean);
        this.items.push({ root, path, before: preview(before), after: parts.join('; ') });
      }
      return;
    }
    const shared = Math.min(before.items.length, after.items.length);
    for (let index = 0; index < shared; index += 1) {
      this.diff(root, `${path}[${index}]`, before.items[index], after.items[index], depth + 1);
    }
    if (!before.truncated && !after.truncated) {
      for (let index = shared; index < after.items.length; index += 1) {
        this.add(root, `${path}[${index}]`, undefined, after.items[index]);
      }
      for (let index = shared; index < before.items.length; index += 1) {
        this.add(root, `${path}[${index}]`, before.items[index], undefined);
      }
    } else if (before.len !== after.len) {
      this.items.push({
        root,
        path: `len(${path})`,
        before: String(before.len),
        after: String(after.len),
      });
    }
  }
}

function frameValues(frame: FrameSnapshot | undefined): Record<string, EncodedValue> {
  return frame ? expandSelf(frame.locals) : {};
}

function collectChanges(
  previous: TraceStep | undefined,
  current: TraceStep,
  frame: FrameSnapshot | undefined,
): ValueChange[] {
  const collector = new ChangeCollector();
  if (frame) {
    const before = frameValues(previous?.stack.find((candidate) => candidate.id === frame.id));
    const after = frameValues(frame);
    const beforeFrameExists = previous?.stack.some((candidate) => candidate.id === frame.id);
    if (beforeFrameExists) {
      for (const [name, value] of Object.entries(after)) {
        if (value.k !== 'func') collector.diff(name, name, before[name], value);
      }
      for (const [name, value] of Object.entries(before)) {
        if (!(name in after) && value.k !== 'func') collector.add(name, name, value, undefined);
      }
    }
  }
  for (const [name, value] of Object.entries(current.globals)) {
    if (value.k !== 'func' && previous) collector.diff(name, name, previous.globals[name], value);
  }
  return collector.items;
}

function callArguments(frame: FrameSnapshot | undefined): string {
  if (!frame) return '';
  const entries = Object.entries(frame.locals).filter(
    ([name]) => name !== 'self' && name !== 'this',
  );
  const shown = entries.slice(0, 3).map(([name, value]) => `${name}=${preview(value)}`);
  return `${shown.join(', ')}${entries.length > 3 ? ', …' : ''}`;
}

/** Explains the state at `index` relative to the step before it. */
export function describeStepChange(
  steps: readonly TraceStep[],
  index: number,
  stdout = '',
  maxChanges = 6,
): StepChange | null {
  const current = steps[index];
  if (!current) return null;
  const previous = index > 0 ? steps[index - 1] : undefined;
  const top = current.stack[current.stack.length - 1];
  const output = stdout.slice(previous?.stdoutLen ?? 0, current.stdoutLen);
  const finish = (
    kind: StepChangeKind,
    line: number | null,
    summary: string,
    changes: ValueChange[] = [],
  ): StepChange => ({
    kind,
    line,
    func: frameName(top),
    summary,
    changes: changes.slice(0, maxChanges),
    hiddenChanges: Math.max(0, changes.length - maxChanges),
    output,
  });

  if (current.event === 'call') {
    const caller = current.stack[current.stack.length - 2];
    const args = callArguments(top);
    return finish('call', caller?.line ?? null, `Called ${current.func}(${args})`);
  }

  if (current.event === 'exception') {
    const exc = current.exc ? `${current.exc.type}: ${current.exc.msg}` : 'An exception';
    return finish(
      'exception',
      current.line,
      `${exc} was raised in ${frameName(top)}`,
      collectChanges(previous, current, top),
    );
  }

  if (current.event === 'return') {
    const finished = top?.func === '<module>' || current.func === '<module>';
    return finish(
      'return',
      current.line,
      finished ? 'The program finished' : `${current.func}() returned ${preview(current.ret)}`,
      collectChanges(previous, current, top),
    );
  }

  if (current.phase === 'after') {
    return finish(
      'statement',
      current.line,
      `Line ${current.line} ran in ${frameName(top)}`,
      collectChanges(previous, current, top),
    );
  }

  if (!previous) {
    return finish('start', null, 'Nothing has run yet; this line runs next.');
  }

  const previousTop = previous.stack[previous.stack.length - 1];
  const sameFrame = !!top && previousTop?.id === top.id;
  if (sameFrame && previous.event === 'call') {
    return finish('enter', null, `Entered ${frameName(top)}; its first line runs next.`);
  }
  if (sameFrame) {
    const changes = collectChanges(previous, current, top);
    const handled =
      previous.event === 'exception' && previous.exc ? `Handled ${previous.exc.type}; ` : '';
    // Jumping back to an earlier line in the same frame means a loop advanced.
    const looped =
      current.line < previous.line ? `, then the loop on line ${current.line} continued` : '';
    return finish(
      'statement',
      previous.line,
      changes.length || output || looped
        ? `${handled}Line ${previous.line} ran${looped}`
        : `${handled}Line ${previous.line} ran without changing variables; line ${current.line} is next`,
      changes,
    );
  }
  const callSite = previous.stack.find((frame) => frame.id === top?.id);
  if (callSite) {
    const returned =
      previous.event === 'return' && previous.func !== '<module>'
        ? ` after ${previous.func}() returned ${preview(previous.ret)}`
        : '';
    return finish(
      'resume',
      callSite.line,
      `Back in ${frameName(top)}${returned}; line ${callSite.line} finished`,
      collectChanges(previous, current, top),
    );
  }
  return finish('statement', previous.line, `Now in ${frameName(top)}`);
}
