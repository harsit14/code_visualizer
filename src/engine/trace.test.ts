import { describe, expect, it } from 'vitest';
import {
  diffLocals,
  findArrayPointers,
  findChainPointers,
  fitGrowth,
  formatValue,
  stdoutAtStep,
} from './trace';
import type { EncodedValue, TraceStep } from './types';

const num = (v: number): EncodedValue => ({ k: 'num', t: 'int', v: String(v) });
const str = (v: string): EncodedValue => ({ k: 'str', v, truncated: false });
const list = (id: number, values: number[]): EncodedValue => ({
  k: 'seq',
  t: 'list',
  id,
  items: values.map(num),
  len: values.length,
  truncated: false,
});

describe('formatValue', () => {
  it('formats primitives', () => {
    expect(formatValue(num(5))).toBe('5');
    expect(formatValue(str('hi'))).toBe("'hi'");
    expect(formatValue({ k: 'none' })).toBe('None');
  });

  it('formats collections', () => {
    expect(formatValue(list(1, [1, 2, 3]))).toBe('[1, 2, 3]');
    expect(
      formatValue({
        k: 'dict',
        id: 2,
        entries: [[str('a'), num(1)]],
        len: 1,
        truncated: false,
      }),
    ).toBe("{'a': 1}");
  });

  it('formats truncated lists with a count', () => {
    const value: EncodedValue = {
      k: 'seq',
      t: 'list',
      id: 3,
      items: [num(1)],
      len: 100,
      truncated: true,
    };
    expect(formatValue(value)).toBe('[1, …+99]');
  });

  it('formats linked list chains as arrows', () => {
    const chain: EncodedValue = {
      k: 'listnode',
      id: 1,
      nodes: [
        { id: 1, val: num(1) },
        { id: 2, val: num(2) },
      ],
      cyclic: false,
      truncated: false,
    };
    expect(formatValue(chain)).toBe('1 → 2');
  });

  it('marks cyclic chains', () => {
    const chain: EncodedValue = {
      k: 'listnode',
      id: 1,
      nodes: [{ id: 1, val: num(1) }],
      cyclic: true,
      truncated: false,
    };
    expect(formatValue(chain)).toBe('1 ↻');
  });
});

describe('diffLocals', () => {
  it('detects added, changed, and removed names', () => {
    const diff = diffLocals(
      { a: num(1), b: num(2), gone: num(9) },
      { a: num(1), b: num(3), fresh: num(0) },
    );
    expect(diff.added).toEqual(new Set(['fresh']));
    expect(diff.changed).toEqual(new Set(['b']));
    expect(diff.removed).toEqual(new Set(['gone']));
  });

  it('treats everything as added when there is no previous step', () => {
    const diff = diffLocals(undefined, { a: num(1) });
    expect(diff.added).toEqual(new Set(['a']));
  });
});

describe('findArrayPointers', () => {
  it('attaches pointer-named ints to arrays they can index', () => {
    const pointers = findArrayPointers({
      nums: list(1, [4, 5, 6]),
      i: num(1),
      left: num(0),
      total: num(99), // not a pointer name
    });
    expect(pointers.get('nums')).toEqual([
      { name: 'i', index: 1 },
      { name: 'left', index: 0 },
    ]);
  });

  it('ignores out-of-range values', () => {
    const pointers = findArrayPointers({ nums: list(1, [4, 5]), i: num(7) });
    expect(pointers.has('nums')).toBe(false);
  });

  it('marks pointers on strings too', () => {
    const pointers = findArrayPointers({ s: str('abc'), lo: num(0), hi: num(3) });
    expect(pointers.get('s')).toHaveLength(2);
  });
});

describe('findChainPointers', () => {
  it('finds locals pointing into another chain', () => {
    const head: EncodedValue = {
      k: 'listnode',
      id: 1,
      nodes: [
        { id: 1, val: num(1) },
        { id: 2, val: num(2) },
        { id: 3, val: num(3) },
      ],
      cyclic: false,
      truncated: false,
    };
    const slow: EncodedValue = {
      k: 'listnode',
      id: 2,
      nodes: [
        { id: 2, val: num(2) },
        { id: 3, val: num(3) },
      ],
      cyclic: false,
      truncated: false,
    };
    const pointers = findChainPointers({ head, slow });
    expect(pointers.get('head')).toEqual([{ name: 'slow', nodeId: 2 }]);
  });
});

describe('fitGrowth', () => {
  it('labels linear growth', () => {
    expect(
      fitGrowth([
        { n: 4, ops: 40 },
        { n: 8, ops: 82 },
        { n: 16, ops: 158 },
        { n: 32, ops: 330 },
      ]),
    ).toBe('O(n)');
  });

  it('labels quadratic growth', () => {
    expect(
      fitGrowth([
        { n: 4, ops: 20 },
        { n: 8, ops: 70 },
        { n: 16, ops: 270 },
        { n: 32, ops: 1060 },
      ]),
    ).toBe('O(n²)');
  });

  it('labels constant growth', () => {
    expect(
      fitGrowth([
        { n: 4, ops: 6 },
        { n: 8, ops: 6 },
        { n: 16, ops: 6 },
      ]),
    ).toBe('O(1)');
  });

  it('returns null with too few samples', () => {
    expect(fitGrowth([{ n: 4, ops: 10 }])).toBeNull();
  });
});

describe('stdoutAtStep', () => {
  it('slices stdout to the step prefix', () => {
    const step = { stdoutLen: 3 } as TraceStep;
    expect(stdoutAtStep('ab\ncd\n', step)).toBe('ab\n');
    expect(stdoutAtStep('ab\n', undefined)).toBe('');
  });
});
