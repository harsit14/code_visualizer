// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StepChange } from '../engine/stepChange';
import { StepChangeCard } from './StepChangeCard';

afterEach(cleanup);

const change: StepChange = {
  kind: 'statement',
  line: 2,
  func: 'the module',
  summary: 'Line 2 ran',
  changes: [
    { root: 'lookup', path: 'lookup[11]', before: null, after: '0' },
    { root: 'total', path: 'total', before: '3', after: '6' },
  ],
  hiddenChanges: 2,
  output: 'done\n',
};

describe('StepChangeCard', () => {
  it('shows the responsible source line, each change and printed output', () => {
    const onFocusLine = vi.fn();
    render(
      <StepChangeCard
        change={change}
        code={'lookup = {}\nlookup[11] = total - 3\nprint("done")'}
        onFocusLine={onFocusLine}
        watchedVariables={[]}
      />,
    );
    expect(screen.getByRole('region', { name: 'What just happened' })).toBeTruthy();
    expect(screen.getByText('lookup[11] = total - 3')).toBeTruthy();
    expect(screen.getByText('absent')).toBeTruthy();
    expect(screen.getByText('+2 more changes')).toBeTruthy();
    expect(screen.getByText('done')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Line 2' }));
    expect(onFocusLine).toHaveBeenCalledWith(2);
  });

  it('pins a changed variable to Watch once', () => {
    const onWatch = vi.fn();
    render(
      <StepChangeCard change={change} code="" onWatch={onWatch} watchedVariables={['total']} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Pin lookup to Watch' }));
    expect(onWatch).toHaveBeenCalledWith('lookup');
    expect(
      (screen.getByRole('button', { name: 'total is pinned to Watch' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('renders nothing without an explanation', () => {
    const { container } = render(<StepChangeCard change={null} code="" watchedVariables={[]} />);
    expect(container.innerHTML).toBe('');
  });
});
