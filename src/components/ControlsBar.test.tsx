import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ControlsBar } from './ControlsBar';
import type { RuntimeStatus, TraceStep } from '../engine/types';

const idleStatus: RuntimeStatus = {
  interruptSupported: false,
  message: 'Preparing Python in the background',
  phase: 'idle',
  progress: 0,
  stage: 'idle',
};

const traceStep: TraceStep = {
  event: 'line',
  func: '<module>',
  globals: {},
  i: 0,
  line: 1,
  stack: [{ func: '<module>', id: 'frame-0', line: 1, locals: {} }],
  stdoutLen: 0,
};

function renderControls(overrides: Partial<Parameters<typeof ControlsBar>[0]> = {}) {
  return renderToStaticMarkup(
    <ControlsBar
      breakpointCount={0}
      canRunToBreakpoint={false}
      canRunToCursor={false}
      canStepOver={false}
      cursorLine={null}
      currentStep={undefined}
      exampleId={null}
      isBusy={false}
      onExampleChange={() => {}}
      onJump={() => {}}
      onRun={() => {}}
      onRunToBreakpoint={() => {}}
      onRunToCursor={() => {}}
      onSpeedChange={() => {}}
      onStepBack={() => {}}
      onStepForward={() => {}}
      onStepOver={() => {}}
      onTogglePlay={() => {}}
      playing={false}
      speed={2}
      status={idleStatus}
      step={0}
      totalSteps={0}
      {...overrides}
    />,
  );
}

describe('ControlsBar', () => {
  it('keeps the first-run controls simple before a trace exists', () => {
    const html = renderControls();

    expect(html).toContain('controls-bar-prerun');
    expect(html).toContain('Load an example');
    expect(html).toMatch(/(?:Cmd|Ctrl) Enter/);
    expect(html).not.toContain('Step navigation');
    expect(html).not.toContain('Trace position');
    expect(html).not.toContain('Playback speed');
  });

  it('shows runtime progress while the first trace is being generated', () => {
    const html = renderControls({
      isBusy: true,
      status: {
        interruptSupported: false,
        message: 'Loading Python runtime...',
        phase: 'loading',
        progress: 0.18,
        stage: 'runtime-loading',
      },
    });

    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="18"');
    expect(html).toContain('Loading Python runtime...');
  });

  it('reveals transport controls after a trace exists', () => {
    const html = renderControls({
      currentStep: traceStep,
      totalSteps: 2,
    });

    expect(html).toContain('Step navigation');
    expect(html).toContain('Trace position');
    expect(html).toContain('Playback speed');
    expect(html).not.toContain('controls-bar-prerun');
    expect(html).not.toMatch(/(?:Cmd|Ctrl) Enter/);
  });
});
