// @vitest-environment jsdom
/**
 * Presentation mode end to end in the dashboard: entering and leaving it,
 * restoring the user's layout, read-only code, hidden editing chrome and
 * checkpoint captions from an imported trace.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runJavaScriptTrace } from '../engine/jsTraceEngine';

// No Pyodide worker in jsdom: analysis requests simply never settle.
vi.mock('../engine/pythonRuntime', () => {
  const client = {
    cancel: vi.fn(),
    dispose: vi.fn(),
    prewarm: vi.fn(),
    request: vi.fn(() => new Promise(() => {})),
    retry: vi.fn(),
    setStatusHandler: vi.fn(),
  };
  return {
    clearPythonRuntimeStatusHandler: vi.fn(),
    getPythonRuntimeClient: () => client,
    prewarmPythonRuntime: vi.fn(),
  };
});

// CodeMirror needs layout APIs jsdom lacks; the stub exposes what the shell passes it.
vi.mock('../components/EditorPanel', () => ({
  EditorPanel: (props: { code: string; readOnly?: boolean; onToggleBreakpoint?: unknown }) => (
    <section aria-label="Code editor" className="panel editor-panel">
      <textarea
        aria-label="Source"
        data-breakpoints={props.onToggleBreakpoint ? 'on' : 'off'}
        readOnly={props.readOnly}
        value={props.code}
        onChange={() => {}}
      />
    </section>
  ),
}));

import { DashboardApp } from './App';

const code = [
  'let total = 0;',
  'for (const n of [1, 2, 3]) {',
  '  total += n;',
  '}',
  'console.log(total);',
].join('\n');
const trace = {
  version: 2,
  code,
  language: 'javascript',
  step: 0,
  result: runJavaScriptTrace(code, 'javascript'),
  bookmarks: [
    { step: 2, note: 'Loop starts' },
    { step: 4, note: 'Total grows' },
  ],
  // Presented out of trace order on purpose.
  checkpoints: [4, 2],
};

const storage = new Map<string, string>();
let phone = false;

function stubBrowser() {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: query === '(max-width: 720px)' && phone,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 404 })),
  );
}

async function importTrace() {
  // The trace import input, not the workspace library's backup restore.
  const input = document.querySelector<HTMLInputElement>('.top-actions > input[type="file"]')!;
  const text = JSON.stringify(trace);
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [{ size: text.length, text: async () => text }],
  });
  await act(async () => {
    fireEvent.change(input);
  });
}

const press = (key: string) => fireEvent.keyDown(window, { key });
const visiblePanels = () =>
  [...document.querySelectorAll<HTMLElement>('.panel-slot')]
    .filter((slot) => !slot.hidden)
    .map((slot) => slot.dataset.panelId);
const workbenchColumns = () =>
  document.querySelector<HTMLElement>('.workbench')!.style.getPropertyValue('--workbench-columns');

beforeEach(() => {
  storage.clear();
  storage.set('cv-dashboard-onboarding-v1', 'dismissed');
  phone = false;
  stubBrowser();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('presentation mode', () => {
  it('shows a focused, read-only stage and restores the user layout on exit', async () => {
    render(<DashboardApp onOpenLanding={() => {}} />);
    await importTrace();

    // A personal layout: Watch on, Call stack off.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Watch' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Call stack' }));
    const before = { panels: visiblePanels(), columns: workbenchColumns() };
    const storedLayout = storage.get('cv-panel-visibility-v2');
    expect(before.panels).toEqual(['code', 'data', 'variables', 'watch', 'console']);
    expect(screen.getByRole('textbox', { name: 'Source' }).hasAttribute('readonly')).toBe(false);

    press('p');
    expect(visiblePanels()).toEqual(['code', 'data', 'variables', 'console']);
    expect(workbenchColumns()).not.toBe(before.columns);
    expect(document.querySelector('.top-bar')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open workspace menu' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Run/ })).toBeNull();
    expect(screen.queryByRole('spinbutton', { name: 'Jump to step' })).toBeNull();
    expect(document.querySelector('.trace-finder')).toBeNull();
    expect(document.querySelectorAll('[role="separator"]')).toHaveLength(0);
    const source = screen.getByRole('textbox', { name: 'Source' });
    expect(source.hasAttribute('readonly')).toBe(true);
    expect(source.dataset.breakpoints).toBe('off');
    expect(screen.getByRole('slider', { name: 'Trace position' })).toBeTruthy();
    // Editing shortcuts pause while presenting.
    press('b');
    expect(document.querySelectorAll('.scrubber-bookmark')).toHaveLength(2);

    press('Escape');
    expect(visiblePanels()).toEqual(before.panels);
    expect(workbenchColumns()).toBe(before.columns);
    expect(storage.get('cv-panel-visibility-v2')).toBe(storedLayout);
    expect(screen.getByRole('textbox', { name: 'Source' }).hasAttribute('readonly')).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Present' }));

    fireEvent.click(screen.getByRole('button', { name: 'Present' }));
    expect(screen.getByRole('region', { name: 'Presentation' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Exit presentation' }));
    expect(visiblePanels()).toEqual(before.panels);
  });

  it('captions imported checkpoints and jumps between them in presenter order', async () => {
    render(<DashboardApp onOpenLanding={() => {}} />);
    await importTrace();
    press('P');
    const bar = screen.getByRole('region', { name: 'Presentation' });
    const caption = within(bar).getByRole('status');
    expect(caption.textContent).toBe('');
    expect(within(bar).getByText(/Next: checkpoint 2 at step 2/)).toBeTruthy();

    press(']');
    expect(caption.textContent).toBe('Checkpoint 2 of 2 · step 2Loop starts');
    const slider = screen.getByRole<HTMLInputElement>('slider', { name: 'Trace position' });
    expect(slider.value).toBe('2');

    press('PageUp');
    expect(caption.textContent).toBe('Checkpoint 1 of 2 · step 4Total grows');
    expect(slider.value).toBe('4');

    fireEvent.click(within(bar).getByRole('button', { name: /Next checkpoint/ }));
    expect(slider.value).toBe('2');
    press('ArrowRight');
    expect(caption.textContent).toBe('');
    expect(slider.value).toBe('3');
  });

  it('pauses playback on each checkpoint while presenting', async () => {
    render(<DashboardApp onOpenLanding={() => {}} />);
    await importTrace();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      press('p');
      const slider = screen.getByRole<HTMLInputElement>('slider', { name: 'Trace position' });
      const tick = (ms: number) => act(() => vi.advanceTimersByTime(ms));
      press(' ');
      tick(500);
      expect(slider.value).toBe('1');
      tick(500);
      expect(slider.value).toBe('2');
      tick(1500);
      expect(slider.value).toBe('2');
      expect(screen.getByRole('button', { name: 'Play trace' })).toBeTruthy();
      press(' ');
      tick(1000);
      expect(slider.value).toBe('4');
      tick(1000);
      expect(slider.value).toBe('4');
    } finally {
      vi.useRealTimers();
    }
  });

  it('degrades to tabs without Inputs at phone width', async () => {
    phone = true;
    render(<DashboardApp onOpenLanding={() => {}} />);
    await importTrace();
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    press('p');
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Code',
      'Visualize',
      'Inspect',
    ]);
    // Only the presentation panels exist; the Code tab shows the editor.
    expect(
      [...document.querySelectorAll<HTMLElement>('.panel-slot')].map(
        (slot) => slot.dataset.panelId,
      ),
    ).toEqual(['code', 'data', 'variables', 'console']);
    expect(visiblePanels()).toEqual(['code']);
    press('Escape');
    expect(screen.getAllByRole('tab')).toHaveLength(4);
  });
});
