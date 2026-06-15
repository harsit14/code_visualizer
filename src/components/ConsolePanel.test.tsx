import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConsolePanel } from './ConsolePanel';
import type { SessionResult, TraceStep } from '../engine/types';

const failingStep: TraceStep = {
  i: 0,
  event: 'exception',
  line: 8,
  func: 'solve',
  stack: [],
  globals: {},
  stdoutLen: 0,
  exc: { type: 'IndexError', msg: 'list index out of range' },
};

describe('ConsolePanel', () => {
  it('renders friendly explanations for known exceptions', () => {
    const result: SessionResult = {
      status: 'error',
      mode: 'function',
      analysis: null,
      durationMs: 10,
      error: null,
      run: {
        functionName: 'solve',
        inputs: [],
        seed: null,
        steps: [failingStep],
        returnValue: null,
        exception: { type: 'IndexError', msg: 'list index out of range', line: 8 },
        setupError: null,
        stdout: '',
        stderr: '',
        opCount: 1,
        truncated: false,
        truncationReason: null,
      },
    };

    const html = renderToStaticMarkup(
      <ConsolePanel
        atLastStep={true}
        canMeasureComplexity={false}
        complexity={null}
        complexityBusy={false}
        currentStep={failingStep}
        onMeasureComplexity={() => {}}
        result={result}
      />,
    );

    expect(html).toContain('IndexError: list index out of range');
    expect(html).toContain('An index went outside the sequence.');
    expect(html).toContain('Compare the index with the sequence length.');
  });

  it('warns when complexity measurement stops early', () => {
    const html = renderToStaticMarkup(
      <ConsolePanel
        atLastStep={false}
        canMeasureComplexity={true}
        complexity={{
          functionName: 'fib',
          seed: 1,
          samples: [
            { n: 4, ops: 25 },
            { n: 8, ops: 120 },
          ],
          error: null,
          truncated: true,
          truncationReason: 'Stopped at n=16: Execution exceeded 4s and was stopped.',
        }}
        complexityBusy={false}
        currentStep={undefined}
        onMeasureComplexity={() => {}}
        result={null}
      />,
    );

    expect(html).toContain('Stopped at n=16');
    expect(html).toContain('Growth estimate may be biased toward smaller inputs.');
  });
});
