// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runJavaScriptTrace } from '../engine/jsTraceEngine';
import { TraceFinder } from './TraceFinder';

afterEach(cleanup);

const result = runJavaScriptTrace(
  'let total = 0;\nfor (const n of [2, 4]) {\n  total += n;\n}\nconsole.log(total);',
  'javascript',
);
const steps = result.run!.steps;

function renderFinder(overrides: Partial<Parameters<typeof TraceFinder>[0]> = {}) {
  const props = {
    bookmarks: [],
    onBookmarkNote: vi.fn(),
    onJump: vi.fn(),
    onToggleBookmark: vi.fn(),
    step: 0,
    steps,
    stdout: result.run!.stdout,
    ...overrides,
  };
  render(<TraceFinder {...props} />);
  return props;
}

describe('TraceFinder', () => {
  it('searches variable changes and jumps to a result', async () => {
    const props = renderFinder();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search the trace' }), {
      target: { value: 'total = 6' },
    });
    expect(await screen.findByText('1 matching step.')).toBeTruthy();
    fireEvent.click(screen.getByText('total: 2 → 6'));
    const firstSix = steps.findIndex((step) => {
      const total = step.stack[0]?.locals.total;
      return total?.k === 'num' && total.v === '6';
    });
    expect(props.onJump).toHaveBeenCalledWith(firstSix);
  });

  it('reports when nothing matches', async () => {
    renderFinder();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search the trace' }), {
      target: { value: 'line 99' },
    });
    expect(await screen.findByText('No matching steps.')).toBeTruthy();
  });

  it('toggles bookmarks, edits notes and jumps to bookmarked steps', () => {
    const props = renderFinder({ bookmarks: [{ step: 3, note: 'loop' }], step: 3 });
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove bookmark on step 3', pressed: true }),
    );
    expect(props.onToggleBookmark).toHaveBeenCalledWith(3);
    fireEvent.change(screen.getByRole('textbox', { name: 'Note for step 3' }), {
      target: { value: 'second pass' },
    });
    expect(props.onBookmarkNote).toHaveBeenCalledWith(3, 'second pass');
    fireEvent.click(screen.getAllByText('Step 3')[0]);
    expect(props.onJump).toHaveBeenCalledWith(3);
  });

  it('opens and focuses the search box on request', () => {
    const { rerender } = render(
      <TraceFinder
        bookmarks={[]}
        onBookmarkNote={vi.fn()}
        onJump={vi.fn()}
        onToggleBookmark={vi.fn()}
        step={0}
        steps={steps}
        stdout=""
      />,
    );
    const details = document.querySelector('details')!;
    expect(details.open).toBe(false);
    rerender(
      <TraceFinder
        bookmarks={[]}
        onBookmarkNote={vi.fn()}
        onJump={vi.fn()}
        onToggleBookmark={vi.fn()}
        openRequest={1}
        step={0}
        steps={steps}
        stdout=""
      />,
    );
    expect(details.open).toBe(true);
    expect(document.activeElement).toBe(
      screen.getByRole('searchbox', { name: 'Search the trace' }),
    );
  });
});
