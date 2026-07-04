import { describe, expect, it } from 'vitest';
import {
  effectiveFrame,
  effectiveFrameIndex,
  nextBreakpointStep,
  nextStepOnLine,
  stepOverStep,
  traceBreakpointStep,
  traceStepOnLine,
} from './traceNavigation';
import type { FrameSnapshot, TraceStep } from './types';

function frame(id: string, line = 1): FrameSnapshot {
  return { id, func: id, line, locals: {} };
}

function step(index: number, line: number, stack: FrameSnapshot[], exc = false): TraceStep {
  return {
    i: index,
    event: exc ? 'exception' : 'line',
    line,
    func: stack.at(-1)?.func ?? '<module>',
    stack,
    globals: {},
    stdoutLen: 0,
    ...(exc ? { exc: { type: 'ValueError', msg: 'boom' } } : {}),
  };
}

describe('trace navigation', () => {
  it('selects the explicit frame or the top frame', () => {
    const caller = frame('caller');
    const child = frame('child');
    const current = step(0, 10, [caller, child]);

    expect(effectiveFrameIndex(current, 0)).toBe(0);
    expect(effectiveFrame(current, 0)).toBe(caller);
    expect(effectiveFrameIndex(current, null)).toBe(1);
    expect(effectiveFrame(current, 99)).toBe(child);
  });

  it('finds the next future step on a line', () => {
    const root = frame('root');
    const steps = [step(0, 3, [root]), step(1, 4, [root]), step(2, 3, [root])];

    expect(nextStepOnLine(steps, 0, 3)).toBe(2);
    expect(nextStepOnLine(steps, 1, 8)).toBeNull();
    expect(nextStepOnLine(steps, 1, null)).toBeNull();
  });

  it('jumps to the next breakpoint after the current step', () => {
    const root = frame('root');
    const steps = [step(0, 5, [root]), step(1, 6, [root]), step(2, 5, [root])];

    expect(nextBreakpointStep(steps, 0, new Set([5]))).toBe(2);
    expect(nextBreakpointStep(steps, 0, new Set([6]))).toBe(1);
    expect(nextBreakpointStep(steps, 2, new Set([5, 6]))).toBeNull();
  });

  it('wraps cursor and breakpoint targets when the next match is behind the current step', () => {
    const root = frame('root');
    const steps = [
      step(0, 3, [root]),
      step(1, 4, [root]),
      step(2, 5, [root]),
    ];

    expect(traceStepOnLine(steps, 2, 3)).toBe(0);
    expect(traceBreakpointStep(steps, 2, new Set([4]))).toBe(1);
    expect(traceStepOnLine(steps, 2, 9)).toBeNull();
  });

  it('steps over child frames until the current frame is active again', () => {
    const caller = frame('caller');
    const child = frame('child');
    const steps = [
      step(0, 10, [caller]),
      step(1, 20, [caller, child]),
      step(2, 21, [caller, child]),
      step(3, 11, [caller]),
    ];

    expect(stepOverStep(steps, 0, null)).toBe(3);
  });

  it('stops when the current frame returns or disappears', () => {
    const root = frame('root');
    const child = frame('child');
    const steps = [step(0, 20, [root, child]), step(1, 12, [root])];

    expect(stepOverStep(steps, 0, null)).toBe(1);
  });

  it('does not hide exceptions raised inside a stepped-over child frame', () => {
    const caller = frame('caller');
    const child = frame('child');
    const steps = [
      step(0, 10, [caller]),
      step(1, 20, [caller, child], true),
      step(2, 11, [caller]),
    ];

    expect(stepOverStep(steps, 0, null)).toBe(1);
  });
});
