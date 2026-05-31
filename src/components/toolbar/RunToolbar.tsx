import { Download, LoaderCircle, Play, RotateCcw, Share2, Sparkles } from 'lucide-react';
import {
  CUSTOM_SNIPPET_ID,
  CUSTOM_SNIPPET_TITLE,
  type PythonExample,
} from '../../examples/pythonExamples';
import type { PythonRuntimeStatus } from '../../languages/python/runtimeTypes';

type RunToolbarProps = {
  activeStep: number;
  canExport: boolean;
  canShare: boolean;
  examples: PythonExample[];
  exportState: 'idle' | 'done';
  isBusy: boolean;
  onExampleChange: (id: string) => void;
  onExport: () => void;
  onReset: () => void;
  onRun: () => void;
  onShare: () => void;
  runtimeStatus: PythonRuntimeStatus;
  selectedExampleId: string;
  shareState: 'idle' | 'copied' | 'linked';
  totalSteps: number;
};

export function RunToolbar({
  activeStep,
  canExport,
  canShare,
  examples,
  exportState,
  isBusy,
  onExampleChange,
  onExport,
  onReset,
  onRun,
  onShare,
  runtimeStatus,
  selectedExampleId,
  shareState,
  totalSteps,
}: RunToolbarProps) {
  const runLabel = isBusy
    ? runtimeStatus.phase === 'loading'
      ? 'Loading'
      : runtimeStatus.phase === 'interrupting' || runtimeStatus.phase === 'restarting'
        ? 'Stopping'
        : 'Running'
    : 'Run';
  const exportLabel = exportState === 'done' ? 'Saved' : 'Export';
  const shareLabel =
    shareState === 'copied' ? 'Copied' : shareState === 'linked' ? 'Linked' : 'Share';

  return (
    <header className="topbar">
      <div className="brand-mark" aria-hidden="true">
        <Sparkles size={18} />
      </div>

      <div className="brand-copy">
        <h1>Code Visualizer</h1>
        <span>Python runtime map</span>
      </div>

      <div className="toolbar-group">
        <label className="select-label" htmlFor="source-select">
          Source
        </label>
        <select
          className="example-select"
          id="source-select"
          onChange={(event) => onExampleChange(event.target.value)}
          value={selectedExampleId}
        >
          <option value={CUSTOM_SNIPPET_ID}>{CUSTOM_SNIPPET_TITLE}</option>
          <optgroup label="Examples">
            {examples.map((example) => (
              <option key={example.id} value={example.id}>
                {example.title}
              </option>
            ))}
          </optgroup>
        </select>
      </div>

      <div className="toolbar-actions" aria-label="Run controls">
        <button className="icon-button secondary" onClick={onReset} title="Reset" type="button">
          <RotateCcw size={18} />
          <span>Reset</span>
        </button>
        <button
          className="icon-button primary"
          disabled={isBusy}
          onClick={onRun}
          title="Run Python"
          type="button"
        >
          {isBusy ? <LoaderCircle className="spin" size={18} /> : <Play size={18} />}
          <span>{runLabel}</span>
        </button>
        <button
          className="icon-button ghost"
          disabled={!canExport}
          onClick={onExport}
          title="Export trace JSON"
          type="button"
        >
          <Download size={18} />
          <span>{exportLabel}</span>
        </button>
        <button
          className="icon-button ghost"
          disabled={!canShare}
          onClick={onShare}
          title="Share code link"
          type="button"
        >
          <Share2 size={18} />
          <span>{shareLabel}</span>
        </button>
      </div>

      <div
        className="run-meter"
        aria-label={`${runtimeStatus.message}. Step ${activeStep + 1} of ${totalSteps}`}
      >
        <span>{String(activeStep + 1).padStart(2, '0')}</span>
        <div className="meter-track">
          <div
            className="meter-fill"
            style={{ inlineSize: `${((activeStep + 1) / totalSteps) * 100}%` }}
          />
        </div>
      </div>
    </header>
  );
}
