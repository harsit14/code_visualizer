import { describe, expect, it } from 'vitest';
import { lineExecutionCounts } from './traceMetrics';
import type { TraceStep } from './types';

function step(index: number, line: number, event: TraceStep['event'] = 'line'): TraceStep {
  return {
    i: index,
    event,
    line,
    func: 'solve',
    stack: [],
    globals: {},
    stdoutLen: 0,
  };
}

describe('lineExecutionCounts', () => {
  it('counts executed line events by source line', () => {
    const counts = lineExecutionCounts([
      step(0, 3),
      step(1, 4),
      step(2, 3),
      step(3, 3),
      step(4, 2, 'call'),
      step(5, 4, 'return'),
    ]);

    expect(counts.get(3)).toBe(3);
    expect(counts.get(4)).toBe(1);
    expect(counts.has(2)).toBe(false);
  });

  it('ignores non-positive line numbers', () => {
    const counts = lineExecutionCounts([step(0, 0), step(1, -1), step(2, 1)]);

    expect([...counts.entries()]).toEqual([[1, 1]]);
  });
});
