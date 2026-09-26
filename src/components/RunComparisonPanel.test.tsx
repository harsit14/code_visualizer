// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRunBaseline } from '../app/useRunBaseline';
import { runJavaScriptTrace } from '../engine/jsTraceEngine';
import fixtures from '../engine/runComparison.fixtures.json';
import type { Language, SessionResult } from '../engine/types';
import { RunComparisonPanel } from './RunComparisonPanel';

afterEach(cleanup);

type Run = { code: string; language: Language; result: SessionResult | null };

function python(name: keyof typeof fixtures): Run {
  return {
    code: fixtures[name].code,
    language: 'python',
    result: structuredClone(fixtures[name].result) as unknown as SessionResult,
  };
}

/** Mirrors the dashboard wiring: the session owns the run, the hook owns the baseline. */
function Harness({
  run,
  isBusy = false,
  onJump,
}: {
  run: Run;
  isBusy?: boolean;
  onJump: () => void;
}) {
  const { baseline, keepBaseline, clearBaseline } = useRunBaseline(run);
  return (
    <RunComparisonPanel
      baseline={baseline}
      code={run.code}
      isBusy={isBusy}
      language={run.language}
      onClearBaseline={clearBaseline}
      onJump={onJump}
      onKeepBaseline={keepBaseline}
      result={run.result}
      step={0}
    />
  );
}

function renderHarness(run: Run) {
  const onJump = vi.fn();
  const view = render(<Harness onJump={onJump} run={run} />);
  const update = (next: Run, isBusy = false) =>
    view.rerender(<Harness isBusy={isBusy} onJump={onJump} run={next} />);
  return { onJump, update };
}

describe('RunComparisonPanel', () => {
  it('keeps a baseline, waits for a fresh run, then shows the first difference and jumps to it', () => {
    const baseline = python('twoSum');
    const { onJump, update } = renderHarness(baseline);
    expect(screen.getByText(/keep the run as a baseline/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Keep as baseline' }));
    expect(screen.getByText(/This run is the baseline/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Use current as baseline' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    // Editing clears the session result: nothing stale may be compared.
    const edited = python('twoSumOffByOne');
    update({ ...edited, result: null });
    expect(screen.getByRole('status').textContent).toMatch(/^Run the current code to compare/);
    update({ ...edited, result: null }, true);
    expect(screen.getByRole('status').textContent).toMatch(/^Running…/);

    update(edited);
    expect(screen.getByRole('status').textContent).toContain('The runs differ');
    const difference = screen.getByRole('region', { name: 'First difference' });
    expect(
      within(difference).getByText(
        'In two_sum(), i went on to 2 in the baseline, but stayed 1 in the current run.',
      ),
    ).toBeTruthy();
    // The baseline side shows its own, older code read-only.
    expect(within(difference).getByLabelText('Baseline line 3').textContent).toContain(
      'for i in range(len(nums)):',
    );
    expect(within(difference).getByLabelText('Current line 8').textContent).toContain('return []');

    fireEvent.click(within(difference).getByRole('button', { name: /^Show step 12/ }));
    expect(onJump).toHaveBeenCalledWith(12);

    const table = screen.getByRole('table', { name: 'Both runs' });
    const result = within(table).getByRole('row', { name: /^Result \(differs\)/ });
    expect(result.textContent).toContain('Returned [1, 2]');
    expect(result.textContent).toContain('Returned []');
    expect(within(table).getByRole('row', { name: /^Inputs / }).textContent).toContain(
      'nums = [3, 2, 4], target = 6',
    );
    expect(screen.queryByText(/inputs differ/)).toBeNull();
  });

  it('shows the same result for a matching re-run and can be cleared', () => {
    const { update } = renderHarness(python('fib'));
    fireEvent.click(screen.getByRole('button', { name: 'Keep as baseline' }));

    update(python('fib'));
    expect(screen.getByRole('status').textContent).toContain('Same result');
    expect(screen.queryByRole('region', { name: 'First difference' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Clear baseline' }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText(/keep the run as a baseline/)).toBeTruthy();
  });

  it('notes different inputs and refuses to compare across languages', () => {
    const { update } = renderHarness(python('lookup'));
    fireEvent.click(screen.getByRole('button', { name: 'Keep as baseline' }));

    update(python('lookupTea'));
    expect(screen.getByText(/The inputs differ/)).toBeTruthy();
    expect(screen.getByRole('row', { name: /^Inputs \(differs\)/ })).toBeTruthy();

    const code = 'console.log(1);';
    update({ code, language: 'javascript', result: runJavaScriptTrace(code, 'javascript') });
    expect(screen.getByRole('status').textContent).toContain(
      'The baseline is Python and the current run is JavaScript.',
    );
  });
});
