import { useCallback, useMemo, useState } from 'react';
import { lineExecutionCounts } from '../engine/traceMetrics';
import {
  nextStepOnLine,
  stepOverStep,
  traceBreakpointStep,
  traceStepOnLine,
} from '../engine/traceNavigation';
import type { TraceStep } from '../engine/types';

type UseTraceNavigationOptions = {
  jumpToStep: (step: number) => void;
  selectedFrameIndex: number | null;
  step: number;
  steps: TraceStep[];
};

export function useTraceNavigation({
  jumpToStep,
  selectedFrameIndex,
  step,
  steps,
}: UseTraceNavigationOptions) {
  const [breakpoints, setBreakpoints] = useState<Set<number>>(() => new Set());
  const [cursorLine, setCursorLine] = useState<number | null>(null);

  const executionCounts = useMemo(() => lineExecutionCounts(steps), [steps]);
  const breakpointLines = useMemo(() => [...breakpoints].sort((a, b) => a - b), [breakpoints]);
  const nextBreakpointTarget = useMemo(
    () => traceBreakpointStep(steps, step, breakpoints),
    [breakpoints, step, steps],
  );
  const cursorTarget = useMemo(
    () => traceStepOnLine(steps, step, cursorLine),
    [cursorLine, step, steps],
  );
  const stepOverTarget = useMemo(
    () => stepOverStep(steps, step, selectedFrameIndex),
    [selectedFrameIndex, step, steps],
  );

  const resetTraceNavigation = useCallback(() => {
    setBreakpoints(new Set());
    setCursorLine(null);
  }, []);

  const toggleBreakpoint = useCallback((line: number) => {
    setBreakpoints((current) => {
      const next = new Set(current);
      if (next.has(line)) {
        next.delete(line);
      } else {
        next.add(line);
      }
      return next;
    });
  }, []);

  const runToLine = useCallback(
    (line: number) => {
      const target = nextStepOnLine(steps, step, line);
      if (target !== null) {
        jumpToStep(target);
      }
    },
    [jumpToStep, step, steps],
  );

  const runToBreakpoint = useCallback(() => {
    if (nextBreakpointTarget !== null) {
      jumpToStep(nextBreakpointTarget);
    }
  }, [jumpToStep, nextBreakpointTarget]);

  const runToCursor = useCallback(() => {
    if (cursorTarget !== null) {
      jumpToStep(cursorTarget);
    }
  }, [cursorTarget, jumpToStep]);

  const stepOver = useCallback(() => {
    if (stepOverTarget !== null) {
      jumpToStep(stepOverTarget);
    }
  }, [jumpToStep, stepOverTarget]);

  return {
    breakpointLines,
    cursorLine,
    cursorTarget,
    executionCounts,
    nextBreakpointTarget,
    resetTraceNavigation,
    runToBreakpoint,
    runToCursor,
    runToLine,
    setCursorLine,
    stepOver,
    stepOverTarget,
    toggleBreakpoint,
  };
}
