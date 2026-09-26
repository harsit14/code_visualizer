// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { runJavaScriptTrace } from '../engine/jsTraceEngine';
import type { SessionResult, TraceStep } from '../engine/types';
import {
  buildReplayData,
  buildReplayHtml,
  escapeJsonForHtml,
  MAX_REPLAY_BYTES,
  MAX_REPLAY_STEPS,
  REPLAY_PLAYER_SCRIPT,
  type ReplayInput,
} from './replayExport';

type ReplayWindow = Window & typeof globalThis & { __pwned?: unknown };
// Vitest's jsdom environment exposes its JSDOM instance; a fresh one runs the
// exported page's inline scripts in isolation.
const JSDOM = (
  globalThis as unknown as {
    jsdom: { constructor: new (html: string, options: object) => { window: ReplayWindow } };
  }
).jsdom.constructor;

const EVIL = '</script><img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>';
const code = [
  `const label = ${JSON.stringify(EVIL)};`,
  'let total = 0;',
  'for (let i = 1; i <= 3; i++) {',
  '  total += i;',
  '}',
  'console.log(label, total, "\\u2028<!--");',
  `// ${EVIL}`,
].join('\n');
const result = runJavaScriptTrace(code, 'javascript');
const exportedAt = new Date('2026-09-25T12:00:00Z');
const input: ReplayInput = {
  bookmarks: [
    { step: 2, note: EVIL },
    { step: 5, note: 'total grows' },
  ],
  // Presentation order differs from trace order on purpose.
  checkpoints: [5, 2],
  code,
  language: 'javascript',
  result,
  step: 0,
};

function exported() {
  const replay = buildReplayHtml(input, exportedAt);
  if (!replay.ok) throw new Error(replay.error);
  return replay;
}

function play(html: string) {
  const dom = new JSDOM(html, { runScripts: 'dangerously' });
  const { document } = dom.window;
  const press = (key: string) =>
    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true }));
  const click = (name: string) =>
    [...document.querySelectorAll('button')].find((node) => node.textContent === name)!.click();
  const read = (selector: string) => document.querySelector(selector)!.textContent;
  return { dom, document, press, click, read };
}

function syntheticResult(count: number, stdout = ''): SessionResult {
  const steps: TraceStep[] = Array.from({ length: count }, (_, i) => ({
    i,
    event: 'line',
    phase: i % 2 ? 'after' : 'before',
    line: 1,
    func: '<module>',
    stack: [
      { id: 'm', func: '<module>', line: 1, locals: { i: { k: 'num', t: 'int', v: `${i}` } } },
    ],
    globals: {},
    stdoutLen: stdout.length,
  }));
  return {
    status: 'ok',
    mode: 'script',
    analysis: null,
    error: null,
    durationMs: 1,
    run: {
      functionName: null,
      inputs: [],
      seed: null,
      steps,
      returnValue: null,
      exception: null,
      stdout,
      stderr: '',
      opCount: count,
      runtimeMs: 1,
      memoryMb: null,
      truncated: false,
      truncationReason: null,
    },
  };
}

describe('standalone replay export', () => {
  it('embeds the trace as inert JSON that round-trips exactly', () => {
    const { html } = exported();
    expect(html).not.toContain(EVIL);
    expect(html).not.toContain('<!--');
    expect(html).not.toMatch(/[\u2028\u2029]/);
    expect(html.match(/<\/script/gi)).toHaveLength(2);

    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelectorAll('script')).toHaveLength(2);
    expect(doc.querySelectorAll('img, iframe, object, embed, link, base, form')).toHaveLength(0);
    const data = JSON.parse(doc.getElementById('replay-data')!.textContent!);
    expect(data).toEqual(buildReplayData(input, exportedAt));
    expect(data.code).toBe(code);
    expect(data.checkpoints).toEqual([
      { step: 5, note: 'total grows' },
      { step: 2, note: EVIL },
    ]);
  });

  it('escapes every character that could end the data block', () => {
    const escaped = escapeJsonForHtml(JSON.stringify({ text: '</script>&<!--\u2028\u2029' }));
    expect(escaped).not.toMatch(/[<>&\u2028\u2029]/);
    expect(JSON.parse(escaped)).toEqual({ text: '</script>&<!--\u2028\u2029' });
  });

  it('pins the inline player and style with a strict hash-based CSP', () => {
    const doc = new DOMParser().parseFromString(exported().html, 'text/html');
    const policy = doc
      .querySelector('meta[http-equiv="Content-Security-Policy"]')!
      .getAttribute('content')!;
    const directives = Object.fromEntries(
      policy.split(';').map((part) => {
        const [name, ...values] = part.trim().split(/\s+/);
        return [name, values.join(' ')];
      }),
    );
    const hash = (text: string) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;
    const player = doc.querySelectorAll('script')[1].textContent!;
    expect(player).toBe(REPLAY_PLAYER_SCRIPT);
    expect(directives).toEqual({
      'default-src': "'none'",
      'script-src': hash(player),
      'style-src': hash(doc.querySelector('style')!.textContent!),
      'base-uri': "'none'",
      'form-action': "'none'",
    });
    expect(policy).not.toContain('unsafe');
    // The meta policy must be parsed before any script or style.
    expect(doc.head.firstElementChild?.getAttribute('charset')).toBe('utf-8');
    expect(doc.head.children[1].getAttribute('http-equiv')).toBe('Content-Security-Policy');
    expect(REPLAY_PLAYER_SCRIPT).not.toMatch(/<\/?script|<!--/i);
  });

  it('replays code, variables, output and captions without executing injected markup', () => {
    const { dom, document, press, click, read } = play(exported().html);
    expect(dom.window.__pwned).toBeUndefined();
    expect(document.querySelectorAll('img')).toHaveLength(0);
    const lines = document.querySelectorAll('.code li');
    expect(lines).toHaveLength(code.split('\n').length);
    expect(lines[6].querySelector('.src')!.textContent).toBe(`// ${EVIL}`);
    expect(read('.status')).toContain('Step 0 /');
    expect(document.querySelector('.code li.current')).toBe(lines[0]);
    expect(read('.phase')).toBe('Line 1 · about to run (before execution)');

    click('Next');
    expect(read('.status')).toContain('Step 1 /');
    const labelRow = [...document.querySelectorAll('tbody tr')].find(
      (row) => row.firstElementChild?.textContent === 'label',
    );
    expect(labelRow?.lastElementChild?.firstChild?.textContent).toBe(`'${EVIL}'`);

    // Between checkpoints, "next" is the nearest later one; on a checkpoint
    // the presenter's order applies.
    press(']');
    expect(read('.caption-label')).toBe('Checkpoint 2 of 2 · step 2');
    expect(read('.caption-text')).toBe(EVIL);
    expect(document.querySelector('.caption-live')!.getAttribute('aria-live')).toBe('polite');
    press('[');
    expect(read('.caption-label')).toBe('Checkpoint 1 of 2 · step 5');
    expect(read('.caption-text')).toBe('total grows');
    press('PageUp');
    expect(read('.caption-label')).toBe('Checkpoint 1 of 2 · step 5');

    press('End');
    expect(read('pre.out')).toContain(`${EVIL} 6`);
    press('Home');
    expect(read('.status')).toContain('Step 0 /');
    expect(read('.caption-label')).toBe('');
    expect(read('.caption .hint')).toContain('Next: checkpoint 2 at step 2');
    expect(dom.window.__pwned).toBeUndefined();
    expect(document.querySelectorAll('img, script')).toHaveLength(2);
    dom.window.close();
  });

  it('labels line steps by their before/after execution phase', () => {
    const replay = buildReplayHtml({ ...input, result: syntheticResult(2), code: 'x = 1' });
    if (!replay.ok) throw new Error(replay.error);
    const { dom, press, read } = play(replay.html);
    expect(read('.phase')).toBe('Line 1 · about to run (before execution)');
    press('ArrowRight');
    expect(read('.phase')).toBe('Line 1 · just ran (after execution)');
    dom.window.close();
  });

  it('trims very long traces with a visible note', () => {
    const long = syntheticResult(MAX_REPLAY_STEPS + 1_000);
    const replay = buildReplayHtml({
      ...input,
      bookmarks: [{ step: MAX_REPLAY_STEPS + 10, note: 'late' }],
      checkpoints: [MAX_REPLAY_STEPS + 10],
      result: long,
      step: MAX_REPLAY_STEPS + 500,
    });
    if (!replay.ok) throw new Error(replay.error);
    expect(replay.trimmed).toBe(true);
    expect(replay.notes).toEqual([
      'This replay includes the first 5,000 of 6,000 recorded steps.',
      '1 checkpoint after the last included step was left out.',
    ]);
    const { dom, document, read } = play(replay.html);
    expect(read('.status')).toContain('Step 4999 / 4999');
    expect(document.querySelector('[role="note"]')!.textContent).toContain('first 5,000');
    expect((document.querySelector('.caption') as HTMLElement).hidden).toBe(true);
    dom.window.close();
  });

  it('refuses files above the size limit', () => {
    const replay = buildReplayHtml({
      ...input,
      checkpoints: [],
      result: syntheticResult(2, 'x'.repeat(MAX_REPLAY_BYTES)),
    });
    expect(replay.ok).toBe(false);
    expect(!replay.ok && replay.error).toMatch(/limit is 8 MB/);
  });
});
