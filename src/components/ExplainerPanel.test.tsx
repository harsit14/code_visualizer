// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('aborts and ignores late explanations when the selected snapshot changes', async () => {
    let resolve!: (value: { text: string; model: string }) => void;
    explainStepMock.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const first = step(0, { x: num(1) });
    const props = {
      code: 'x = 1',
      language: 'python' as const,
      currentStep: first,
      previousStep: undefined,
      frameIndex: null,
      result: result(first),
    };
    const view = render(<ExplainerPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /explain step/i }));
    const signal = explainStepMock.mock.calls[0][0].signal as AbortSignal;
    view.rerender(<ExplainerPanel {...props} currentStep={step(1, { x: num(2) })} />);
    expect(signal.aborted).toBe(true);
    await act(async () => {
      resolve({ text: 'Obsolete explanation', model: 'test' });
    });
    expect(view.container.textContent).not.toContain('Obsolete explanation');
    expect(
      (screen.getByRole('button', { name: /explain step/i }) as HTMLButtonElement).disabled,
    ).toBe(false);
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
