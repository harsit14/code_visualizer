/**
 * Standalone replay export: one HTML file that replays a recorded run with a
 * small vanilla player. It needs no network and executes no traced code; the
 * trace is pre-formatted into plain strings and embedded as a JSON data block.
 *
 * Safety relies on three layers: the data block escapes every character that
 * could end the script element, the player only ever assigns textContent, and
 * a strict CSP pins the inline player and style by hash.
 */
import { checkpointCaptions, type Checkpoint } from '../engine/traceCheckpoints';
import type { TraceBookmark } from '../engine/traceSearch';
import { diffLocals, expandSelf, formatValue } from '../engine/trace';
import type { EncodedValue, Language, SessionResult, TracePhase, TraceStep } from '../engine/types';
import playerScript from './replayPlayer.js?raw';
import { cspHash } from './sha256';

export const MAX_REPLAY_STEPS = 5_000;
export const MAX_REPLAY_BYTES = 8 * 1024 * 1024;
const MAX_VALUE_CHARS = 240;
const MAX_VARIABLES = 60;

export const REPLAY_PLAYER_SCRIPT = playerScript;

/* Neutral colors that read well in either scheme; no fonts or images to fetch. */
export const REPLAY_STYLE = `
:root { color-scheme: light dark; --bg: #f7f7f5; --panel: #ffffff; --text: #1f2328; --dim: #57606a; --line: #d0d7de; --mark: #fff1c2; --mark-edge: #b88700; --accent: #0b5cad; --changed: #8a5a00; --new: #1a7f37; }
@media (prefers-color-scheme: dark) { :root { --bg: #16181c; --panel: #1f2227; --text: #e6e6e6; --dim: #a0a7b0; --line: #3a3f47; --mark: #4a3d12; --mark-edge: #e3b341; --accent: #6cb6ff; --changed: #e3b341; --new: #56d364; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
.replay { display: flex; flex-direction: column; gap: 12px; margin: 0 auto; max-width: 1280px; min-height: 100vh; padding: 16px; }
.replay h1 { font-size: 20px; margin: 0; }
.replay h2 { color: var(--dim); font-size: 13px; letter-spacing: 0.06em; margin: 0 0 8px; text-transform: uppercase; }
.meta, .note, .hint { color: var(--dim); font-size: 14px; margin: 2px 0 0; }
.note { border-left: 3px solid var(--mark-edge); padding-left: 8px; }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; min-width: 0; padding: 12px; }
.caption { align-items: center; display: flex; flex-wrap: wrap; gap: 8px 12px; }
.caption[hidden] { display: none; }
.caption-live { flex: 1 1 280px; min-width: 0; }
.caption-label { color: var(--dim); display: block; font-size: 14px; }
.caption-text { display: block; font-size: 19px; overflow-wrap: anywhere; white-space: pre-wrap; }
.layout { display: grid; gap: 12px; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); }
.side { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.phase { font-size: 14px; margin: 0 0 8px; }
.code { font: 15px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; list-style: none; margin: 0; max-height: 60vh; overflow: auto; padding: 0; position: relative; }
.code li { display: grid; gap: 12px; grid-template-columns: 3.5em minmax(0, 1fr); padding: 0 8px; }
.code .num { color: var(--dim); text-align: right; user-select: none; }
.code .src { white-space: pre-wrap; overflow-wrap: anywhere; }
.code li.current { background: var(--mark); box-shadow: inset 4px 0 0 var(--mark-edge); }
table { border-collapse: collapse; font-size: 15px; width: 100%; }
th { color: var(--dim); font-size: 13px; font-weight: 600; text-align: left; }
th, td { border-bottom: 1px solid var(--line); padding: 4px 8px 4px 0; vertical-align: top; }
td { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
tr.changed td { color: var(--changed); }
tr.new td { color: var(--new); }
.badge { font-family: system-ui, sans-serif; font-size: 12px; margin-left: 6px; }
pre.out { font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; margin: 0; max-height: 30vh; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
.controls { align-items: center; display: flex; flex-wrap: wrap; gap: 8px 12px; }
.buttons { display: flex; flex-wrap: wrap; gap: 6px; }
button { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; color: var(--text); cursor: pointer; font: inherit; font-size: 15px; min-height: 44px; min-width: 44px; padding: 6px 12px; }
button[aria-disabled='true'] { cursor: default; opacity: 0.45; }
button:focus-visible, input:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
input[type='range'] { accent-color: var(--accent); flex: 1 1 240px; min-height: 44px; }
.status { flex: 1 1 100%; font-size: 15px; margin: 0; }
.sr-only { clip-path: inset(50%); height: 1px; overflow: hidden; position: absolute; white-space: nowrap; width: 1px; }
@media (max-width: 720px) { .layout { grid-template-columns: minmax(0, 1fr); } .replay { padding: 10px; } .code { max-height: 45vh; } }
`;

export type ReplayStep = {
  line: number;
  event: TraceStep['event'];
  phase: TracePhase;
  /** String-table index of the frame label, such as "module" or "solve()". */
  frame: number;
  depth: number;
  /** Length of stdout printed up to and including this step. */
  out: number;
  /** [name, value, change] triples: string-table indices, then 0 same, 1 changed, 2 new. */
  vars: number[];
  /** Variables left out of a very large frame. */
  hidden: number;
  /** String-table index of an event detail (return value, exception), or -1. */
  detail: number;
};

export type ReplayData = {
  format: 'code-visualizer-replay';
  version: 1;
  title: string;
  language: Language;
  exportedAt: string;
  code: string;
  stdout: string;
  strings: string[];
  steps: ReplayStep[];
  /** Presentation order, each with its bookmark note as the caption. */
  checkpoints: Checkpoint[];
  start: number;
  totalSteps: number;
  /** Visible notes, for example when the replay was trimmed. */
  notes: string[];
};

export type ReplayInput = {
  bookmarks: readonly TraceBookmark[];
  checkpoints: readonly number[];
  code: string;
  language: Language;
  result: SessionResult;
  step: number;
};

export type ReplayExport =
  | { ok: true; html: string; filename: string; trimmed: boolean; notes: string[]; bytes: number }
  | { ok: false; error: string };

const LANGUAGE_NAMES: Record<Language, string> = {
  python: 'Python',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
};

function clip(text: string): string {
  return text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS - 1)}…` : text;
}

function stepDetail(step: TraceStep): string | null {
  if (step.exc) return `${step.exc.type}: ${step.exc.msg}`;
  if (step.event === 'return') {
    return step.ret !== undefined ? `returned ${formatValue(step.ret)}` : 'returned';
  }
  if (step.event === 'call')
    return `call ${step.func === '<module>' ? 'module' : `${step.func}()`}`;
  return null;
}

function frameLocals(step: TraceStep, index: number): Record<string, EncodedValue> {
  const frame = step.stack[index];
  return frame ? expandSelf(frame.locals) : step.globals;
}

/** Pre-formats the replay-relevant part of a run into plain strings. */
export function buildReplayData(input: ReplayInput, exportedAt = new Date()): ReplayData {
  const run = input.result.run;
  const allSteps = run?.steps ?? [];
  const steps = allSteps.slice(0, MAX_REPLAY_STEPS);
  const strings: string[] = [];
  const stringIndex = new Map<string, number>();
  const intern = (text: string) => {
    let index = stringIndex.get(text);
    if (index === undefined) {
      index = strings.push(text) - 1;
      stringIndex.set(text, index);
    }
    return index;
  };

  const replaySteps = steps.map((step, index): ReplayStep => {
    const top = step.stack.length - 1;
    const frame = step.stack[top];
    const locals = frameLocals(step, top);
    const previous = allSteps[index - 1];
    const previousFrame = frame ? previous?.stack.find((item) => item.id === frame.id) : undefined;
    const diff = diffLocals(
      previousFrame
        ? expandSelf(previousFrame.locals)
        : !frame && previous
          ? previous.globals
          : undefined,
      locals,
    );
    const entries = Object.entries(locals).filter(([, value]) => value.k !== 'func');
    const vars: number[] = [];
    for (const [name, value] of entries.slice(0, MAX_VARIABLES)) {
      vars.push(
        intern(name),
        intern(clip(formatValue(value))),
        diff.added.has(name) ? 2 : diff.changed.has(name) ? 1 : 0,
      );
    }
    const detail = stepDetail(step);
    return {
      line: step.line,
      event: step.event,
      phase: step.phase ?? (step.event === 'line' ? 'before' : 'event'),
      frame: intern(!frame || frame.func === '<module>' ? 'module' : `${frame.func}()`),
      depth: step.stack.length,
      out: step.stdoutLen,
      vars,
      hidden: Math.max(0, entries.length - MAX_VARIABLES),
      detail: detail === null ? -1 : intern(clip(detail)),
    };
  });

  const notes: string[] = [];
  if (allSteps.length > steps.length) {
    notes.push(
      `This replay includes the first ${steps.length.toLocaleString('en-US')} of ${allSteps.length.toLocaleString('en-US')} recorded steps.`,
    );
  }
  const checkpoints = checkpointCaptions(input.checkpoints, input.bookmarks);
  const kept = checkpoints.filter((checkpoint) => checkpoint.step < steps.length);
  if (kept.length < checkpoints.length) {
    const dropped = checkpoints.length - kept.length;
    notes.push(
      `${dropped} checkpoint${dropped === 1 ? '' : 's'} after the last included step ${dropped === 1 ? 'was' : 'were'} left out.`,
    );
  }
  if (run?.truncated) {
    notes.push(
      `The original run stopped early${run.truncationReason ? `: ${run.truncationReason}` : '.'}`,
    );
  }
  const lastStep = steps[steps.length - 1];

  return {
    format: 'code-visualizer-replay',
    version: 1,
    title: run?.functionName ? `${run.functionName}()` : 'Script',
    language: input.language,
    exportedAt: exportedAt.toISOString(),
    code: input.code.replace(/\r\n?/g, '\n'),
    stdout: (run?.stdout ?? '').slice(0, lastStep?.stdoutLen ?? 0),
    strings,
    steps: replaySteps,
    checkpoints: kept,
    start: Math.max(0, Math.min(input.step, steps.length - 1)),
    totalSteps: allSteps.length,
    notes,
  };
}

/**
 * JSON inside a script element must not contain "</script", "<!--" or line
 * separators that older parsers treat as line ends. Escaping every <, > and &
 * (plus U+2028/U+2029) keeps the text inert; JSON.parse restores them.
 */
export function escapeJsonForHtml(json: string): string {
  return json
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function escapeHtmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function replayContentSecurityPolicy(): string {
  // base-uri and form-action do not fall back to default-src.
  return [
    "default-src 'none'",
    `script-src ${cspHash(REPLAY_PLAYER_SCRIPT)}`,
    `style-src ${cspHash(REPLAY_STYLE)}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

export function buildReplayHtml(input: ReplayInput, exportedAt = new Date()): ReplayExport {
  if (!input.result.run || input.result.run.steps.length === 0) {
    return { ok: false, error: 'Run the code before exporting a replay.' };
  }
  const data = buildReplayData(input, exportedAt);
  const title = `${data.title} · ${LANGUAGE_NAMES[data.language]} replay`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${replayContentSecurityPolicy()}">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtmlText(title)}</title>
<style>${REPLAY_STYLE}</style>
</head>
<body>
<main class="replay" id="replay" aria-label="Trace replay"><noscript>This replay needs JavaScript to step through the recorded trace.</noscript></main>
<script type="application/json" id="replay-data">${escapeJsonForHtml(JSON.stringify(data))}</script>
<script>${REPLAY_PLAYER_SCRIPT}</script>
</body>
</html>
`;
  const bytes = new TextEncoder().encode(html).length;
  if (bytes > MAX_REPLAY_BYTES) {
    const size = (bytes / 1024 / 1024).toFixed(1);
    return {
      ok: false,
      error: `This replay would be ${size} MB; the limit is ${MAX_REPLAY_BYTES / 1024 / 1024} MB. Export a shorter run or one with smaller values.`,
    };
  }
  return {
    ok: true,
    html,
    filename: `code-visualizer-replay-${exportedAt.getTime()}.html`,
    trimmed: data.steps.length < data.totalSteps,
    notes: data.notes,
    bytes,
  };
}
