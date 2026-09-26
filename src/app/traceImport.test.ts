import { describe, expect, it } from 'vitest';
import { runJavaScriptTrace } from '../engine/jsTraceEngine';
import { parseTraceImport } from './traceImport';

const payload = () => ({
  version: 2,
  code: 'const a = [1];',
  language: 'javascript',
  step: 99,
  result: runJavaScriptTrace('const a = [1];', 'javascript'),
});

describe('parseTraceImport', () => {
  it('round trips an exported trace and clamps its replay position', () => {
    const exported = payload();
    const imported = parseTraceImport(JSON.stringify(exported));
    expect(imported.result).toEqual(exported.result);
    expect(imported.step).toBe(exported.result.run!.steps.length - 1);
  });

  it('carries bookmarks and ordered checkpoints, and imports older files without them', () => {
    const exported = {
      ...payload(),
      bookmarks: [
        { step: 1, note: 'second' },
        { step: 0, note: 'first' },
        { step: 400, note: 'outside the trace' },
      ],
      checkpoints: [1, 0, 1, 400],
    };
    const imported = parseTraceImport(JSON.stringify(exported));
    expect(imported.bookmarks).toEqual([
      { step: 0, note: 'first' },
      { step: 1, note: 'second' },
    ]);
    expect(imported.checkpoints).toEqual([1, 0]);
    const legacy = parseTraceImport(JSON.stringify(payload()));
    expect(legacy.bookmarks).toEqual([]);
    expect(legacy.checkpoints).toEqual([]);
  });

  it.each([
    { bookmarks: [{ step: -1, note: '' }] },
    { bookmarks: [{ step: 0, note: 5 }] },
    { bookmarks: 'none' },
    { checkpoints: ['0'] },
    { checkpoints: Array.from({ length: 501 }, () => 0) },
  ])('rejects malformed annotations %#', (annotations) => {
    expect(() => parseTraceImport(JSON.stringify({ ...payload(), ...annotations }))).toThrow(
      'Invalid trace bookmarks or checkpoints.',
    );
  });

  it('normalizes legacy timing while validating the same trace structure', () => {
    const legacy = { ...payload(), version: 1, language: undefined };
    legacy.result.run!.steps.forEach((s) => {
      delete s.phase;
    });
    expect(parseTraceImport(JSON.stringify(legacy)).result.run!.steps[0].phase).toBe('before');
  });

  it.each([
    (p: ReturnType<typeof payload>) => {
      p.version = 999;
    },
    (p: ReturnType<typeof payload>) => {
      p.result.run!.steps[0].stack[0].locals.a = { k: 'seq', items: [null] } as never;
    },
    (p: ReturnType<typeof payload>) => {
      p.result.run!.steps[0].i = 50;
    },
    (p: ReturnType<typeof payload>) => {
      p.result.run!.steps[0].stdoutLen = 100;
    },
    (p: ReturnType<typeof payload>) => {
      p.result.run!.steps[0].stack = null as never;
    },
    (p: ReturnType<typeof payload>) => {
      p.result.analysis!.functions = [{}] as never;
    },
  ])('rejects malformed nested replay data', (mutate) => {
    const exported = payload();
    mutate(exported);
    expect(() => parseTraceImport(JSON.stringify(exported))).toThrow();
  });

  it('rejects excessive nesting and prototype keys without traversing indefinitely', () => {
    const exported = payload();
    let nested: unknown = { k: 'none' };
    for (let i = 0; i < 45; i++)
      nested = { k: 'seq', id: i, t: 'list', len: 1, truncated: false, items: [nested] };
    exported.result.run!.steps[0].globals = { nested } as never;
    expect(() => parseTraceImport(JSON.stringify(exported))).toThrow();
    exported.result.run!.steps[0].globals = JSON.parse('{"__proto__":{"k":"none"}}');
    expect(() => parseTraceImport(JSON.stringify(exported))).toThrow();
  });

  it('accepts many shallow globals without treating their index as nesting depth', () => {
    const exported = payload();
    exported.result.run!.steps[0].globals = Object.fromEntries(
      Array.from({ length: 60 }, (_, i) => [`v${i}`, { k: 'none' as const }]),
    );
    expect(() => parseTraceImport(JSON.stringify(exported))).not.toThrow();
  });
});
