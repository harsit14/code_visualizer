/**
 * Transport controls: run, play/pause, step back/forward, jump-to-step,
 * a scrubber over the whole trace, and a playback speed slider.
 */
import {
  ChevronLeft,
  ChevronRight,
  Gauge,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import type { TraceStep } from '../engine/types';

type ControlsBarProps = {
  isBusy: boolean;
  onRun: () => void;
  playing: boolean;
  onTogglePlay: () => void;
  step: number;
  totalSteps: number;
  onJump: (step: number) => void;
  onStepBack: () => void;
  onStepForward: () => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
  currentStep: TraceStep | undefined;
};

function describeStep(step: TraceStep | undefined): string {
  if (!step) {
    return 'No trace yet';
  }
  const where = step.func === '<module>' ? 'module' : `${step.func}()`;
  return `${step.event} · line ${step.line} · ${where}`;
}

export function ControlsBar({
  isBusy,
  onRun,
  playing,
  onTogglePlay,
  step,
  totalSteps,
  onJump,
  onStepBack,
  onStepForward,
  speed,
  onSpeedChange,
  currentStep,
}: ControlsBarProps) {
  const hasTrace = totalSteps > 0;

  return (
    <footer className="controls-bar" aria-label="Playback controls">
      <button className="run-button" disabled={isBusy} onClick={onRun} type="button">
        <Play size={14} />
        {isBusy ? 'Working…' : 'Run'}
      </button>

      <div className="transport" role="group" aria-label="Step navigation">
        <button
          disabled={!hasTrace || step === 0}
          onClick={() => onJump(0)}
          title="Jump to start"
          type="button"
        >
          <SkipBack size={15} />
        </button>
        <button
          disabled={!hasTrace || step === 0}
          onClick={onStepBack}
          title="Step back"
          type="button"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          className="play-toggle"
          disabled={totalSteps <= 1}
          onClick={onTogglePlay}
          title={playing ? 'Pause' : 'Play'}
          type="button"
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button
          disabled={!hasTrace || step >= totalSteps - 1}
          onClick={onStepForward}
          title="Step forward"
          type="button"
        >
          <ChevronRight size={16} />
        </button>
        <button
          disabled={!hasTrace || step >= totalSteps - 1}
          onClick={() => onJump(totalSteps - 1)}
          title="Jump to end"
          type="button"
        >
          <SkipForward size={15} />
        </button>
      </div>

      <div className="scrubber">
        <input
          aria-label="Trace position"
          disabled={!hasTrace}
          max={Math.max(totalSteps - 1, 0)}
          min={0}
          onChange={(event) => onJump(Number(event.target.value))}
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
              type="number"
              value={hasTrace ? step : 0}
            />
            / {Math.max(totalSteps - 1, 0)}
          </span>
        </div>
      </div>

      <div className="speed-control" title={`${speed} steps/second`}>
        <Gauge size={14} />
        <input
          aria-label="Playback speed"
          max={16}
          min={0.5}
          onChange={(event) => onSpeedChange(Number(event.target.value))}
          step={0.5}
          type="range"
          value={speed}
        />
        <span>{speed}×</span>
      </div>

      <button
        className="ghost-button"
        disabled={!hasTrace}
        onClick={() => onJump(0)}
        title="Reset to first step"
        type="button"
      >
        <RotateCcw size={14} />
      </button>
    </footer>
  );
}
