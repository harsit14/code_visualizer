import { describe, expect, it } from 'vitest';
import { runJavaScriptTrace } from './jsTraceEngine';
import { normalizeBookmarks, parseTraceQuery, searchTrace } from './traceSearch';

const source = `function add(total, n) {
  return total + n;
}
let total = 0;
const seen = new Map();
for (const n of [2, 4]) {
  total = add(total, n);
  seen.set(n, total);
  console.log('total is', total);
}
null.boom;`;

const result = runJavaScriptTrace(source, 'javascript');
const steps = result.run!.steps;
const stdout = result.run!.stdout;

describe('parseTraceQuery', () => {
  it.each([
    ['line 7', { kind: 'line', line: 7 }],
    ['L7', { kind: 'line', line: 7 }],
    [':7', { kind: 'line', line: 7 }],
    ['fn add', { kind: 'function', name: 'add' }],
    ['add()', { kind: 'function', name: 'add' }],
    ['returns', { kind: 'event', event: 'return' }],
    ['error', { kind: 'event', event: 'exception' }],
    ['print total is', { kind: 'output', text: 'total is' }],
    ['"total is 6"', { kind: 'output', text: 'total is 6' }],
    ['total = 6', { kind: 'variable', name: 'total', value: '6' }],
    ["name == 'ab'", { kind: 'variable', name: 'name', value: 'ab' }],
    ['seen[4]', { kind: 'variable', name: 'seen[4]', value: null }],
    ['self.memo', { kind: 'variable', name: 'self.memo', value: null }],
    ['total', { kind: 'variable', name: 'total', value: null }],
    ['boom!', { kind: 'text', text: 'boom!' }],
    ['   ', null],
  ])('parses %j', (input, expected) => {
    expect(parseTraceQuery(input)).toEqual(expected);
  });
});

describe('searchTrace', () => {
  const search = (text: string, limit?: number) =>
    searchTrace(steps, parseTraceQuery(text)!, stdout, limit);

  it('finds steps where a variable changed, optionally to a value', () => {
    const changed = search('total');
    expect(changed.hits.map((hit) => hit.detail)).toEqual([
      'total: absent → 0',
      'total: 0 → 2',
      'total: 2 → 6',
    ]);
    const six = search('total = 6');
    expect(six.hits).toHaveLength(1);
    expect(six.hits[0]).toMatchObject({ line: 7, detail: 'total: 2 → 6' });
    expect(search('seen[4]').hits.map((hit) => hit.detail)).toEqual(['seen[4]: absent → 6']);
  });

  it('finds lines, functions, events, output and free text', () => {
    expect(search('line 8').hits.every((hit) => hit.line === 8)).toBe(true);
    expect(search('line 8').total).toBe(2);
    expect(search('fn add').hits[0].detail).toBe('call add() · line 1');
    expect(search('return').hits.map((hit) => hit.detail)).toEqual([
      'add() returned',
      'add() returned',
    ]);
    expect(search('exception').hits.at(-1)!.detail).toContain('TypeError');
    expect(search('print total is 6').hits).toHaveLength(1);
    expect(search('boom').hits.length).toBeGreaterThan(0);
  });

  it('caps hits but still counts every match', () => {
    const capped = search('line 7', 1);
    expect(capped.hits).toHaveLength(1);
    expect(capped.total).toBeGreaterThan(1);
  });
});

describe('normalizeBookmarks', () => {
  it('sorts, removes duplicates and drops steps outside the trace', () => {
    expect(
      normalizeBookmarks(
        [
          { step: 4, note: 'later' },
          { step: 1, note: 'first' },
          { step: 4, note: 'updated' },
          { step: 99, note: 'gone' },
          { step: -1, note: 'bad' },
        ],
        10,
      ),
    ).toEqual([
      { step: 1, note: 'first' },
      { step: 4, note: 'updated' },
    ]);
  });
});
