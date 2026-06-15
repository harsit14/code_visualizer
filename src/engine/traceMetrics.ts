import type { TraceStep } from './types';

export function lineExecutionCounts(steps: readonly TraceStep[]): ReadonlyMap<number, number> {
  const counts = new Map<number, number>();
  for (const step of steps) {
    if (step.event !== 'line' || step.line < 1) {
      continue;
    }
    counts.set(step.line, (counts.get(step.line) ?? 0) + 1);
  }
  return counts;
}
