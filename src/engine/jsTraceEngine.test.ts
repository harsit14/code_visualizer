import { describe, expect, it } from 'vitest';
import { instrumentJavaScript, runJavaScriptTrace } from './jsTraceEngine';

describe('runJavaScriptTrace', () => {
  it('records line steps, variables, arrays, and stdout for JavaScript', () => {
    const result = runJavaScriptTrace(
      `let total = 0;
for (let i = 0; i < 3; i++) {
  total += i;
}
const nums = [total, 5];
console.log(total);
`,
      'javascript',
    );

    expect(result.status).toBe('ok');
    expect(result.run?.stdout).toBe('3\n');
    expect(result.run?.runtimeMs).toBeGreaterThanOrEqual(0);
    expect(result.run?.memoryMb).not.toBeNull();
    expect(result.run?.memoryMb ?? -1).toBeGreaterThanOrEqual(0);
    expect(typeof result.run?.memoryIsEstimate).toBe('boolean');
    expect(result.run?.steps.length).toBeGreaterThan(3);
    const finalLocals = result.run?.steps.at(-1)?.stack[0].locals;
    expect(finalLocals?.total).toEqual({ k: 'num', t: 'number', v: '3' });
    expect(finalLocals?.nums?.k).toBe('seq');
  });

  it('strips basic TypeScript annotations before tracing', () => {
    const result = runJavaScriptTrace(
      `const nums: number[] = [2, 4];
let total: number = 0;
for (const value of nums) {
  total += value;
}
console.log(total);
`,
      'typescript',
    );

    expect(result.status).toBe('ok');
    expect(result.run?.stdout).toBe('6\n');
    expect(result.run?.steps.at(-1)?.stack[0].locals.total).toEqual({
      k: 'num',
      t: 'number',
      v: '6',
    });
  });

  it('captures nested mutations on every step with stable object identity', () => {
    const result = runJavaScriptTrace(
      'const root = { child: { count: 1 } };\nroot.child.count = 2;\nroot.child.self = root.child;',
      'javascript',
    );
    expect(result.status).toBe('ok');
    const roots = result
      .run!.steps.filter((s) => s.event === 'line')
      .map((s) => s.stack[0].locals.root);
    const first = roots[0];
    const last = roots.at(-1)!;
    if (first.k !== 'obj' || last.k !== 'obj') throw new Error('Missing object snapshots');
    const before = first.attrs.child;
    const after = last.attrs.child;
    if (before.k !== 'obj' || after.k !== 'obj') throw new Error('Missing nested snapshots');
    expect(before.id).toBe(after.id);
    expect(before.attrs.count).toMatchObject({ v: '1' });
    expect(after.attrs.count).toMatchObject({ v: '2' });
    expect(after.attrs.self).toEqual({ k: 'ref', id: after.id });
    expect(result.run!.steps[0].phase).toBe('after');
  });

  it('keeps both aliases expanded unless they form an ancestor cycle', () => {
    const result = runJavaScriptTrace(
      'const child = { value: 1 };\nconst root = { a: child, b: child };\nchild.value = 2;',
      'javascript',
    );
    const root = result.run!.steps.at(-1)!.stack[0].locals.root;
    if (root.k !== 'obj' || root.attrs.a.k !== 'obj' || root.attrs.b.k !== 'obj')
      throw new Error('Missing alias state');
    expect(root.attrs.a.id).toBe(root.attrs.b.id);
    expect(root.attrs.b.attrs.value).toMatchObject({ v: '2' });
  });

  it('does not invoke object accessors during snapshots and preserves JS null', () => {
    const result = runJavaScriptTrace(
      'const value = { get danger() { throw new Error("getter"); } };\nconst empty = null;',
      'javascript',
    );
    expect(result.status).toBe('ok');
    expect(result.run!.steps.at(-1)!.stack[0].locals.empty).toEqual({
      k: 'repr',
      t: 'null',
      v: 'null',
    });
  });

  it('bounds the trace and output while retaining a partial replay', () => {
    const result = runJavaScriptTrace('let n = 0;\nwhile (n < 5000) {\n n++;\n}', 'javascript');
    expect(result.run!.truncated).toBe(true);
    expect(result.run!.steps.length).toBeLessThanOrEqual(3000);
    expect(result.run!.truncationReason).toContain('Trace limit');
    const output = runJavaScriptTrace('console.log("x".repeat(100001));', 'javascript');
    expect(output.run!.truncated).toBe(true);
    expect(output.run!.stdout.length).toBe(100000);
  });

  it('bounds cumulative snapshot size for wide nested data', () => {
    const result = runJavaScriptTrace(
      'const data = Array.from({length: 24}, () => Array(24).fill(1));\nfor (let i = 0; i < 500; i++) {\n data[0][0] = i;\n}',
      'javascript',
    );
    expect(result.run!.truncated).toBe(true);
    expect(result.run!.truncationReason).toContain('Snapshot size limit');
    expect(result.run!.steps.length).toBeLessThan(3000);
  });

  it('returns an exception step for runtime errors', () => {
    const result = runJavaScriptTrace('throw new Error("boom");', 'javascript');

    expect(result.status).toBe('error');
    expect(result.error?.type).toBe('Error');
    expect(result.run?.steps.at(-1)?.event).toBe('exception');
  });
});

describe('instrumentJavaScript', () => {
  it('inserts trace calls after executable lines', () => {
    expect(instrumentJavaScript('let total = 0;', 'javascript')).toContain('__trace(1');
  });
});
