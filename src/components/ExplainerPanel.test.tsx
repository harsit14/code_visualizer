// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EncodedValue, SessionResult, TraceStep } from '../engine/types';

const { explainStepMock } = vi.hoisted(() => ({
  explainStepMock: vi.fn(),
}));

vi.mock('../engine/deepseekClient', () => ({
  DEFAULT_DEEPSEEK_MODEL: 'deepseek-v4-flash',
  explainStepWithDeepSeek: explainStepMock,
}));

import { ExplainerPanel } from './ExplainerPanel';

const num = (value: number): EncodedValue => ({ k: 'num', t: 'int', v: String(value) });

function step(index: number, locals: Record<string, EncodedValue>): TraceStep {
  return {
    event: 'line',
    func: '<module>',
    globals: {},
    i: index,
    line: 2,
    stack: [{ func: '<module>', id: 'frame-0', line: 2, locals }],
    stdoutLen: 0,
  };
}

function result(currentStep: TraceStep): SessionResult {
  return {
    analysis: null,
    durationMs: 4,
    error: null,
    mode: 'script',
    run: {
      exception: null,
      functionName: null,
      inputs: [],
      opCount: 2,
      returnValue: null,
      seed: null,
      setupError: null,
      stderr: '',
      stdout: '',
      steps: [currentStep],
      runtimeMs: 1.1,
      memoryMb: 0.2,
      truncated: false,
      truncationReason: null,
    },
    status: 'ok',
  };
}

afterEach(() => {
  explainStepMock.mockReset();
  cleanup();
});

describe('ExplainerPanel', () => {
  it('requests a hosted DeepSeek explanation for the current step', async () => {
    const currentStep = step(1, { total: num(3) });
    explainStepMock.mockResolvedValueOnce({
      model: 'deepseek-v4-flash',
      text: 'total is now 3 because the current value was added.',
      usage: { totalTokens: 470 },
    });

    const { container } = render(
      <ExplainerPanel
        code={'total = 1\ntotal += 2'}
        currentStep={currentStep}
        frameIndex={null}
        language="python"
        previousStep={step(0, { total: num(1) })}
        result={result(currentStep)}
      />,
    );

    expect(container.textContent).not.toContain('step 2');
    fireEvent.click(screen.getByRole('button', { name: /explain step/i }));

    await waitFor(() => expect(explainStepMock).toHaveBeenCalledTimes(1));
    expect(explainStepMock.mock.calls[0][0]).toMatchObject({
      code: 'total = 1\ntotal += 2',
      currentStep,
      language: 'python',
    });

    await waitFor(() =>
      expect(container.textContent).toContain(
        'total is now 3 because the current value was added.',
      ),
    );
    expect(container.textContent).not.toContain('Plain-English guide');
    expect(container.textContent).not.toContain('470 tokens');
  });

  it('waits for a trace before allowing explanations', () => {
    render(
      <ExplainerPanel
        code=""
        currentStep={undefined}
        frameIndex={null}
        language="python"
        previousStep={undefined}
        result={null}
      />,
    );

    expect(screen.getByText('Run code to explain a step.')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: /explain step/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
