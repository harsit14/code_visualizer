import type { FrameSnapshot, TraceStep } from './types';

export function effectiveFrameIndex(
  step: TraceStep | undefined,
  frameIndex: number | null,
): number {
  const stack = step?.stack ?? [];
  if (frameIndex !== null && frameIndex >= 0 && frameIndex < stack.length) {
    return frameIndex;
  }
  return stack.length - 1;
}

export function effectiveFrame(
  step: TraceStep | undefined,
  frameIndex: number | null,
): FrameSnapshot | undefined {
  const index = effectiveFrameIndex(step, frameIndex);
  return index >= 0 ? step?.stack[index] : undefined;
}

export function nextStepOnLine(
  steps: readonly TraceStep[],
  currentIndex: number,
  line: number | null,
): number | null {
  if (line === null) {
    return null;
  }
  for (let index = currentIndex + 1; index < steps.length; index += 1) {
    if (steps[index].line === line) {
      return index;
    }
  }
  return null;
}

export function nextBreakpointStep(
  steps: readonly TraceStep[],
  currentIndex: number,
  breakpoints: ReadonlySet<number>,
): number | null {
  if (breakpoints.size === 0) {
    return null;
  }
  for (let index = currentIndex + 1; index < steps.length; index += 1) {
    if (breakpoints.has(steps[index].line)) {
      return index;
    }
  }
  return null;
}

export function stepOverStep(
  steps: readonly TraceStep[],
  currentIndex: number,
  frameIndex: number | null,
): number | null {
  const currentStep = steps[currentIndex];
  const frame = effectiveFrame(currentStep, frameIndex);
  if (!frame) {
    return currentIndex + 1 < steps.length ? currentIndex + 1 : null;
  }

  for (let index = currentIndex + 1; index < steps.length; index += 1) {
    const candidate = steps[index];
    const candidateFrameIndex = candidate.stack.findIndex((item) => item.id === frame.id);
    if (candidate.exc) {
      return index;
    }
    if (candidateFrameIndex === -1) {
      return index;
    }
    if (candidateFrameIndex === candidate.stack.length - 1) {
      return index;
    }
  }
  return null;
}
