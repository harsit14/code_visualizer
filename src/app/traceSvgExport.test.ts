import { describe, expect, it } from 'vitest';
import { buildTraceSvgExport } from './traceSvgExport';
import type { EncodedValue, SessionResult, TraceStep } from '../engine/types';

const num = (value: number): EncodedValue => ({ k: 'num', t: 'int', v: String(value) });

const step: TraceStep = {
  i: 0,
  event: 'line',
  line: 2,
  func: 'solve',
  stack: [
    {
      id: 'frame-1',
      func: 'solve',
      qualname: 'solve',
      line: 2,
      locals: { total: num(3), raw: { k: 'str', v: '<tag>', truncated: false } },
    },
  ],
  globals: {},
  stdoutLen: 2,
};

const result: SessionResult = {
  status: 'ok',
  mode: 'function',
  analysis: null,
  error: null,
  durationMs: 12,
  run: {
    functionName: 'solve',
    inputs: [],
    seed: null,
    steps: [step],
    returnValue: null,
    exception: null,
    setupError: null,
    stdout: 'ok\n',
    stderr: '',
    opCount: 1,
    truncated: false,
    truncationReason: null,
  },
};

describe('buildTraceSvgExport', () => {
  it('builds a self-contained animated SVG trace', () => {
    const exportData = buildTraceSvgExport('def solve():\n    return "<tag>"', result);

    expect(exportData?.filename).toMatch(/^code-visualizer-trace-\d+\.svg$/);
    expect(exportData?.svg).toContain('<svg');
    expect(exportData?.svg).toContain('@keyframes frame-0');
    expect(exportData?.svg).toContain('Code Visualizer Trace');
    expect(exportData?.svg).toContain('total = 3');
    expect(exportData?.svg).toContain('&lt;tag&gt;');
    expect(exportData?.svg).toContain('ok');
  });

  it('returns null without a completed run', () => {
    expect(buildTraceSvgExport('x = 1', null)).toBeNull();
    expect(buildTraceSvgExport('x = 1', { ...result, run: null })).toBeNull();
  });
});
