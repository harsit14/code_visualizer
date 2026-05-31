import { Activity, Terminal } from 'lucide-react';
import type {
  PythonRunResult,
  PythonRuntimeStatus,
  PythonTraceEvent,
} from '../../languages/python/runtimeTypes';

type OutputPanelProps = {
  currentEvent: PythonTraceEvent | null;
  exampleTitle: string;
  runResult: PythonRunResult | null;
  runtimeStatus: PythonRuntimeStatus;
};

export function OutputPanel({
  currentEvent,
  exampleTitle,
  runResult,
  runtimeStatus,
}: OutputPanelProps) {
  const isFinalTraceStep =
    currentEvent !== null &&
    runResult !== null &&
    currentEvent.step >= runResult.traceEvents.length - 1;
  const stdout = isFinalTraceStep ? runResult.stdout.trimEnd() : '';
  const stderr = isFinalTraceStep ? runResult.stderr.trimEnd() : '';
  const statusLabel = runResult?.status ?? runtimeStatus.phase;

  return (
    <section className="panel output-panel" aria-label="Output panel">
      <header className="panel-header compact">
        <div>
          <span className="eyebrow">Run</span>
          <h2>
            <Terminal size={18} />
            Output
          </h2>
        </div>
        <span className={`panel-chip status-chip ${statusLabel}`}>
          <Activity size={14} />
          {statusLabel}
        </span>
      </header>

      <div className="output-console">
        <div className="console-row muted">selected: {exampleTitle}</div>
        <div className="console-row muted">runtime: {runtimeStatus.message}</div>
        {runResult ? (
          <div className="console-row muted">
            duration: {Math.round(runResult.durationMs)}ms via {runResult.interruptMode}
          </div>
        ) : null}
        {runResult ? (
          <div className="console-row muted">trace events: {runResult.traceEvents.length}</div>
        ) : null}
        {runResult?.diagnostics.map((diagnostic) => (
          <div className="console-row warning" key={diagnostic}>
            {diagnostic}
          </div>
        ))}
        <pre className={stdout ? 'console-block stdout' : 'console-block muted'}>
          stdout: {stdout || 'waiting'}
        </pre>
        {stderr ? <pre className="console-block stderr">stderr: {stderr}</pre> : null}
        {runResult?.error ? (
          <div className="console-error">
            <strong>
              {runResult.error.name}
              {runResult.error.message ? ': ' : ''}
            </strong>
            {runResult.error.message}
          </div>
        ) : null}
        {runResult?.error?.traceback ? (
          <details className="traceback-block">
            <summary>traceback</summary>
            <pre>{runResult.error.traceback}</pre>
          </details>
        ) : null}
      </div>
    </section>
  );
}
