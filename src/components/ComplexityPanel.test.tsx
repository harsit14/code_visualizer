// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComplexityPanel } from './ComplexityPanel';
import type { ComplexityResult, FunctionInfo } from '../engine/types';

const twoSum: FunctionInfo = {
  name: 'twoSum',
  qualname: 'twoSum',
  className: null,
  params: [
    { name: 'nums', inferred: 'list[int]', annotation: 'list[int]', source: 'hint' },
    { name: 'target', inferred: 'int', annotation: 'int', source: 'hint' },
  ],
  line: 1,
  isGenerator: false,
  docstring: null,
  returns: null,
};

const measured: ComplexityResult = {
  functionName: 'twoSum',
  seed: 1234,
  error: null,
  truncated: true,
  truncationReason: 'Stopped at n=512: Step limit of 1,000,000 trace events reached.',
  dimension: {
    id: 'nums',
    param: 'nums',
    axis: 'len',
    kind: 'list[int]',
    meaning: 'n = len(nums)',
    maxN: 1024,
  },
  fixed: [{ name: 'target', literal: '-1', source: 'generated' }],
  samples: [
    { n: 4, ops: 24, ms: 0.4, status: 'ok', error: null, note: null },
    { n: 8, ops: 76, ms: 0.9, status: 'ok', error: null, note: null },
    {
      n: 16,
      ops: 12,
      ms: 0.2,
      status: 'exception',
      error: { type: 'IndexError', msg: 'list index out of range' },
      note: null,
    },
    { n: 32, ops: 1060, ms: 3.1, status: 'ok', error: null, note: null },
    {
      n: 512,
      ops: 1_000_001,
      ms: 900,
      status: 'step-limit',
      error: null,
      note: 'Step limit of 1,000,000 trace events reached; execution was stopped.',
    },
    {
      n: 1024,
      ops: 0,
      ms: null,
      status: 'skipped',
      error: null,
      note: 'Skipped: n=512 already hit the step limit.',
    },
  ],
  fit: {
    model: 'n^2',
    label: 'O(n²)',
    error: 0.017,
    quality: 'good',
    samplesUsed: 3,
    runnerUp: null,
    curve: [
      { n: 4, ops: 24 },
      { n: 16, ops: 280 },
      { n: 32, ops: 1060 },
    ],
  },
  caveats: ['Only 3 samples finished, so treat this as a rough guess.'],
  structure: {
    label: 'O(n²)',
    loopDepth: 2,
    recursive: false,
    notes: ['Loops nest 2 levels deep.'],
  },
  limits: { maxSteps: 1_000_000, maxSeconds: 4 },
};

afterEach(cleanup);

describe('ComplexityPanel', () => {
  it('lets the learner choose what grows and the sampled sizes', () => {
    const onMeasure = vi.fn();
    render(
      <ComplexityPanel
        busy={false}
        canMeasure={true}
        fn={twoSum}
        inputs={['[2, 7, 11, 15]', '9']}
        language="python"
        onMeasure={onMeasure}
        result={null}
      />,
    );

    expect(screen.getByText('n = len(nums)')).toBeTruthy();
    expect(screen.getByText(/sampled at n = 4, 8, 16, 32, 64/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Grow'), { target: { value: 'target' } });
    fireEvent.change(screen.getByLabelText('To n'), { target: { value: '256' } });
    fireEvent.change(screen.getByLabelText('Samples'), { target: { value: '3' } });
    expect(screen.getByText('n = target')).toBeTruthy();
    expect(screen.getByText(/sampled at n = 4, 32, 256/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /estimate complexity/i }));
    expect(onMeasure).toHaveBeenCalledWith({
      param: 'target',
      axis: 'value',
      sizes: [4, 32, 256],
      inputs: ['[2, 7, 11, 15]', '9'],
    });

    fireEvent.click(screen.getByRole('checkbox', { name: /hold nums at the current input/i }));
    fireEvent.click(screen.getByRole('button', { name: /estimate complexity/i }));
    expect(onMeasure).toHaveBeenLastCalledWith({
      param: 'target',
      axis: 'value',
      sizes: [4, 32, 256],
      inputs: undefined,
    });
  });

  it('shows every sample, including failures, with the fit and its evidence', () => {
    render(
      <ComplexityPanel
        busy={false}
        canMeasure={true}
        fn={twoSum}
        language="python"
        onMeasure={() => {}}
        result={measured}
      />,
    );

    const results = screen.getByRole('region', { name: 'Complexity results' });
    expect(within(results).getByText('≈ O(n²)')).toBeTruthy();
    expect(within(results).getByText('Measured growth')).toBeTruthy();
    expect(
      within(results).getByText('Good fit: typical error 2%, from 3 of 6 samples'),
    ).toBeTruthy();

    const rows = within(screen.getByRole('table', { name: 'Sampled sizes' })).getAllByRole('row');
    expect(rows.map((row) => row.textContent)).toEqual([
      'nStepsTimeResult',
      '424<1 msok',
      '876<1 msok',
      '16—<1 msraised IndexErrorlist index out of range',
      '321,0603.1 msok',
      '512>1,000,000900 msstep limit hitStep limit of 1,000,000 trace events reached; execution was stopped.',
      '1024——skippedSkipped: n=512 already hit the step limit.',
    ]);

    expect(within(results).getByText('Code structure suggests')).toBeTruthy();
    expect(within(results).getByText(/heuristic from loop nesting/)).toBeTruthy();
    expect(within(results).getByText(/evidence, not a proof of Big-O/)).toBeTruthy();
    expect(within(results).getByText(/trace events in your code/)).toBeTruthy();
    expect(
      within(results).getByText('Only 3 samples finished, so treat this as a rough guess.'),
    ).toBeTruthy();
    expect(screen.getByText(/Growth estimate may be biased toward smaller inputs/)).toBeTruthy();
    expect(within(results).getByText(/held/).textContent).toContain('target = -1');
  });

  it('draws the chart with measured dots, the fitted curve and failed marks', () => {
    const { container } = render(
      <ComplexityPanel
        busy={false}
        canMeasure={true}
        fn={twoSum}
        language="python"
        onMeasure={() => {}}
        result={measured}
      />,
    );

    const chart = screen.getByRole('img');
    expect(chart.getAttribute('aria-labelledby')).toBeTruthy();
    expect(chart.textContent).toContain(
      'Steps against n for 3 finished samples with the fitted O(n²) curve; 2 failed sizes marked on the n axis.',
    );
    expect(container.querySelectorAll('.complexity-dot')).toHaveLength(3);
    expect(container.querySelectorAll('.complexity-failed-mark')).toHaveLength(2);
    expect(container.querySelector('.complexity-fit-line')?.getAttribute('d')).toMatch(/^M/);
    expect(screen.getByText('fitted O(n²)')).toBeTruthy();
    expect(screen.getByText(/failed \(not fitted\)/)).toBeTruthy();
  });

  it('keeps Stop available while measuring', () => {
    const onStop = vi.fn();
    render(
      <ComplexityPanel
        busy={true}
        canMeasure={false}
        fn={twoSum}
        language="python"
        onMeasure={() => {}}
        onStop={onStop}
        result={null}
      />,
    );

    expect((screen.getByRole('button', { name: /measuring/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: /stop/i }));
    expect(onStop).toHaveBeenCalledOnce();
  });

  it('labels JavaScript as unsupported and explains a missing fit', () => {
    const { rerender } = render(
      <ComplexityPanel
        busy={false}
        canMeasure={false}
        fn={null}
        language="javascript"
        onMeasure={() => {}}
        result={null}
      />,
    );
    expect(screen.getByText(/JavaScript and TypeScript are not measured yet/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: /estimate complexity/i }) as HTMLButtonElement).disabled,
    ).toBe(true);

    rerender(
      <ComplexityPanel
        busy={false}
        canMeasure={true}
        fn={twoSum}
        language="python"
        onMeasure={() => {}}
        result={{
          ...measured,
          truncated: false,
          fit: null,
          samples: measured.samples.slice(0, 3),
        }}
      />,
    );
    expect(screen.getByText('not enough data')).toBeTruthy();
    expect(screen.getByText('Needs at least 3 finished samples; 2 of 3 finished.')).toBeTruthy();
  });
});
