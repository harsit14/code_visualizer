/**
 * Compare runs: keep a finished run as the baseline, edit and run again, then
 * read both summaries side by side and the first point where the runs differ.
 * Loaded on demand. Only completed results are compared; while the current
 * code has no result the panel asks for a re-run instead of showing old data.
 */
import { GitCompare } from 'lucide-react';
import { useId, useMemo, type ReactNode } from 'react';
import type { RunBaseline } from '../app/useRunBaseline';
import {
  compareRuns,
  describeOutcome,
  type DivergenceSide,
  type RunComparison,
  type RunSummary,
} from '../engine/runComparison';
import type { GeneratedInputInfo, Language, SessionResult } from '../engine/types';
// Imported here rather than in main.tsx so the styles load with this panel.
import '../styles/components/run-comparison.css';

type RunComparisonPanelProps = {
  baseline: RunBaseline | null;
  code: string;
  language: Language;
  result: SessionResult | null;
  isBusy: boolean;
  step: number;
  onKeepBaseline: () => void;
  onClearBaseline: () => void;
  onJump: (step: number) => void;
};

type Comparable = Extract<RunComparison, { comparable: true }>;

const LANGUAGE_LABELS: Record<Language, string> = {
  python: 'Python',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
};
const OUTPUT_PREVIEW_LIMIT = 2000;

const VERDICTS: Record<Comparable['verdict'], { title: string; detail: string }> = {
  same: {
    title: 'Same result',
    detail: 'Both runs took the same steps, printed the same output and finished the same way.',
  },
  'same-outcome': {
    title: 'Same result, different path',
    detail: 'Both runs finished the same way, but their steps differ.',
  },
  different: { title: 'The runs differ', detail: 'The first difference is shown below.' },
  incomplete: { title: 'No difference in the recorded steps', detail: '' },
};

function inputsText(inputs: GeneratedInputInfo[]): string {
  return inputs.length ? inputs.map((input) => `${input.name} = ${input.literal}`).join(', ') : '';
}

function callsText(summary: RunSummary): string {
  if (summary.calls.length === 0) return 'No function calls';
  const shown = summary.calls.slice(0, 4).map((call) => `${call.name}() ×${call.count}`);
  const hidden = summary.calls.length - shown.length;
  return `${shown.join(', ')}${hidden > 0 ? `, +${hidden} more` : ''}`;
}

function outputPreview(output: string): string {
  return output.length > OUTPUT_PREVIEW_LIMIT
    ? `${output.slice(0, OUTPUT_PREVIEW_LIMIT)}…`
    : output;
}

function SourceLine({ code, line, label }: { code: string; line: number; label: string }) {
  if (line <= 0) return null;
  const source = code.split('\n')[line - 1];
  if (source === undefined) return null;
  return (
    <pre aria-label={`${label} line ${line}`} className="compare-source">
      <span aria-hidden="true" className="compare-source-number">
        {line}
      </span>
      <code>{source.trim() ? source : ' '}</code>
    </pre>
  );
}

function DivergencePoint({
  label,
  point,
  code,
  action,
}: {
  label: string;
  point: DivergenceSide;
  code: string;
  action?: ReactNode;
}) {
  return (
    <div className="compare-side">
      <h4>{label}</h4>
      <p className="compare-side-meta">
        Step {point.step}
        {point.line > 0 ? ` · line ${point.line}` : ''}
      </p>
      <code className="compare-side-value">{point.value}</code>
      <SourceLine code={code} label={label} line={point.line} />
      {action}
    </div>
  );
}

function SummaryTable({ comparison }: { comparison: Comparable }) {
  const { baseline, current } = comparison;
  const rows: { label: string; baseline: ReactNode; current: ReactNode; differs: boolean }[] = [];
  if (baseline.inputs.length || current.inputs.length) {
    rows.push({
      label: 'Inputs',
      baseline: inputsText(baseline.inputs) || 'None',
      current: inputsText(current.inputs) || 'None',
      differs: comparison.inputsDiffer,
    });
  }
  const text = (label: string, was: string, now: string) =>
    rows.push({ label, baseline: was, current: now, differs: was !== now });
  text('Result', describeOutcome(baseline.outcome), describeOutcome(current.outcome));
  rows.push({
    label: 'Output',
    baseline: <pre className="compare-output">{outputPreview(baseline.output) || 'Nothing'}</pre>,
    current: <pre className="compare-output">{outputPreview(current.output) || 'Nothing'}</pre>,
    differs: baseline.output !== current.output,
  });
  text('Steps', String(baseline.steps), String(current.steps));
  text('Deepest stack', String(baseline.maxDepth), String(current.maxDepth));
  text('Calls', callsText(baseline), callsText(current));
  text(
    'Limits',
    baseline.truncated ? (baseline.truncationReason ?? 'Stopped early') : 'None hit',
    current.truncated ? (current.truncationReason ?? 'Stopped early') : 'None hit',
  );

  return (
    <table className="compare-summary">
      <caption>Both runs</caption>
      <thead>
        <tr>
          <th scope="col">
            <span className="sr-only">Measure</span>
          </th>
          <th scope="col">Baseline</th>
          <th scope="col">Current</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr className={row.differs ? 'is-different' : undefined} key={row.label}>
            <th scope="row">
              {row.label}
              {row.differs ? <span className="sr-only"> (differs)</span> : null}
            </th>
            <td>{row.baseline}</td>
            <td>{row.current}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ComparisonView({
  comparison,
  baseline,
  code,
  step,
  onJump,
}: {
  comparison: RunComparison;
  baseline: RunBaseline;
  code: string;
  step: number;
  onJump: (step: number) => void;
}) {
  const headingId = useId();
  if (!comparison.comparable) {
    return (
      <div className="compare-verdict compare-verdict-unavailable" role="status">
        <strong>These runs can’t be compared</strong>
        <span>{comparison.reason}</span>
      </div>
    );
  }
  const verdict = VERDICTS[comparison.verdict];
  const detail = comparison.verdict === 'incomplete' ? comparison.limitNote : verdict.detail;
  const divergence = comparison.divergence;
  return (
    <>
      <div className={`compare-verdict compare-verdict-${comparison.verdict}`} role="status">
        <strong>{verdict.title}</strong>
        {detail ? <span>{detail}</span> : null}
      </div>
      {comparison.inputsDiffer ? (
        <p className="compare-note">
          The inputs differ, so some differences may come from the input rather than the code.
        </p>
      ) : null}
      {comparison.limitNote && comparison.verdict !== 'incomplete' ? (
        <p className="compare-note">{comparison.limitNote}</p>
      ) : null}
      {divergence ? (
        <section aria-labelledby={headingId} className="compare-divergence">
          <h3 id={headingId}>First difference</h3>
          <p className="compare-divergence-summary">{divergence.summary}</p>
          <div className="compare-sides">
            <DivergencePoint code={baseline.code} label="Baseline" point={divergence.baseline} />
            <DivergencePoint
              action={
                <button
                  aria-current={step === divergence.current.step ? 'step' : undefined}
                  className="compare-jump"
                  onClick={() => onJump(divergence.current.step)}
                  type="button"
                >
                  Show step {divergence.current.step} in the replay
                </button>
              }
              code={code}
              label="Current"
              point={divergence.current}
            />
          </div>
        </section>
      ) : null}
      <SummaryTable comparison={comparison} />
    </>
  );
}

export function RunComparisonPanel({
  baseline,
  code,
  language,
  result,
  isBusy,
  step,
  onKeepBaseline,
  onClearBaseline,
  onJump,
}: RunComparisonPanelProps) {
  const isBaselineRun = Boolean(baseline && result && baseline.result === result);
  const comparison = useMemo(
    () =>
      baseline && result && !isBaselineRun
        ? compareRuns(
            { language: baseline.language, result: baseline.result },
            { language, result },
          )
        : null,
    [baseline, isBaselineRun, language, result],
  );
  const canKeep = Boolean(result?.run) && !isBaselineRun && !isBusy;

  let body: ReactNode;
  if (!baseline) {
    body = (
      <p className="panel-empty">
        Run your code, keep the run as a baseline, then edit and run again to see where the two runs
        first differ.
      </p>
    );
  } else if (isBaselineRun) {
    body = (
      <p className="panel-empty">
        This run is the baseline. Edit the code or inputs, then run again to compare.
      </p>
    );
  } else if (!comparison) {
    body = (
      <p className="panel-empty" role="status">
        {isBusy
          ? 'Running… the comparison appears when the run finishes.'
          : 'Run the current code to compare it with the baseline. Results from before an edit are never compared.'}
      </p>
    );
  } else {
    body = (
      <ComparisonView
        baseline={baseline}
        code={code}
        comparison={comparison}
        onJump={onJump}
        step={step}
      />
    );
  }

  return (
    <section className="panel compare-panel" aria-label="Compare runs">
      <header className="panel-header">
        <h2>
          <GitCompare size={14} /> Compare runs
        </h2>
        <div className="compare-header-actions">
          <button
            className="panel-header-action"
            disabled={!canKeep}
            onClick={onKeepBaseline}
            title="Keep the current run to compare with later runs"
            type="button"
          >
            {baseline ? 'Use current as baseline' : 'Keep as baseline'}
          </button>
          {baseline ? (
            <button className="panel-header-action" onClick={onClearBaseline} type="button">
              Clear baseline
            </button>
          ) : null}
        </div>
      </header>
      <div className="panel-scroll compare-body">
        {body}
        {baseline ? (
          <details className="compare-baseline-code">
            <summary>
              Baseline code · {LANGUAGE_LABELS[baseline.language]}
              {baseline.functionName ? ` · ${baseline.functionName}()` : ''}
            </summary>
            <pre>
              <code>{baseline.code}</code>
            </pre>
          </details>
        ) : null}
      </div>
    </section>
  );
}
