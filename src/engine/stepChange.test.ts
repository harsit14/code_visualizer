import { describe, expect, it } from 'vitest';
import { runJavaScriptTrace } from './jsTraceEngine';
import { describeStepChange } from './stepChange';
import type { EncodedValue, TraceStep } from './types';

function trace(source: string) {
  const result = runJavaScriptTrace(source, 'javascript');
  return { steps: result.run!.steps, stdout: result.run!.stdout };
}

function stepAt(steps: TraceStep[], predicate: (step: TraceStep) => boolean, nth = 0) {
  const matches = steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => predicate(step));
  return matches[nth].index;
}

const num = (v: string): EncodedValue => ({ k: 'num', t: 'int', v });

function pyStep(
  i: number,
  event: TraceStep['event'],
  line: number,
  frames: { id: string; func: string; line: number; locals: Record<string, EncodedValue> }[],
  extra: Partial<TraceStep> = {},
): TraceStep {
  return {
    i,
    event,
    phase: event === 'line' ? 'before' : 'event',
    line,
    func: frames.at(-1)!.func,
    stack: frames,
    globals: {},
    stdoutLen: 0,
    ...extra,
  };
}

describe('describeStepChange', () => {
  it('names the statement that just ran and the dict entry it created', () => {
    const { steps, stdout } = trace(
      'const lookup = new Map();\nconst nums = [2, 7];\nfor (let i = 0; i < nums.length; i++) {\n  lookup.set(nums[i], i);\n}',
    );
    const afterFirstSet = stepAt(steps, (step) => step.line === 3 && step.event === 'line', 2);
    const change = describeStepChange(steps, afterFirstSet, stdout)!;
    expect(change).toMatchObject({
      kind: 'statement',
      line: 4,
      summary: 'Line 4 ran, then the loop on line 3 continued',
    });
    expect(change.changes).toEqual([
      { root: 'lookup', path: 'lookup[2]', before: null, after: '0' },
      { root: 'i', path: 'i', before: '0', after: '1' },
    ]);
  });

  it('reports list index updates, appends and reassignment', () => {
    const { steps } = trace(
      'const nums = [1, 2];\nnums[1] = 5;\nnums.push(9);\nlet total = 0;\ntotal = nums.length;',
    );
    expect(describeStepChange(steps, 2)!.changes).toEqual([
      { root: 'nums', path: 'nums[1]', before: '2', after: '5' },
    ]);
    expect(describeStepChange(steps, 3)!.changes).toEqual([
      { root: 'nums', path: 'nums[2]', before: null, after: '9' },
    ]);
    expect(describeStepChange(steps, 5)!.changes).toEqual([
      { root: 'total', path: 'total', before: '0', after: '3' },
    ]);
  });

  it('explains object attributes once even when two names alias the object', () => {
    const { steps } = trace(
      'const box = { count: 1 };\nconst alias = box;\nalias.count = 2;\nconst done = true;',
    );
    expect(describeStepChange(steps, 3)!.changes).toEqual([
      { root: 'box', path: 'box.count', before: '1', after: '2' },
    ]);
    const list = trace(
      'const head = { val: 1, next: null };\nconst alias = head;\nalias.val = 2;\nconst done = true;',
    );
    expect(describeStepChange(list.steps, 3)!.changes).toEqual([
      { root: 'head', path: 'head', before: '1', after: '2' },
    ]);
  });

  it('describes calls, returns and resuming the caller with the returned value', () => {
    const { steps, stdout } = trace(
      'function square(n) {\n  return n * n;\n}\nconst out = square(3);\nconsole.log(out);',
    );
    const call = steps.findIndex((step) => step.event === 'call');
    expect(describeStepChange(steps, call, stdout)).toMatchObject({
      kind: 'call',
      line: 4,
      summary: 'Called square(n=3)',
    });
    const ret = steps.findIndex((step) => step.event === 'return' && step.func === 'square');
    expect(describeStepChange(steps, ret, stdout)).toMatchObject({
      kind: 'return',
      line: 2,
      summary: 'square() returned 9',
    });
    const resume = describeStepChange(steps, ret + 1, stdout)!;
    expect(resume).toMatchObject({ kind: 'resume', line: 4 });
    expect(resume.summary).toBe('Back in the module after square() returned 9; line 4 finished');
    expect(resume.changes).toEqual([{ root: 'out', path: 'out', before: null, after: '9' }]);
    const printed = describeStepChange(steps, steps.length - 1, stdout)!;
    expect(printed.output).toBe('9\n');
    expect(printed.summary).toBe('The program finished');
  });

  it('says when a line ran without changing anything', () => {
    const { steps } = trace('let x = 1;\nif (x > 5) {\n  x = 0;\n}\nx += 1;');
    const change = describeStepChange(steps, 2)!;
    expect(change.summary).toBe('Line 2 ran without changing variables; line 5 is next');
    expect(change.changes).toEqual([]);
  });

  it('explains the start of the trace and entering a function', () => {
    const { steps } = trace('function f(a) {\n  const b = a;\n}\nf(1);');
    expect(describeStepChange(steps, 0)).toMatchObject({ kind: 'start', line: null });
    const call = steps.findIndex((step) => step.event === 'call');
    expect(describeStepChange(steps, call + 1)).toMatchObject({ kind: 'enter', line: null });
  });

  it('reports raised exceptions and limits long change lists', () => {
    const { steps } = trace('const grid = [0, 0, 0, 0, 0, 0, 0, 0];\ngrid.fill(1);\nnull.boom;');
    const fill = describeStepChange(steps, 2, '', 3)!;
    expect(fill.changes).toHaveLength(3);
    expect(fill.hiddenChanges).toBe(5);
    const exception = steps.findIndex((step) => step.event === 'exception');
    expect(describeStepChange(steps, exception)!.summary).toContain('TypeError');
  });

  it('uses Python self attributes and set additions', () => {
    const self = (memo: [EncodedValue, EncodedValue][]): EncodedValue => ({
      k: 'obj',
      id: 1,
      t: 'Solution',
      preview: '<Solution>',
      attrs: { memo: { k: 'dict', id: 2, entries: memo, len: memo.length, truncated: false } },
    });
    const seen = (items: EncodedValue[]): EncodedValue => ({
      k: 'seq',
      t: 'set',
      id: 3,
      items,
      len: items.length,
      truncated: false,
    });
    const frame = (locals: Record<string, EncodedValue>, line: number) => [
      { id: 'f', func: 'solve', line, locals },
    ];
    const steps = [
      pyStep(0, 'line', 4, frame({ self: self([]), seen: seen([]) }, 4)),
      pyStep(
        1,
        'line',
        5,
        frame({ self: self([[num('3'), num('9')]]), seen: seen([num('3')]) }, 5),
      ),
    ];
    expect(describeStepChange(steps, 1)!.changes).toEqual([
      { root: 'seen', path: 'seen', before: 'set()', after: 'added 3' },
      { root: 'self.memo', path: 'self.memo[3]', before: null, after: '9' },
    ]);
  });

  it('explains legacy "after" JavaScript steps from the current line', () => {
    const steps: TraceStep[] = [
      {
        ...pyStep(0, 'line', 1, [{ id: 'm', func: '<module>', line: 1, locals: { x: num('1') } }]),
        phase: 'after',
      },
      {
        ...pyStep(1, 'line', 2, [{ id: 'm', func: '<module>', line: 2, locals: { x: num('2') } }]),
        phase: 'after',
      },
    ];
    expect(describeStepChange(steps, 1)).toMatchObject({ kind: 'statement', line: 2 });
  });
});
