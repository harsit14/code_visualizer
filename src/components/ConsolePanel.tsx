/**
 * Console panel: stdout up to the current step, return value, exceptions,
 * stderr, truncation notices, and the complexity experiment.
 */
import { AlertTriangle, Terminal } from 'lucide-react';
import { explainException } from '../engine/exceptionExplanations';
import { formatValue, stdoutAtStep } from '../engine/trace';
import type {
  ComplexityOptions,
  ComplexityResult,
  FunctionInfo,
  Language,
  SessionResult,
  TraceStep,
} from '../engine/types';
import { ComplexityPanel } from './ComplexityPanel';

type ConsolePanelProps = {
  language?: Language;
  result: SessionResult | null;
  currentStep: TraceStep | undefined;
  atLastStep: boolean;
  complexity: ComplexityResult | null;
  complexityBusy: boolean;
  onMeasureComplexity: (options: ComplexityOptions) => void;
  canMeasureComplexity: boolean;
  /** The function a complexity experiment would call, with its current inputs. */
  complexityFunction?: FunctionInfo | null;
  complexityInputs?: string[];
  onStopComplexity?: () => void;
};

function formatRuntime(ms: number | undefined): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) {
    return null;
  }
  if (ms < 1) {
    return '<1 ms';
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
  const amount = mb < 0.01 ? '<0.01 MB' : `${mb < 10 ? mb.toFixed(2) : mb.toFixed(1)} MB`;
  return isEstimate ? `~${amount}` : amount;
}

export function ConsolePanel({
  language = 'python',
  result,
  currentStep,
  atLastStep,
  complexity,
  complexityBusy,
  onMeasureComplexity,
  canMeasureComplexity,
  complexityFunction = null,
  complexityInputs,
  onStopComplexity,
}: ConsolePanelProps) {
  const run = result?.run ?? null;
  const stdout = run ? stdoutAtStep(run.stdout, currentStep) : '';
  const exception = run?.exception ?? run?.setupError ?? null;
  const error = result?.error ?? null;
  const explanation = explainException(exception ?? error, language);
  const runtimeText = run ? formatRuntime(run.runtimeMs) : null;
  const memoryText = run ? formatMemory(run.memoryMb, run.memoryIsEstimate) : null;
  const showReturnValue = Boolean(atLastStep && run?.returnValue);
  const showEmptyOutput = Boolean(
    run && !stdout && !showReturnValue && !run.stderr && !exception && !error,
  );

  return (
    <section className="panel console-panel" aria-label="Output console">
      <header className="panel-header">
        <h2>
          <Terminal size={14} /> Console
        </h2>
      </header>

      <div className="panel-scroll console-body">
        {stdout ? <pre className="console-stdout">{stdout}</pre> : null}
        {showEmptyOutput ? <p className="panel-empty">No output yet at this step.</p> : null}

        {showReturnValue && run?.returnValue ? (
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

        <ComplexityPanel
          busy={complexityBusy}
          canMeasure={canMeasureComplexity}
          fn={complexityFunction}
          inputs={complexityInputs}
          language={language}
          onMeasure={onMeasureComplexity}
          onStop={onStopComplexity}
          result={complexity}
        />
      </div>
    </section>
  );
}
