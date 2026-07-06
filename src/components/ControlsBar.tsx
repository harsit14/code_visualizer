/**
 * Transport controls: run, play/pause, step back/forward, jump-to-step,
 * a scrubber over the whole trace, and a playback speed slider.
 */
import type { ReactNode } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  CircleDot,
  CornerDownRight,
  Crosshair,
  Gauge,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import { CUSTOM_CODE_ID, examples } from '../examples/examples';
import type { RuntimeStatus, TraceStep } from '../engine/types';

type ControlsBarProps = {
  isBusy: boolean;
  onRun: () => void;
  exampleId: string | null;
  onExampleChange: (id: string) => void;
  playing: boolean;
  onTogglePlay: () => void;
  step: number;
  totalSteps: number;
  onJump: (step: number) => void;
  onStepBack: () => void;
  onStepForward: () => void;
  onRunToBreakpoint: () => void;
  onRunToCursor: () => void;
  onStepOver: () => void;
  canRunToBreakpoint: boolean;
  canRunToCursor: boolean;
  canStepOver: boolean;
  breakpointCount: number;
  cursorLine: number | null;
  speed: number;
  onSpeedChange: (speed: number) => void;
  currentStep: TraceStep | undefined;
  status: RuntimeStatus;
};

function describeStep(step: TraceStep | undefined): string {
  if (!step) {
    return 'No trace yet';
  }
  const where = step.func === '<module>' ? 'module' : `${step.func}()`;
  return `${step.event} · line ${step.line} · ${where}`;
}

function ControlTip({ children, text }: { children: ReactNode; text: string }) {
  return (
    <span className="control-tip" title={text}>
      {children}
    </span>
  );
}

function RuntimeProgress({ status }: { status: RuntimeStatus }) {
  const showProgress =
    status.phase === 'loading' ||
    status.phase === 'running' ||
    status.phase === 'interrupting' ||
    status.phase === 'restarting';

  if (!showProgress) {
    return null;
  }

  const progressPercent = Math.round(Math.min(Math.max(status.progress ?? 0.35, 0), 1) * 100);

  return (
    <div
      aria-label={status.message}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={progressPercent}
      className="runtime-progress"
      role="progressbar"
    >
      <span className="runtime-progress-label">{status.message}</span>
      <span className="runtime-progress-track" aria-hidden="true">
        <span className="runtime-progress-bar" style={{ width: `${progressPercent}%` }} />
      </span>
    </div>
  );
}

export function ControlsBar({
  isBusy,
  onRun,
  exampleId,
  onExampleChange,
  playing,
  onTogglePlay,
  step,
  totalSteps,
  onJump,
  onStepBack,
  onStepForward,
  onRunToBreakpoint,
  onRunToCursor,
  onStepOver,
  canRunToBreakpoint,
  canRunToCursor,
  canStepOver,
  breakpointCount,
  cursorLine,
  speed,
  onSpeedChange,
  currentStep,
  status,
}: ControlsBarProps) {
  const hasTrace = totalSteps > 0;
  const categories = [...new Set(examples.map((example) => example.category))];
  const runShortcutLabel =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform)
      ? 'Cmd Enter'
      : 'Ctrl Enter';
  const runTitle = isBusy ? 'Runtime is working' : 'Run the current code with the current inputs';
  const startTitle = hasTrace ? 'Jump to the first recorded step' : 'Run code first';
  const backTitle = hasTrace ? 'Move one recorded step backward' : 'Run code first';
  const playTitle = playing
    ? 'Pause automatic playback'
    : hasTrace
      ? 'Play the trace automatically'
      : 'Run code first';
  const forwardTitle = hasTrace ? 'Move one recorded step forward' : 'Run code first';
  const endTitle = hasTrace ? 'Jump to the final recorded step' : 'Run code first';
  const stepOverTitle = canStepOver
    ? 'Step over nested calls and stop at the next step in this frame'
    : hasTrace
      ? 'No later step is available to step over'
      : 'Run code first';
  const breakpointTitle =
    breakpointCount === 0
      ? 'Set a breakpoint in the editor gutter first'
      : !hasTrace
        ? 'Run code first'
      : canRunToBreakpoint
        ? `Jump to a breakpoint step (${breakpointCount} set)`
        : 'No breakpoint line appears elsewhere in this trace';
  const cursorTitle =
    cursorLine === null
      ? 'Click a code line first'
      : !hasTrace
        ? 'Run code first'
      : canRunToCursor
        ? `Jump to an execution step on line ${cursorLine}`
        : `Line ${cursorLine} does not appear elsewhere in this trace`;
  const scrubberTitle = hasTrace ? 'Drag to jump through recorded steps' : 'Run code first';
  const stepJumpTitle = hasTrace ? 'Type a recorded step number to jump there' : 'Run code first';
  const speedTitle = `Playback speed: ${speed} steps per second`;
  const resetTitle = hasTrace ? 'Reset the trace to the first step' : 'Run code first';

  return (
    <footer
      className={`controls-bar${hasTrace ? '' : ' controls-bar-prerun'}`}
      aria-label="Playback controls"
    >
      <ControlTip text={runTitle}>
        <button className="run-button" disabled={isBusy} onClick={onRun} type="button">
          <Play size={14} />
          {isBusy ? 'Working…' : 'Run'}
          {!hasTrace && !isBusy ? <span className="run-shortcut-badge">{runShortcutLabel}</span> : null}
        </button>
      </ControlTip>

      {!hasTrace ? (
        <div className="pretrace-actions">
          <select
            aria-label="Load example"
            className="pretrace-example-select"
            onChange={(event) => onExampleChange(event.target.value)}
            value={exampleId ?? CUSTOM_CODE_ID}
          >
            <option disabled value={CUSTOM_CODE_ID}>
              Load an example
            </option>
            {categories.map((category) => (
              <optgroup key={category} label={category}>
                {examples
                  .filter((example) => example.category === category)
                  .map((example) => (
                    <option key={example.id} value={example.id}>
                      {example.title}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          <RuntimeProgress status={status} />
        </div>
      ) : (
        <>
          <div className="transport" role="group" aria-label="Step navigation">
            <ControlTip text={startTitle}>
              <button disabled={!hasTrace || step === 0} onClick={() => onJump(0)} type="button">
                <SkipBack size={15} />
              </button>
            </ControlTip>
            <ControlTip text={backTitle}>
              <button disabled={!hasTrace || step === 0} onClick={onStepBack} type="button">
                <ChevronLeft size={16} />
              </button>
            </ControlTip>
            <ControlTip text={playTitle}>
              <button
                className="play-toggle"
                disabled={totalSteps <= 1}
                onClick={onTogglePlay}
                type="button"
              >
                {playing ? <Pause size={16} /> : <Play size={16} />}
              </button>
            </ControlTip>
            <ControlTip text={forwardTitle}>
              <button
                disabled={!hasTrace || step >= totalSteps - 1}
                onClick={onStepForward}
                type="button"
              >
                <ChevronRight size={16} />
              </button>
            </ControlTip>
            <ControlTip text={endTitle}>
              <button
                disabled={!hasTrace || step >= totalSteps - 1}
                onClick={() => onJump(totalSteps - 1)}
                type="button"
              >
                <SkipForward size={15} />
              </button>
            </ControlTip>
            <ControlTip text={stepOverTitle}>
              <button
                aria-label="Step over"
                className="debug-nav-button"
                disabled={!canStepOver}
                onClick={onStepOver}
                type="button"
              >
                <CornerDownRight size={15} />
              </button>
            </ControlTip>
            <ControlTip text={breakpointTitle}>
              <button
                aria-label="Run to breakpoint"
                className="debug-nav-button"
                disabled={!canRunToBreakpoint}
                onClick={onRunToBreakpoint}
                type="button"
              >
                <CircleDot size={15} />
              </button>
            </ControlTip>
            <ControlTip text={cursorTitle}>
              <button
                aria-label="Run to cursor"
                className="debug-nav-button"
                disabled={!canRunToCursor}
                onClick={onRunToCursor}
                type="button"
              >
                <Crosshair size={15} />
              </button>
            </ControlTip>
          </div>

          <div className="scrubber" title={scrubberTitle}>
            <input
              aria-label="Trace position"
              disabled={!hasTrace}
              max={Math.max(totalSteps - 1, 0)}
              min={0}
              onChange={(event) => onJump(Number(event.target.value))}
              title={scrubberTitle}
              type="range"
              value={step}
            />
            <div className="scrubber-meta">
              <span className="step-meta">{describeStep(currentStep)}</span>
              <span className="step-count">
                <input
                  aria-label="Jump to step"
                  className="step-jump"
                  disabled={!hasTrace}
                  max={Math.max(totalSteps - 1, 0)}
                  min={0}
                  onChange={(event) => onJump(Number(event.target.value))}
                  title={stepJumpTitle}
                  type="number"
                  value={hasTrace ? step : 0}
                />
                / {Math.max(totalSteps - 1, 0)}
              </span>
            </div>
          </div>

          <div className="speed-control" title={speedTitle}>
            <Gauge size={14} />
            <input
              aria-label="Playback speed"
              max={16}
              min={0.5}
              onChange={(event) => onSpeedChange(Number(event.target.value))}
              step={0.5}
              title={speedTitle}
              type="range"
              value={speed}
            />
            <span>{speed}×</span>
          </div>

          <ControlTip text={resetTitle}>
            <button
              className="ghost-button"
              disabled={!hasTrace}
              onClick={() => onJump(0)}
              type="button"
            >
              <RotateCcw size={14} />
            </button>
          </ControlTip>
        </>
      )}
    </footer>
  );
}
