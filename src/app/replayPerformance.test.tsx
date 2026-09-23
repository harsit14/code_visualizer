// @vitest-environment jsdom
/**
 * Replay budgets for 100, 1,000 and 3,000-step traces. jsdom is slower and
 * noisier than a browser, so budgets are loose regression guards; the browser
 * suite measures real step-to-render latency.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CallStackPanel } from '../components/CallStackPanel';
import { DataPanel } from '../components/DataPanel';
import { VariablesPanel } from '../components/VariablesPanel';
import { callTreeAt, indexCallTree } from '../engine/callTree';
import { runJavaScriptTrace } from '../engine/jsTraceEngine';
import { describeStepChange } from '../engine/stepChange';

afterEach(cleanup);

/** A recursive DP program whose step count scales with `n`. */
function traceOf(targetSteps: number) {
  const iterations = Math.max(1, Math.floor(targetSteps / 5));
  const source = `function add(a, b) {
  return a + b;
}
const dp = new Array(${iterations + 2}).fill(0);
dp[1] = 1;
for (let i = 2; i < dp.length; i++) {
  dp[i] = add(dp[i - 1], dp[i - 2]) % 1000;
}`;
  const run = runJavaScriptTrace(source, 'javascript').run!;
  return { steps: run.steps, stdout: run.stdout };
}

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
}

function sampleIndices(total: number, count: number): number[] {
  const stride = Math.max(1, Math.floor(total / count));
  return Array.from({ length: Math.ceil(total / stride) }, (_, index) => index * stride).filter(
    (index) => index < total,
  );
}

describe.each([100, 1000, 3000])('replaying a %i-step trace', (size) => {
  const { steps, stdout } = traceOf(size);

  it('produces a trace of the intended size', () => {
    expect(steps.length).toBeGreaterThanOrEqual(Math.min(size, 3000) * 0.8);
  });

  it('derives each step explanation and call tree quickly', () => {
    const index = indexCallTree(steps);
    const samples = sampleIndices(steps.length, 300).map((step) => {
      const started = performance.now();
      describeStepChange(steps, step, stdout);
      callTreeAt(index, steps, step);
      return performance.now() - started;
    });
    expect(p95(samples)).toBeLessThan(10);
  });

  it('re-renders the inspection panels for a step change within budget', () => {
    const renderStep = (step: number) => (
      <>
        <VariablesPanel
          change={describeStepChange(steps, step, stdout)}
          currentStep={steps[step]}
          frameIndex={null}
          onToggleWatch={() => {}}
          previousStep={steps[step - 1]}
          watchedVariables={[]}
        />
        <DataPanel
          analysis={null}
          atLastStep={step === steps.length - 1}
          currentStep={steps[step]}
          frameIndex={null}
          previousStep={steps[step - 1]}
          returnValue={null}
        />
        <CallStackPanel
          currentStep={steps[step]}
          onSelectFrame={() => {}}
          selectedFrameIndex={null}
          step={step}
          steps={steps}
        />
      </>
    );
    const { rerender } = render(renderStep(0));
    const samples = sampleIndices(steps.length, 120).map((step) => {
      const started = performance.now();
      rerender(renderStep(step));
      return performance.now() - started;
    });
    expect(p95(samples)).toBeLessThan(120);
  });
});
