/**
 * Console panel: stdout up to the current step, return value, exceptions,
 * stderr, truncation notices, and complexity hints.
 */
import { AlertTriangle, Terminal, TrendingUp } from 'lucide-react';
import { explainException } from '../engine/exceptionExplanations';
import { fitGrowth, formatValue, stdoutAtStep } from '../engine/trace';
import type { ComplexityResult, SessionResult, TraceStep } from '../engine/types';

type ConsolePanelProps = {
  result: SessionResult | null;
  currentStep: TraceStep | undefined;
  atLastStep: boolean;
  complexity: ComplexityResult | null;
  complexityBusy: boolean;
  onMeasureComplexity: () => void;
  canMeasureComplexity: boolean;
};

function formatRuntime(ms: number | undefined): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) {
    return null;
  }
  if (ms < 1) {
    return `${ms.toFixed(2)} ms`;
  }
  if (ms < 10) {
    return `${ms.toFixed(1)} ms`;
  }
  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }
  return `${(ms / 1000).toFixed(2)} s`;
}

function formatMemory(
  mb: number | null | undefined,
  isEstimate: boolean | undefined,
): string | null {
  if (typeof mb !== 'number' || !Number.isFinite(mb)) {
    return null;
  }
  const amount =
    mb < 0.01 ? '<0.01 MB' : `${mb < 10 ? mb.toFixed(2) : mb.toFixed(1)} MB`;
  return isEstimate ? `~${amount}` : amount;
}

export function ConsolePanel({
  result,
  currentStep,
  atLastStep,
  complexity,
  complexityBusy,
  onMeasureComplexity,
  canMeasureComplexity,
}: ConsolePanelProps) {
  const run = result?.run ?? null;
  const stdout = run ? stdoutAtStep(run.stdout, currentStep) : '';
  const exception = run?.exception ?? run?.setupError ?? null;
  const error = result?.error ?? null;
  const explanation = explainException(exception ?? error);
  const growth =
    complexity && complexity.samples.length >= 3 ? fitGrowth(complexity.samples) : null;
  const maxOps = complexity ? Math.max(...complexity.samples.map((sample) => sample.ops), 1) : 1;
  const runtimeText = run ? formatRuntime(run.runtimeMs) : null;
  const memoryText = run ? formatMemory(run.memoryMb, run.memoryIsEstimate) : null;

  return (
    <section className="panel console-panel" aria-label="Output console">
      <header className="panel-header">
        <h2>
          <Terminal size={14} /> Console
        </h2>
        {run ? <span className="panel-hint">{run.opCount} ops</span> : null}
      </header>

      <div className="panel-scroll console-body">
        {stdout ? <pre className="console-stdout">{stdout}</pre> : null}
        {!stdout && run && !exception && !error ? (
          <p className="panel-empty">No output yet at this step.</p>
        ) : null}

        {atLastStep && run?.returnValue ? (
          <p className="console-return">
            <span>returned</span> {formatValue(run.returnValue)}
          </p>
        ) : null}

        {exception ? (
          <div className="console-error" role="alert">
            <AlertTriangle size={14} />
            <div>
              <strong>
                {exception.type}: {exception.msg}
              </strong>
              {currentStep?.exc ? <p>raised at line {currentStep.line}</p> : null}
            </div>
          </div>
        ) : null}

        {error && !exception ? (
          <div className="console-error" role="alert">
            <AlertTriangle size={14} />
            <strong>
              {error.type}: {error.msg}
            </strong>
          </div>
        ) : null}

        {explanation ? (
          <div className="console-explanation">
            <strong>{explanation.title}</strong>
            <p>{explanation.detail}</p>
            {explanation.checks.length > 0 ? (
              <ul>
                {explanation.checks.map((check) => (
                  <li key={check}>{check}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {run?.truncated ? <p className="console-note">{run.truncationReason}</p> : null}
        {run?.stderr ? <pre className="console-stderr">{run.stderr}</pre> : null}

        {run && (runtimeText || memoryText) ? (
          <dl className="console-metrics" aria-label="Execution metrics">
            {runtimeText ? (
              <div>
                <dt>Runtime</dt>
                <dd>{runtimeText}</dd>
              </div>
            ) : null}
            {memoryText ? (
              <div>
                <dt>Memory</dt>
                <dd>{memoryText}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        <div className="complexity-block">
          <button
            className="ghost-button"
            disabled={!canMeasureComplexity || complexityBusy}
            onClick={onMeasureComplexity}
            title="Run the function at several input sizes and fit a growth curve"
            type="button"
          >
            <TrendingUp size={13} />
            {complexityBusy ? 'Measuring…' : 'Estimate complexity'}
          </button>

          {complexity?.error ? (
            <p className="console-note">
              {complexity.error.type}: {complexity.error.msg}
            </p>
          ) : null}

          {complexity?.truncated ? (
            <p className="console-note">
              {complexity.truncationReason
                ? `${complexity.truncationReason} Growth estimate may be biased toward smaller inputs.`
                : 'Complexity measurement stopped early; growth estimate may be biased toward smaller inputs.'}
            </p>
          ) : null}

          {complexity && complexity.samples.length > 0 ? (
            <div className="complexity-result">
              {growth ? (
                <p className="complexity-label">
                  steps grow like <strong>{growth}</strong>
                </p>
              ) : null}
              <div className="complexity-bars">
                {complexity.samples.map((sample) => (
                  <div className="complexity-bar-row" key={sample.n}>
                    <span className="complexity-n">n={sample.n}</span>
                    <div className="complexity-bar-track">
                      <div
                        className="complexity-bar"
                        style={{ width: `${Math.max(2, (sample.ops / maxOps) * 100)}%` }}
                      />
                    </div>
                    <span className="complexity-ops">{sample.ops}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
