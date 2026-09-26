/**
 * Inline SVG chart for a complexity experiment: measured steps against n as
 * dots, the fitted curve as a dashed line and failed sizes as crosses on the
 * baseline. The samples table next to it carries every value in text.
 */
import { useId } from 'react';
import { isOkSample } from '../engine/complexity';
import type { ComplexityFit, ComplexitySample } from '../engine/types';

type ComplexityChartProps = {
  samples: ComplexitySample[];
  fit: ComplexityFit | null;
};

const WIDTH = 320;
const HEIGHT = 168;
const MARGIN = { top: 10, right: 14, bottom: 30, left: 46 };
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;

/** Round up to 1, 2 or 5 × 10^k so axis ticks land on clean numbers. */
function niceCeiling(value: number): number {
  if (!(value > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((multiple) => multiple * magnitude >= value) ?? 10;
  return step * magnitude;
}

function compactNumber(value: number): string {
  if (value >= 1_000_000) return `${+(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${+(value / 1_000).toFixed(1)}k`;
  return `${+value.toFixed(1)}`;
}

export function ComplexityChart({ samples, fit }: ComplexityChartProps) {
  const titleId = useId();
  const valid = samples.filter(isOkSample);
  const failed = samples.filter((sample) => !isOkSample(sample) && sample.status !== 'skipped');
  const curve = fit?.curve ?? [];
  const xMax = Math.max(1, ...valid.map((s) => s.n), ...failed.map((s) => s.n));
  const yMax = niceCeiling(
    Math.max(...valid.map((s) => s.ops), ...curve.map((point) => point.ops), 1),
  );
  const x = (n: number) => MARGIN.left + (n / xMax) * PLOT_WIDTH;
  const y = (ops: number) =>
    MARGIN.top + PLOT_HEIGHT - (Math.min(Math.max(ops, 0), yMax) / yMax) * PLOT_HEIGHT;
  const baseline = y(0);
  const curvePath = curve
    .map(
      (point, index) =>
        `${index === 0 ? 'M' : 'L'}${x(point.n).toFixed(1)},${y(point.ops).toFixed(1)}`,
    )
    .join(' ');
  const yTicks = [0, yMax / 2, yMax];
  const xTicks = [0, Math.round(xMax / 2), xMax];
  const summary =
    `Steps against n for ${valid.length} finished sample${valid.length === 1 ? '' : 's'}` +
    (fit ? ` with the fitted ${fit.label} curve` : '') +
    (failed.length > 0
      ? `; ${failed.length} failed size${failed.length === 1 ? '' : 's'} marked on the n axis`
      : '') +
    '.';

  return (
    <figure className="complexity-chart">
      <svg aria-labelledby={titleId} role="img" viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
        <title id={titleId}>{summary}</title>
        {yTicks.map((tick) => (
          <g key={`y-${tick}`}>
            <line
              className="complexity-grid"
              x1={MARGIN.left}
              x2={WIDTH - MARGIN.right}
              y1={y(tick)}
              y2={y(tick)}
            />
            <text className="complexity-tick" textAnchor="end" x={MARGIN.left - 6} y={y(tick) + 4}>
              {compactNumber(tick)}
            </text>
          </g>
        ))}
        {xTicks.map((tick) => (
          <text
            className="complexity-tick"
            key={`x-${tick}`}
            textAnchor="middle"
            x={x(tick)}
            y={baseline + 16}
          >
            {tick}
          </text>
        ))}
        <text
          className="complexity-axis-title"
          textAnchor="end"
          x={WIDTH - MARGIN.right}
          y={HEIGHT - 2}
        >
          n
        </text>
        <text className="complexity-axis-title" x={4} y={MARGIN.top + 4}>
          steps
        </text>
        {curvePath ? <path className="complexity-fit-line" d={curvePath} /> : null}
        {valid.map((sample, index) => (
          <circle
            className="complexity-dot"
            cx={x(sample.n)}
            cy={y(sample.ops)}
            key={`ok-${index}`}
            r={4}
          >
            <title>{`n = ${sample.n}: ${sample.ops.toLocaleString('en-US')} steps`}</title>
          </circle>
        ))}
        {failed.map((sample, index) => {
          const cx = x(sample.n);
          return (
            <g className="complexity-failed-mark" key={`failed-${index}`}>
              <title>{`n = ${sample.n}: ${sample.error?.type ?? sample.status ?? 'failed'}`}</title>
              <path
                d={`M${cx - 4},${baseline - 4} L${cx + 4},${baseline + 4} M${cx + 4},${baseline - 4} L${cx - 4},${baseline + 4}`}
              />
            </g>
          );
        })}
      </svg>
      <figcaption className="complexity-legend">
        <span>
          <i aria-hidden="true" className="complexity-key-dot" /> measured steps
        </span>
        {fit ? (
          <span>
            <i aria-hidden="true" className="complexity-key-line" /> fitted {fit.label}
          </span>
        ) : null}
        {failed.length > 0 ? (
          <span>
            <i aria-hidden="true" className="complexity-key-cross">
              ×
            </i>{' '}
            failed (not fitted)
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}
