// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkpointNavigation } from '../engine/traceCheckpoints';
import { PresentationBar } from './PresentationBar';

afterEach(cleanup);

const checkpoints = [
  { step: 8, note: 'Pointers meet' },
  { step: 3, note: '' },
];
const order = checkpoints.map((checkpoint) => checkpoint.step);

function renderBar(step: number) {
  const props = {
    checkpoints,
    navigation: checkpointNavigation(order, step),
    onExit: vi.fn(),
    onJump: vi.fn(),
    onToggleTheme: vi.fn(),
    theme: 'dark' as const,
  };
  const view = render(<PresentationBar {...props} />);
  return { props, ...view };
}

describe('PresentationBar', () => {
  it('announces the current checkpoint caption in a polite live region', () => {
    renderBar(8);
    const caption = screen.getByRole('status');
    expect(caption.getAttribute('aria-live')).toBe('polite');
    expect(caption.textContent).toBe('Checkpoint 1 of 2 · step 8Pointers meet');
    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Presentation' }));
  });

  it('navigates in presenter order and keeps unavailable directions focusable', () => {
    const { props, rerender } = renderBar(8);
    const previous = screen.getByRole('button', { name: /Previous checkpoint/ });
    expect(previous.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(previous);
    expect(props.onJump).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Next checkpoint/ }));
    expect(props.onJump).toHaveBeenCalledWith(3);

    rerender(<PresentationBar {...props} navigation={checkpointNavigation(order, 3)} />);
    expect(screen.getByRole('status').textContent).toBe(
      'Checkpoint 2 of 2 · step 3No note for this checkpoint.',
    );
    expect(
      screen.getByRole('button', { name: /Next checkpoint/ }).getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('points to the next checkpoint between checkpoints and exits on request', () => {
    const { props } = renderBar(1);
    expect(screen.getByRole('status').textContent).toBe('');
    expect(screen.getByText('Between checkpoints. Next: checkpoint 2 at step 3.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Exit presentation' }));
    expect(props.onExit).toHaveBeenCalled();
  });

  it('explains how to add checkpoints when there are none', () => {
    render(
      <PresentationBar
        checkpoints={[]}
        navigation={checkpointNavigation([], 0)}
        onExit={vi.fn()}
        onJump={vi.fn()}
        onToggleTheme={vi.fn()}
        theme="light"
      />,
    );
    expect(screen.getByText(/No checkpoints yet/)).toBeTruthy();
  });
});
