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
