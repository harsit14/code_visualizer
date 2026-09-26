/**
 * The Python fixtures were recorded with the real engine (`run_session` from
 * engine/codeviz, function mode, seed 1); each keeps its source in `code`.
 * Timing, analysis and the function-only globals were blanked because the
 * comparison never reads them.
 */
import { describe, expect, it } from 'vitest';
import { runJavaScriptTrace } from './jsTraceEngine';
import { compareRuns, describeOutcome, type ComparedRun } from './runComparison';
import fixtures from './runComparison.fixtures.json';
import type { SessionResult } from './types';

function python(name: keyof typeof fixtures): ComparedRun {
  return {
    language: 'python',
    result: structuredClone(fixtures[name].result) as unknown as SessionResult,
  };
}

function javascript(code: string): ComparedRun {
  return { language: 'javascript', result: runJavaScriptTrace(code, 'javascript') };
}

/** The same run with every frame and object id changed, as a fresh run would have. */
function relabelled(run: ComparedRun): ComparedRun {
  const text = JSON.stringify(run.result)
    .replace(/"id":(\d+)/g, (_, id: string) => `"id":${Number(id) + 100}`)
    .replace(/"frame-(\d+)"/g, '"frame-9$1"');
  return { ...run, result: JSON.parse(text) as SessionResult };
}

/** The first `steps` steps of a run, as if a lower step limit had stopped it. */
function cutShort(run: ComparedRun, steps: number): ComparedRun {
  const full = run.result.run!;
  const kept = full.steps.slice(0, steps);
  return {
    ...run,
    result: {
      ...run.result,
      run: {
        ...full,
        steps: kept,
        stdout: full.stdout.slice(0, kept.at(-1)!.stdoutLen),
        returnValue: null,
        truncated: true,
        truncationReason: `Trace limit of ${steps} steps reached.`,
      },
    },
  };
}

function compare(baseline: ComparedRun, current: ComparedRun) {
  const comparison = compareRuns(baseline, current);
  if (!comparison.comparable) throw new Error(comparison.reason);
  return comparison;
}

function topLocal(run: ComparedRun, step: number, name: string) {
  return run.result.run!.steps[step].stack.at(-1)!.locals[name];
}

describe('compareRuns', () => {
  it('shows where an off-by-one loop in two-sum stops one iteration early', () => {
    const baseline = python('twoSum');
    const current = python('twoSumOffByOne');
    const comparison = compare(baseline, current);

    expect(comparison.verdict).toBe('different');
    expect(comparison.inputsDiffer).toBe(false);
    expect(comparison.divergence).toMatchObject({
      kind: 'variable',
      func: 'two_sum',
      variable: 'i',
      summary: 'In two_sum(), i went on to 2 in the baseline, but stayed 1 in the current run.',
      baseline: { value: '2', line: 3 },
      current: { value: '1', line: 8 },
    });
    const { baseline: was, current: now } = comparison.divergence!;
    expect(topLocal(baseline, was.step, 'i')).toMatchObject({ v: '2' });
    // The current side points at the return, where the loop has already ended.
    expect(current.result.run!.steps[now.step].event).toBe('return');
    expect(describeOutcome(comparison.baseline.outcome)).toBe('Returned [1, 2]');
    expect(describeOutcome(comparison.current.outcome)).toBe('Returned []');
    expect(comparison.baseline).toMatchObject({
      steps: 15,
      maxDepth: 1,
      calls: [{ name: 'two_sum', count: 1 }],
      truncated: false,
      functionName: 'two_sum',
    });
    expect(comparison.current.steps).toBe(13);
  });

  it('describes the fixed loop from the other side too', () => {
    const comparison = compare(python('twoSumOffByOne'), python('twoSum'));
    expect(comparison.divergence).toMatchObject({
      kind: 'variable',
      variable: 'i',
      summary: 'In two_sum(), i went on to 2 in the current run, but stayed 1 in the baseline.',
      baseline: { value: '1' },
      current: { value: '2' },
    });
  });

  it('finds the first recursive call that returns a different value', () => {
    const baseline = python('fib');
    const current = python('fibWrongBase');
    const comparison = compare(baseline, current);

    expect(comparison.verdict).toBe('different');
    expect(comparison.divergence).toMatchObject({
      kind: 'return',
      func: 'fib',
      summary: 'fib(n=0) returned 1 in the current run; the baseline returned 0.',
      baseline: { value: '0' },
      current: { value: '1' },
    });
    const now = comparison.divergence!.current.step;
    expect(current.result.run!.steps[now]).toMatchObject({ event: 'return', ret: { v: '1' } });
    expect(comparison.baseline.calls).toEqual([{ name: 'fib', count: 5 }]);
    expect(comparison.baseline.maxDepth).toBe(3);
    expect(describeOutcome(comparison.current.outcome)).toBe('Returned 3');
  });

  it('reports the same result for an identical run with different object ids', () => {
    const comparison = compare(python('twoSum'), relabelled(python('twoSum')));
    expect(comparison).toMatchObject({
      verdict: 'same',
      divergence: null,
      inputsDiffer: false,
      limitNote: null,
    });

    const code = 'let total = 0;\nfor (const n of [2, 4]) total += n;\nconsole.log(total);';
    expect(compare(javascript(code), javascript(code)).verdict).toBe('same');
  });

  it('reports an exception raised in only one run', () => {
    const comparison = compare(python('lookup'), python('lookupUnsafe'));
    expect(comparison.verdict).toBe('different');
    expect(comparison.divergence).toMatchObject({
      kind: 'exception',
      func: 'lookup',
      current: { value: "raised KeyError: 'cake'", line: 2 },
      baseline: { value: "returned 0 from lookup(prices={'tea': 3}, item='cake')" },
    });
    expect(comparison.divergence!.summary).toMatch(/^Only the current run raised an exception/);
    expect(describeOutcome(comparison.current.outcome)).toBe("Raised KeyError: 'cake'");
  });

  it('flags different inputs and names the argument that received them', () => {
    const comparison = compare(python('lookup'), python('lookupTea'));
    expect(comparison.inputsDiffer).toBe(true);
    expect(comparison.divergence).toMatchObject({
      kind: 'variable',
      variable: 'item',
      summary: "lookup() received item = 'tea' in the current run; the baseline received 'cake'.",
      baseline: { step: 0 },
      current: { step: 0 },
    });
  });

  it('compares printed output by line', () => {
    const comparison = compare(python('report'), python('reportChanged'));
    expect(comparison.verdict).toBe('different');
    expect(comparison.divergence).toMatchObject({
      kind: 'output',
      summary:
        'Printed output first differs on output line 2: the baseline printed "count 3", the current run printed "total 15".',
    });
    expect(comparison.current.output).toBe('best 9\ntotal 15\n');
  });

  it('aligns JavaScript runs by call and finds the first differing list', () => {
    const scale = (operator: string) =>
      `function scale(values, factor) {\n  const out = [];\n  for (const v of values) out.push(v ${operator} factor);\n  return out;\n}\nconsole.log(scale([1, 2, 3], 2).join(','));`;
    const current = javascript(scale('+'));
    const comparison = compare(javascript(scale('*')), current);

    expect(comparison.divergence).toMatchObject({
      kind: 'variable',
      func: 'scale',
      variable: 'out',
      summary: 'In scale(), out became [3] in the current run where the baseline had [2].',
      current: { line: 3, value: '[3]' },
    });
    const out = topLocal(current, comparison.divergence!.current.step, 'out');
    expect(out).toMatchObject({ k: 'seq', len: 1 });
    expect(comparison.current.maxDepth).toBe(2);
  });

  it('reports a call made in only one run', () => {
    const fib = (base: string) =>
      `function fib(n) {\n  if (${base}) return n < 1 ? 1 : n;\n  return fib(n - 1) + fib(n - 2);\n}\nconsole.log(fib(2));`;
    const comparison = compare(javascript(fib('n < 2')), javascript(fib('n < 1')));
    expect(comparison.divergence).toMatchObject({
      kind: 'call',
      func: 'fib',
      summary:
        'Only the current run called fib(n=0); at that point the baseline returned 1 from fib(n=1).',
    });
    expect(comparison.baseline.calls).toEqual([{ name: 'fib', count: 3 }]);
    expect(comparison.current.calls).toEqual([{ name: 'fib', count: 5 }]);
  });

  it('separates the same final result reached by a different path', () => {
    const comparison = compare(
      javascript(
        'const nums = [2, 4];\nlet total = 0;\nfor (const n of nums) total += n;\nconsole.log(total);',
      ),
      javascript('const nums = [2, 4];\nlet total = nums[0] + nums[1];\nconsole.log(total);'),
    );
    expect(comparison.verdict).toBe('same-outcome');
    expect(comparison.divergence).toMatchObject({
      kind: 'variable',
      variable: 'total',
      baseline: { value: '0' },
      current: { value: '6' },
    });
  });

  it('does not count steps cut off by a limit as a difference', () => {
    const loop = javascript('let i = 0;\nwhile (true) {\n  i++;\n}');
    const incomplete = compare(loop, relabelled(loop));
    expect(incomplete.verdict).toBe('incomplete');
    expect(incomplete.limitNote).toMatch(/^Both runs stopped at a limit/);
    expect(incomplete.baseline.truncated).toBe(true);
    expect(describeOutcome(incomplete.baseline.outcome)).toMatch(/^Stopped early/);

    // A difference before the limit is still reported.
    const faster = compare(loop, javascript('let i = 0;\nwhile (true) {\n  i += 2;\n}'));
    expect(faster.verdict).toBe('different');
    expect(faster.divergence).toMatchObject({ variable: 'i', baseline: { value: '1' } });

    // A run cut short has not "skipped" the other run's later calls, values or output.
    const full = python('report');
    const cut = cutShort(full, 2);
    for (const [baseline, current] of [
      [cut, full],
      [full, cut],
    ]) {
      const comparison = compare(baseline, current);
      expect(comparison.divergence).toBeNull();
      expect(comparison.verdict).toBe('incomplete');
    }
    expect(compare(cut, full).limitNote).toBe(
      'The baseline stopped at a limit (Trace limit of 2 steps reached.), so only the recorded steps were compared.',
    );
  });

  it('refuses to compare runs in different languages or without a trace', () => {
    expect(compareRuns(python('twoSum'), javascript('console.log(1);'))).toEqual({
      comparable: false,
      reason:
        'The baseline is Python and the current run is JavaScript. Only runs in the same language can be compared.',
    });
    const broken = compareRuns(javascript('console.log(1);'), javascript('let = ;'));
    expect(broken.comparable).toBe(false);
    expect(!broken.comparable && broken.reason).toMatch(
      /^The current run stopped before producing a trace \(SyntaxError: /,
    );
  });
});
