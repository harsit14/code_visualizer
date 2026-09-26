// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EncodedValue, SessionResult, TraceStep } from '../engine/types';

const { explainStepMock } = vi.hoisted(() => ({
  explainStepMock: vi.fn(),
}));

vi.mock('../engine/deepseekClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../engine/deepseekClient')>()),
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

  it('previews the exact request and applies redaction before sending', async () => {
    const currentStep = step(1, { total: num(3) });
    explainStepMock.mockResolvedValue({ model: 'm', text: 'Answer.' });
    render(
      <ExplainerPanel
        code={'total = 1\ntotal += 2'}
        currentStep={currentStep}
        frameIndex={null}
        language="python"
        previousStep={step(0, { total: num(1) })}
        result={result(currentStep)}
      />,
    );
    const preview = () => screen.getByText('Preview exactly what will be sent').nextSibling!;
    expect(preview().textContent).toContain('"total": "3"');
    fireEvent.click(screen.getByRole('checkbox', { name: /Variable values/ }));
    expect(preview().textContent).toContain('"total": "<int>"');
    fireEvent.click(screen.getByRole('button', { name: /explain step/i }));
    await waitFor(() => expect(explainStepMock).toHaveBeenCalledTimes(1));
    expect(explainStepMock.mock.calls[0][0].privacy).toMatchObject({ includeValues: false });
  });

  it('shows a local explanation and reuses answers for steps already explained', async () => {
    const first = step(1, { total: num(3) });
    const second = step(2, { total: num(5) });
    explainStepMock.mockResolvedValue({ model: 'm', text: 'First answer.' });
    const props = {
      code: 'total = 1\ntotal += 2',
      language: 'python' as const,
      previousStep: step(0, { total: num(1) }),
      frameIndex: null,
      result: result(first),
      change: {
        kind: 'statement' as const,
        line: 1,
        func: 'the module',
        summary: 'Line 1 ran',
        changes: [{ root: 'total', path: 'total', before: '1', after: '3' }],
        hiddenChanges: 0,
        output: '',
      },
    };
    const view = render(<ExplainerPanel {...props} currentStep={first} />);
    expect(screen.getByRole('region', { name: 'Local explanation' }).textContent).toContain(
      'Line 1 ran.',
    );
    fireEvent.click(screen.getByRole('button', { name: /explain step/i }));
    await waitFor(() => expect(view.container.textContent).toContain('First answer.'));
    view.rerender(<ExplainerPanel {...props} currentStep={second} />);
    expect(view.container.textContent).not.toContain('First answer.');
    view.rerender(<ExplainerPanel {...props} currentStep={first} />);
    expect(view.container.textContent).toContain('First answer.');
    expect(explainStepMock).toHaveBeenCalledTimes(1);
  });

  it('explains that AI is unavailable on hosts without the service', () => {
    const currentStep = step(1, { total: num(3) });
    render(
      <ExplainerPanel
        available={false}
        code="total = 3"
        currentStep={currentStep}
        frameIndex={null}
        language="python"
        previousStep={undefined}
        result={result(currentStep)}
      />,
    );
    expect(screen.getByText(/not available on this deployment/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: /explain step/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('keeps the local explanation and disables AI requests offline', () => {
    const currentStep = step(1, { total: num(3) });
    render(
      <ExplainerPanel
        code="total = 3"
        currentStep={currentStep}
        frameIndex={null}
        language="python"
        offline
        previousStep={undefined}
        result={result(currentStep)}
      />,
    );
    expect(screen.getByText(/You are offline. AI explanations need a connection/)).toBeTruthy();
    expect(screen.queryByText('Include in the request')).toBeNull();
    expect(
      (screen.getByRole('button', { name: /explain step/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
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
