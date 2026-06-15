import { expandSelf, formatValue, stdoutAtStep } from '../engine/trace';
import type { EncodedValue, RunInfo, SessionResult, TraceStep } from '../engine/types';

const SVG_WIDTH = 960;
const SVG_HEIGHT = 540;
const FRAME_MS = 900;
const MAX_ANIMATED_FRAMES = 80;
const MAX_CODE_LINES = 9;
const MAX_VARIABLES = 9;
const MAX_TEXT = 72;

type SvgFrame = {
  index: number;
  step: TraceStep;
};

export type TraceSvgExport = {
  filename: string;
  svg: string;
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function truncate(value: string, max = MAX_TEXT): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}...` : normalized;
}

function svgText(
  text: string,
  x: number,
  y: number,
  className: string,
  extraAttributes = '',
): string {
  const attrs = extraAttributes ? ` ${extraAttributes}` : '';
  return `<text class="${className}" x="${x}" y="${y}"${attrs}>${escapeXml(text)}</text>`;
}

function eventLabel(step: TraceStep): string {
  if (step.exc) {
    return `${step.exc.type}: ${step.exc.msg}`;
  }
  if (step.event === 'return' && step.ret !== undefined) {
    return `return ${formatValue(step.ret)}`;
  }
  return step.event;
}

function variableRows(values: Record<string, EncodedValue>): string[] {
  return Object.entries(values)
    .filter(([name]) => name !== 'self')
    .slice(0, MAX_VARIABLES)
    .map(([name, value]) => `${name} = ${formatValue(value)}`);
}

function selectedFrames(steps: readonly TraceStep[]): SvgFrame[] {
  if (steps.length <= MAX_ANIMATED_FRAMES) {
    return steps.map((step, index) => ({ index, step }));
  }

  const frames: SvgFrame[] = [];
  const used = new Set<number>();
  for (let frameIndex = 0; frameIndex < MAX_ANIMATED_FRAMES; frameIndex += 1) {
    const index = Math.round((frameIndex * (steps.length - 1)) / (MAX_ANIMATED_FRAMES - 1));
    if (!used.has(index)) {
      used.add(index);
      frames.push({ index, step: steps[index] });
    }
  }
  return frames;
}

function keyframeCss(frameCount: number): string {
  const totalSeconds = ((Math.max(frameCount, 1) * FRAME_MS) / 1000).toFixed(2);
  const css = [
    `.frame { opacity: 0; animation-duration: ${totalSeconds}s; animation-iteration-count: infinite; animation-timing-function: step-end; }`,
  ];

  for (let index = 0; index < frameCount; index += 1) {
    const start = (index / frameCount) * 100;
    const end = ((index + 1) / frameCount) * 100;
    const before = Math.max(0, start - 0.01);
    const after = Math.min(100, end);
    const visibleEnd = Math.max(start, end - 0.01);

    if (index === 0) {
      css.push(
        `@keyframes frame-${index} { 0%, ${visibleEnd.toFixed(3)}% { opacity: 1; } ${after.toFixed(3)}%, 100% { opacity: 0; } }`,
      );
    } else if (index === frameCount - 1) {
      css.push(
        `@keyframes frame-${index} { 0%, ${before.toFixed(3)}% { opacity: 0; } ${start.toFixed(3)}%, 100% { opacity: 1; } }`,
      );
    } else {
      css.push(
        `@keyframes frame-${index} { 0%, ${before.toFixed(3)}% { opacity: 0; } ${start.toFixed(3)}%, ${visibleEnd.toFixed(3)}% { opacity: 1; } ${after.toFixed(3)}%, 100% { opacity: 0; } }`,
      );
    }
  }

  return css.join('\n');
}

function frameSvg(
  frame: SvgFrame,
  frameIndex: number,
  frameCount: number,
  run: RunInfo,
  codeLines: string[],
): string {
  const { step, index } = frame;
  const activeLine = step.line;
  const codeEnd = Math.min(codeLines.length, Math.max(activeLine + 4, MAX_CODE_LINES));
  const codeStart = Math.max(1, Math.min(activeLine - 4, codeEnd - MAX_CODE_LINES + 1));
  const visibleLines = codeLines.slice(codeStart - 1, codeEnd);
  const topFrame = step.stack.at(-1);
  const frameName = topFrame
    ? topFrame.func === '<module>'
      ? 'module'
      : `${topFrame.func}()`
    : 'no frame';
  const locals = topFrame ? expandSelf(topFrame.locals) : step.globals;
  const rows = variableRows(locals);
  const stdout = stdoutAtStep(run.stdout, step);
  const stdoutLines = stdout ? stdout.trimEnd().split('\n').slice(-3) : [];

  const codeMarkup = visibleLines
    .map((line, offset) => {
      const lineNumber = codeStart + offset;
      const y = 143 + offset * 27;
      const highlight =
        lineNumber === activeLine
          ? `<rect class="active-line" x="48" y="${y - 18}" width="520" height="24" rx="5" />`
          : '';
      return [
        highlight,
        svgText(String(lineNumber).padStart(3, ' '), 62, y, 'line-number'),
        svgText(
          truncate(line, 58),
          106,
          y,
          lineNumber === activeLine ? 'code active-code' : 'code',
        ),
      ].join('');
    })
    .join('');

  const variableMarkup =
    rows.length > 0
      ? rows
          .map((row, rowIndex) => svgText(truncate(row, 38), 644, 172 + rowIndex * 26, 'value'))
          .join('')
      : svgText('No locals in this frame', 644, 172, 'muted');

  const stdoutMarkup =
    stdoutLines.length > 0
      ? stdoutLines
          .map((line, lineIndex) =>
            svgText(truncate(line, 104), 48, 498 + lineIndex * 18, 'console'),
          )
          .join('')
      : svgText('stdout is empty at this step', 48, 498, 'muted');

  return `
    <g class="frame" style="animation-name: frame-${frameIndex};">
      <text class="badge" x="760" y="52">frame ${frameIndex + 1}/${frameCount}</text>
      <text class="meta" x="760" y="76">step ${index + 1}/${run.steps.length}</text>
      <rect class="panel" x="32" y="96" width="560" height="350" rx="12" />
      <rect class="panel" x="616" y="96" width="312" height="350" rx="12" />
      ${svgText(`line ${activeLine} - ${eventLabel(step)}`, 48, 124, 'section-title')}
      ${codeMarkup}
      ${svgText('Frame', 644, 124, 'section-title')}
      ${svgText(frameName, 644, 150, 'frame-name')}
      ${variableMarkup}
      <rect class="console-box" x="32" y="466" width="896" height="50" rx="10" />
      ${stdoutMarkup}
    </g>`;
}

export function buildTraceSvgExport(
  code: string,
  result: SessionResult | null,
): TraceSvgExport | null {
  const run = result?.run;
  if (!run || run.steps.length === 0) {
    return null;
  }

  const codeLines = code.replace(/\r\n?/g, '\n').split('\n');
  const frames = selectedFrames(run.steps);
  const functionName = run.functionName ?? 'script';
  const generatedAt = new Date().toISOString();
  const title = `Code Visualizer - ${functionName}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" role="img" aria-label="${escapeXml(title)}">
  <title>${escapeXml(title)}</title>
  <style><![CDATA[
    svg { background: #0f172a; color: #e5e7eb; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    text { dominant-baseline: alphabetic; }
    .title { fill: #f8fafc; font-size: 24px; font-weight: 700; }
    .subtitle, .meta, .muted { fill: #94a3b8; font-size: 13px; }
    .badge { fill: #a7f3d0; font-size: 13px; font-weight: 700; text-anchor: end; }
    .panel, .console-box { fill: #111827; stroke: #334155; stroke-width: 1; }
    .section-title { fill: #cbd5e1; font-size: 14px; font-weight: 700; }
    .line-number { fill: #64748b; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; text-anchor: end; }
    .code, .value, .console, .frame-name { fill: #e2e8f0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
    .active-code { fill: #f8fafc; font-weight: 700; }
    .active-line { fill: #2563eb; opacity: 0.32; }
    ${keyframeCss(frames.length)}
  ]]></style>
  <rect x="0" y="0" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" fill="#0f172a" />
  ${svgText('Code Visualizer Trace', 32, 48, 'title')}
  ${svgText(
    `${functionName} - ${run.steps.length} steps - exported ${generatedAt}`,
    32,
    74,
    'subtitle',
  )}
  ${frames.map((frame, index) => frameSvg(frame, index, frames.length, run, codeLines)).join('\n')}
</svg>`;

  return {
    filename: `code-visualizer-trace-${Date.now()}.svg`,
    svg,
  };
}
