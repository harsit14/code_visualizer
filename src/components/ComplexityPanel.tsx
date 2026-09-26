/**
 * Complexity experiment inside the console: pick which input grows and the
 * sizes to sample, then read the per-size samples, the measured growth fit
 * and, separately, what the code's loop structure suggests.
 *
 * Measured growth describes these runs only. Nothing here is presented as a
 * proven Big-O bound.
 */
import { Square, TrendingUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  COMPLEXITY_MAX_N,
  DEFAULT_LARGEST_N,
  DEFAULT_SAMPLE_COUNT,
  DEFAULT_SMALLEST_N,
  LARGEST_N_CHOICES,
  SAMPLE_COUNT_CHOICES,
  SMALLEST_N_CHOICES,
  complexityDimensions,
  complexitySizes,
  defaultComplexityDimension,
  isOkSample,
  type ComplexityDimensionOption,
} from '../engine/complexity';
import type {
  ComplexityOptions,
  ComplexityResult,
  ComplexitySample,
  FunctionInfo,
  Language,
} from '../engine/types';
import { ComplexityChart } from './ComplexityChart';

type ComplexityPanelProps = {
  language: Language;
  fn: FunctionInfo | null;
  /** Current input literals, one per parameter, when the inputs panel has them. */
  inputs?: string[];
  result: ComplexityResult | null;
  busy: boolean;
  canMeasure: boolean;
  onMeasure: (options: ComplexityOptions) => void;
  onStop?: () => void;
};

const QUALITY_LABEL = { good: 'Good fit', fair: 'Fair fit', poor: 'Poor fit' } as const;

function dimensionLabel(option: ComplexityDimensionOption): string {
  if (option.axis === 'both') return `${option.param} (rows and columns)`;
  if (option.axis === 'rows') return `${option.param} (rows only)`;
  if (option.axis === 'cols') return `${option.param} (columns only)`;
  return option.param;
}

function formatMs(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—';
  if (ms < 1) return '<1 ms';
  if (ms < 10) return `${ms.toFixed(1)} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function formatSteps(sample: ComplexitySample, maxSteps: number | undefined): string {
  const status = sample.status ?? 'ok';
  if (status === 'ok') return sample.ops.toLocaleString('en-US');
  if (status === 'step-limit')
    return `>${(maxSteps ?? Math.max(sample.ops - 1, 0)).toLocaleString('en-US')}`;
  if (status === 'time-limit') return `≥${sample.ops.toLocaleString('en-US')}`;
  return '—';
}

function statusText(sample: ComplexitySample): { label: string; detail: string | null } {
  switch (sample.status ?? 'ok') {
    case 'ok':
      return { label: 'ok', detail: null };
    case 'exception':
      return {
        label: `raised ${sample.error?.type ?? 'an error'}`,
        detail: sample.error?.msg ?? null,
      };
    case 'setup-error':
      return {
        label: `input error${sample.error ? `: ${sample.error.type}` : ''}`,
        detail: sample.error?.msg ?? null,
      };
    case 'step-limit':
      return { label: 'step limit hit', detail: sample.note ?? null };
    case 'time-limit':
      return { label: 'time limit hit', detail: sample.note ?? null };
    default:
      return { label: 'skipped', detail: sample.note ?? null };
  }
}

function unavailableReason(language: Language, fn: FunctionInfo | null, hasOptions: boolean) {
  if (language !== 'python')
    return 'Complexity experiments run on Python functions only; JavaScript and TypeScript are not measured yet.';
  if (!fn) return 'Complexity experiments need a Python function to call with generated inputs.';
  if (!hasOptions)
    return 'No parameter can grow. Experiments need a list, string, dict, set, grid, tree, linked list or int input.';
  return null;
}

export function ComplexityPanel({
  language,
  fn,
  inputs,
  result,
  busy,
  canMeasure,
  onMeasure,
  onStop,
}: ComplexityPanelProps) {
  const options = useMemo(() => complexityDimensions(fn), [fn]);
  const [dimensionId, setDimensionId] = useState<string | null>(null);
  const [smallest, setSmallest] = useState(DEFAULT_SMALLEST_N);
  const [largest, setLargest] = useState(DEFAULT_LARGEST_N);
  const [sampleCount, setSampleCount] = useState(DEFAULT_SAMPLE_COUNT);
  const [keepCurrent, setKeepCurrent] = useState(true);

  const dimension =
    options.find((option) => option.id === dimensionId) ?? defaultComplexityDimension(options);
  const maxN = dimension?.maxN ?? COMPLEXITY_MAX_N;
  const largestChoices = LARGEST_N_CHOICES.filter((choice) => choice <= maxN);
  const effectiveLargest = Math.min(largest, maxN);
  const smallestChoices = SMALLEST_N_CHOICES.filter((choice) => choice < effectiveLargest);
  const effectiveSmallest = Math.min(smallest, smallestChoices.at(-1) ?? 2);
  const sizes = complexitySizes(effectiveSmallest, effectiveLargest, sampleCount);
  const otherParams = fn ? fn.params.filter((param) => param.name !== dimension?.param) : [];
  const hasCurrentInputs = Boolean(inputs && fn && inputs.length === fn.params.length);
  const reason = unavailableReason(language, fn, options.length > 0);
  const disabled = !canMeasure || busy || reason !== null || !dimension;

  const measure = () => {
    if (!dimension) return;
    onMeasure({
      param: dimension.param,
      axis: dimension.axis,
      sizes,
      inputs: keepCurrent && hasCurrentInputs && otherParams.length > 0 ? inputs : undefined,
    });
  };

  return (
    <div className="complexity-block">
      <h3 className="complexity-heading">
        <TrendingUp size={13} /> Complexity experiment
      </h3>

      {reason ? (
        <p className="complexity-hint">{reason}</p>
      ) : (
        <>
          <div className="complexity-controls">
            <label className="complexity-field complexity-field-wide">
              <span>Grow</span>
              <select
                disabled={busy}
                onChange={(event) => setDimensionId(event.target.value)}
                value={dimension?.id ?? ''}
              >
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {dimensionLabel(option)}
                  </option>
                ))}
              </select>
            </label>
            <label className="complexity-field">
              <span>From n</span>
              <select
                disabled={busy}
                onChange={(event) => setSmallest(Number(event.target.value))}
                value={effectiveSmallest}
              >
                {smallestChoices.map((choice) => (
                  <option key={choice} value={choice}>
                    {choice}
                  </option>
                ))}
              </select>
            </label>
            <label className="complexity-field">
              <span>To n</span>
              <select
                disabled={busy}
                onChange={(event) => setLargest(Number(event.target.value))}
                value={effectiveLargest}
              >
                {largestChoices.map((choice) => (
                  <option key={choice} value={choice}>
                    {choice}
                  </option>
                ))}
              </select>
            </label>
            <label className="complexity-field">
              <span>Samples</span>
              <select
                disabled={busy}
                onChange={(event) => setSampleCount(Number(event.target.value))}
                value={sampleCount}
              >
                {SAMPLE_COUNT_CHOICES.map((choice) => (
                  <option key={choice} value={choice}>
                    {choice}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {dimension ? (
            <p className="complexity-plan">
              <code>{dimension.meaning}</code>, sampled at n = {sizes.join(', ')}
            </p>
          ) : null}

          {otherParams.length > 0 ? (
            hasCurrentInputs ? (
              <label className="complexity-check">
                <input
                  checked={keepCurrent}
                  disabled={busy}
                  onChange={(event) => setKeepCurrent(event.target.checked)}
                  type="checkbox"
                />
                Hold {otherParams.map((param) => param.name).join(', ')} at the current input values
              </label>
            ) : (
              <p className="complexity-hint">
                {otherParams.map((param) => param.name).join(', ')} will use generated defaults.
              </p>
            )
          ) : null}
        </>
      )}

      <div className="complexity-actions">
        <button
          className="ghost-button"
          disabled={disabled}
          onClick={measure}
          title="Run the function at each size and fit a growth curve to the step counts"
          type="button"
        >
          <TrendingUp size={13} />
          {busy ? 'Measuring…' : 'Estimate complexity'}
        </button>
        {busy && onStop ? (
          <button className="ghost-button" onClick={onStop} type="button">
            <Square size={12} /> Stop
          </button>
        ) : null}
      </div>

      {result?.error ? (
        <p className="console-note" role="alert">
          {result.error.type}: {result.error.msg}
        </p>
      ) : null}

      {result?.truncated ? (
        <p className="console-note">
          {result.truncationReason
            ? `${result.truncationReason} Growth estimate may be biased toward smaller inputs.`
            : 'Complexity measurement stopped early; growth estimate may be biased toward smaller inputs.'}
        </p>
      ) : null}

      {result && result.samples.length > 0 ? <ComplexityResults result={result} /> : null}
    </div>
  );
}

function ComplexityResults({ result }: { result: ComplexityResult }) {
  const fit = result.fit ?? null;
  const samples = result.samples;
  const finished = samples.filter(isOkSample).length;
  const fixed = result.fixed ?? [];
  const caveats = result.caveats ?? [];
  const structure = result.structure ?? null;

  return (
    <section aria-label="Complexity results" className="complexity-result">
      {result.dimension ? (
        <p className="complexity-plan">
          Grew <code>{result.dimension.meaning}</code>
          {fixed.length > 0 ? (
            <>
              ; held{' '}
              {fixed.map((item, index) => (
                <span key={item.name}>
                  {index > 0 ? ', ' : ''}
                  <code>
                    {item.name} = {item.literal}
                  </code>
                </span>
              ))}{' '}
              ({fixed[0].source === 'current' ? 'current values' : 'generated defaults'})
            </>
          ) : null}
          .
        </p>
      ) : null}

      <div className="complexity-verdict">
        <p className="complexity-verdict-main">
          <span>Measured growth</span> <strong>{fit ? `≈ ${fit.label}` : 'not enough data'}</strong>
        </p>
        <p className={`complexity-quality is-${fit?.quality ?? 'poor'}`}>
          {fit
            ? `${QUALITY_LABEL[fit.quality]}: typical error ${Math.round(fit.error * 100)}%, from ${fit.samplesUsed} of ${samples.length} samples`
            : `Needs at least 3 finished samples; ${finished} of ${samples.length} finished.`}
        </p>
      </div>

      <ComplexityChart fit={fit} samples={samples} />

      <table className="complexity-samples">
        <caption>Sampled sizes</caption>
        <thead>
          <tr>
            <th scope="col">n</th>
            <th scope="col">Steps</th>
            <th scope="col">Time</th>
            <th scope="col">Result</th>
          </tr>
        </thead>
        <tbody>
          {samples.map((sample, index) => {
            const status = statusText(sample);
            const ok = isOkSample(sample);
            return (
              <tr className={ok ? undefined : 'is-failed'} key={`${index}-${sample.n}`}>
                <td>{sample.n}</td>
                <td>{formatSteps(sample, result.limits?.maxSteps)}</td>
                <td>{formatMs(sample.ms)}</td>
                <td>
                  <span className={`complexity-status is-${sample.status ?? 'ok'}`}>
                    {status.label}
                  </span>
                  {status.detail ? <small>{status.detail}</small> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="complexity-hint">
        Steps are trace events in your code: calls, lines and returns. A built-in such as{' '}
        <code>sorted()</code> or <code>sum()</code> counts as one step, so its own work is not
        measured. Times include tracing overhead.
      </p>

      {caveats.length > 0 ? (
        <ul className="complexity-caveats" aria-label="Caveats">
          {caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
      ) : null}

      {structure ? (
        <div className="complexity-structure">
          <p className="complexity-verdict-main">
            <span>Code structure suggests</span>{' '}
            <strong>{structure.label ?? 'no loop-based estimate'}</strong>
          </p>
          <p className="complexity-hint">
            A heuristic from loop nesting and recursion, not a proof.
          </p>
          {structure.notes.length > 0 ? (
            <ul>
              {structure.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <p className="complexity-hint">
        Measured growth describes these runs on these inputs. It is evidence, not a proof of Big-O.
      </p>
    </section>
  );
}
