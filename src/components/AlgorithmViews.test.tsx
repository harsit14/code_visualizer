// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { EncodedValue, TraceStep } from '../engine/types';
import { DataPanel } from './DataPanel';

afterEach(cleanup);

const num = (v: number): EncodedValue => ({ k: 'num', t: 'int', v: String(v) });
const str = (v: string): EncodedValue => ({ k: 'str', v, truncated: false });
const seq = (items: EncodedValue[], t: string, id: number): EncodedValue => ({
  k: 'seq',
  t,
  id,
  items,
  len: items.length,
  truncated: false,
});

function step(locals: Record<string, EncodedValue>, i = 1): TraceStep {
  return {
    i,
    event: 'line',
    phase: 'before',
    line: 3,
    func: '<module>',
    stack: [{ id: 'm', func: '<module>', line: 3, locals }],
    globals: {},
    stdoutLen: 0,
  };
}

function renderPanel(
  locals: Record<string, EncodedValue>,
  previous?: Record<string, EncodedValue>,
  sourceLine: string | null = null,
) {
  render(
    <DataPanel
      analysis={null}
      atLastStep={false}
      currentStep={step(locals)}
      frameIndex={null}
      previousStep={previous ? step(previous, 0) : undefined}
      returnValue={null}
      sourceLine={sourceLine}
    />,
  );
}

describe('algorithm views in the Data panel', () => {
  it('draws a stack top-first and shows what was popped', () => {
    renderPanel(
      { stack: seq([num(1), num(2)], 'list', 1) },
      { stack: seq([num(1), num(2), num(3)], 'list', 1) },
    );
    const stack = screen.getByRole('list', { name: 'stack as a stack, top first' });
    expect(stack.textContent).toBe('3poppedtop21');
  });

  it('draws a heap as a tree and lets the learner switch views', () => {
    renderPanel({ heap: seq([num(1), num(4), num(2)], 'list', 2) });
    expect(screen.getByRole('img', { name: 'heap as a binary heap' })).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'View heap as' }), {
      target: { value: 'queue' },
    });
    expect(screen.getByRole('list', { name: 'heap as a queue, front first' })).toBeTruthy();
  });

  it('draws adjacency lists as a graph with search state', () => {
    renderPanel({
      graph: {
        k: 'dict',
        id: 3,
        entries: [
          [str('A'), seq([str('B')], 'list', 4)],
          [str('B'), seq([str('A')], 'list', 5)],
        ],
        len: 2,
        truncated: false,
      },
      seen: seq([str('A')], 'set', 6),
      node: str('B'),
    });
    expect(screen.getByRole('img', { name: 'graph as an undirected graph' })).toBeTruthy();
    expect(screen.getByText('current: node · visited: seen')).toBeTruthy();
  });

  it('explains a DP recurrence with the cells it read', () => {
    const before = { dp: seq([num(1), num(1), num(0)], 'list', 7), i: num(2) };
    const after = { dp: seq([num(1), num(1), num(2)], 'list', 7), i: num(2) };
    renderPanel(after, before, 'dp[i] = dp[i - 1] + dp[i - 2]');
    expect(screen.getByText('dp[2] = dp[i - 1] + dp[i - 2] → 1 + 1 = 2')).toBeTruthy();
    expect(document.querySelectorAll('.array-cell.is-read')).toHaveLength(2);
  });
});
