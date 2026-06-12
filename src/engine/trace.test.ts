import { describe, expect, it } from 'vitest';
import {
  diffLocals,
  findArrayPointers,
  fitGrowth,
  formatValue,
  groupChains,
  stdoutAtStep,
} from './trace';
import type { EncodedValue, TraceStep } from './types';

const chain = (id: number, nodeIds: number[], values: number[]): EncodedValue => ({
  k: 'listnode',
  id,
  nodes: nodeIds.map((nodeId, index) => ({ id: nodeId, val: num(values[index]) })),
  cyclic: false,
  truncated: false,
});

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
const set = (id: number, values: number[]): EncodedValue => ({
  k: 'seq',
  t: 'set',
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

  it('does not mark scalar k values as string indexes', () => {
    const pointers = findArrayPointers({ s: str('dcadabb'), k: num(4), l: num(0), r: num(1) });
    expect(pointers.get('s')).toEqual([
      { name: 'l', index: 0 },
      { name: 'r', index: 1 },
    ]);
  });

  it('uses source hints to avoid attaching indexes to unrelated arrays', () => {
    const pointers = findArrayPointers(
      {
        nums: list(1, [4, 5, 6]),
        window: list(2, [5, 6]),
        i: num(1),
      },
      { nums: ['i'] },
    );
    expect(pointers.get('nums')).toEqual([{ name: 'i', index: 1 }]);
    expect(pointers.has('window')).toBe(false);
  });

  it('does not fall back to name guesses when source hints are present', () => {
    const pointers = findArrayPointers({ nums: list(1, [4, 5, 6]), i: num(1) }, {});
    expect(pointers.has('nums')).toBe(false);
  });

  it('does not mark pointers on sets', () => {
    const pointers = findArrayPointers({ seen: set(1, [4, 5, 6]), i: num(1) }, { seen: ['i'] });
    expect(pointers.has('seen')).toBe(false);
  });

  it('shares source-hinted pointers across list aliases', () => {
    const shared = list(1, [4, 5, 6]);
    const pointers = findArrayPointers({ nums: shared, arr: shared, i: num(1) }, { arr: ['i'] });
    expect(pointers.get('nums')).toEqual([{ name: 'i', index: 1 }]);
    expect(pointers.get('arr')).toEqual([{ name: 'i', index: 1 }]);
  });
});

describe('groupChains', () => {
  it('renders mid-chain pointers as markers on the owning chain', () => {
    const groups = groupChains({
      head: chain(1, [1, 2, 3], [1, 2, 3]),
      slow: chain(2, [2, 3], [2, 3]),
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].names).toEqual(['head']);
    expect(groups[0].labels.get(2)).toEqual(['slow']);
  });

  it('merges aliases sharing a head node into one card', () => {
    // curr and nxt both start at node 5 (the reverse-list `nxt = curr` moment)
    const groups = groupChains({
      curr: chain(5, [5, 6, 7], [5, 6, 7]),
      nxt: chain(5, [5, 6, 7], [5, 6, 7]),
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].names).toEqual(['curr', 'nxt']);
    expect(groups[0].labels.get(5)).toEqual(['curr', 'nxt']);
  });

  it('keeps disjoint chains as separate cards', () => {
    const groups = groupChains({
      prev: chain(1, [1, 2], [13, 15]),
      curr: chain(3, [3, 4], [2, 19]),
    });
    expect(groups.map((group) => group.names[0]).sort()).toEqual(['curr', 'prev']);
  });

  it('ignores empty chains and non-chain locals', () => {
    expect(groupChains({ x: num(1) })).toEqual([]);
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
