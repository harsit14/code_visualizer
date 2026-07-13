import { describe, expect, it } from 'vitest';
import {
  collectStructures,
  diffLocals,
  findArrayPointers,
  findSharedReferences,
  fitGrowth,
  formatValue,
  groupChains,
  largestContainingChain,
  largestContainingTree,
  stdoutAtStep,
  variableTimeline,
} from './trace';
import type { EncodedValue, TraceStep } from './types';

type TreeValue = Extract<EncodedValue, { k: 'tree' }>;
type ChainValue = Extract<EncodedValue, { k: 'listnode' }>;

const chain = (id: number, nodeIds: number[], values: number[]): ChainValue => ({
  k: 'listnode',
  id,
  nodes: nodeIds.map((nodeId, index) => ({ id: nodeId, val: num(values[index]) })),
  cyclic: false,
  truncated: false,
});

const tree = (
  id: number,
  val: number,
  left: EncodedValue | null = null,
  right: EncodedValue | null = null,
): TreeValue => ({ k: 'tree', id, val: num(val), left, right });

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
  it('attaches source-hinted ints to their target arrays', () => {
    const pointers = findArrayPointers(
      {
        nums: list(1, [4, 5, 6]),
        i: num(1),
        left: num(0),
        total: num(99),
      },
      { nums: ['i', 'left'] },
    );
    expect(pointers.get('nums')).toEqual([
      { name: 'i', index: 1 },
      { name: 'left', index: 0 },
    ]);
  });

  it('ignores out-of-range values', () => {
    const pointers = findArrayPointers({ nums: list(1, [4, 5]), i: num(7) }, { nums: ['i'] });
    expect(pointers.has('nums')).toBe(false);
  });

  it('marks pointers on strings via source hints', () => {
    const pointers = findArrayPointers(
      { s: str('abc'), lo: num(0), hi: num(3) },
      { s: ['lo', 'hi'] },
    );
    expect(pointers.get('s')).toHaveLength(2);
  });

  it('marks pointers on strings via source hints, excludes non-hinted ints', () => {
    const pointers = findArrayPointers(
      { s: str('dcadabb'), k: num(4), l: num(0), r: num(1) },
      { s: ['l', 'r'] },
    );
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

  it('does NOT attach generic int locals as pointers when hints is undefined (nested functions, etc.)', () => {
    // Simulates a nested function where 'cur' is a profit counter, not an index
    const pointers = findArrayPointers({
      prices: list(1, [7, 1, 5, 3, 6, 4]),
      cur: num(0),
      first: num(0),
      last: num(5),
    });
    // 'cur' should NOT appear as a pointer to 'prices' since we have no hints
    expect(pointers.get('prices') ?? []).not.toEqual(
      expect.arrayContaining([{ name: 'cur', index: 0 }]),
    );
  });

  it('does NOT attach l/r ints to all in-range sequences when they are not pointers', () => {
    // l=5 and r=5 are arbitrary counts, not indices into prices.
    // Without source hints they should not be attached.
    const pointers = findArrayPointers({
      prices: list(1, [7, 1, 5, 3, 6, 4]),
      l: num(5),
      r: num(5),
    });
    expect(pointers.has('prices')).toBe(false);
  });

  it('does not attach end-value coincidences (k equals length of unrelated array)', () => {
    const pointers = findArrayPointers({
      nums: list(1, [1, 2, 3]),
      result: list(2, [0, 0, 0]),
      k: num(3), // k is a size param, happens to equal result.length
    });
    // k should not be attached to result (it's a count, not an index)
    expect(pointers.has('result')).toBe(false);
  });

  it('does not mark cur/curr/current as pointers without explicit source hints', () => {
    const pointers = findArrayPointers({
      arr: list(1, [10, 20, 30, 40]),
      cur: num(15), // out of range anyway
      curr: num(2), // in range! but is a state variable, not proven index
      current: num(1), // in range! same issue
    });
    expect(pointers.has('arr')).toBe(false);
  });

  it('does not attach step/position counters to arrays', () => {
    const pointers = findArrayPointers({
      data: list(1, [1, 2, 3, 4, 5]),
      start: num(0),
      end: num(5),
      idx: num(2),
      pos: num(1),
    });
    expect(pointers.has('data')).toBe(false);
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

  it('slices non-BMP output using Python UTF-16 offsets', () => {
    const step = { stdoutLen: 3 } as TraceStep;
    expect(stdoutAtStep('😀\nx\n', step)).toBe('😀\n');
  });
});

describe('variableTimeline', () => {
  it('tracks value changes for a variable in one frame', () => {
    const steps: TraceStep[] = [
      {
        i: 0,
        event: 'call',
        line: 1,
        func: 'f',
        stack: [{ id: 'frame-1', func: 'f', line: 1, locals: { x: num(1), y: num(0) } }],
        globals: {},
        stdoutLen: 0,
      },
      {
        i: 1,
        event: 'line',
        line: 2,
        func: 'f',
        stack: [{ id: 'frame-1', func: 'f', line: 2, locals: { x: num(2), y: num(1) } }],
        globals: {},
        stdoutLen: 0,
      },
      {
        i: 2,
        event: 'line',
        line: 3,
        func: 'f',
        stack: [{ id: 'frame-1', func: 'f', line: 3, locals: { x: num(2), y: num(3) } }],
        globals: {},
        stdoutLen: 0,
      },
    ];

    expect(variableTimeline(steps, 'frame-1', 'x')).toEqual([
      { step: 0, line: 1, executedLine: 1, event: 'call', value: '1', changedWith: ['y'] },
      { step: 1, line: 2, executedLine: 1, event: 'line', value: '2', changedWith: ['y'] },
    ]);
  });

  it('attributes a changed value to the line that just executed', () => {
    const steps: TraceStep[] = [
      {
        i: 0,
        event: 'line',
        line: 7,
        func: 'f',
        stack: [
          {
            id: 'frame-1',
            func: 'f',
            line: 7,
            locals: { lookup: { k: 'dict', id: 1, entries: [], len: 0, truncated: false } },
          },
        ],
        globals: {},
        stdoutLen: 0,
      },
      {
        i: 1,
        event: 'line',
        line: 4,
        func: 'f',
        stack: [
          {
            id: 'frame-1',
            func: 'f',
            line: 4,
            locals: {
              lookup: {
                k: 'dict',
                id: 1,
                entries: [[num(11), num(0)]],
                len: 1,
                truncated: false,
              },
            },
          },
        ],
        globals: {},
        stdoutLen: 0,
      },
    ];

    expect(variableTimeline(steps, 'frame-1', 'lookup')).toEqual([
      {
        step: 0,
        line: 7,
        executedLine: 7,
        event: 'line',
        value: '{}',
        changedWith: [],
      },
      {
        step: 1,
        line: 4,
        executedLine: 7,
        event: 'line',
        value: '{11: 0}',
        changedWith: [],
      },
    ]);
  });
});

describe('whole-structure resolution', () => {
  // root: 1(val 6) -> left 2(val 15) -> left 4(val 10); right 3(val 4)
  const leaf = tree(4, 10);
  const leftSub = tree(2, 15, leaf);
  const root = tree(1, 6, leftSub, tree(3, 4));

  it('resolves a subtree to the largest containing tree and highlights it', () => {
    const result = largestContainingTree(leftSub, [root, leftSub, leaf]);
    expect(result.value.id).toBe(root.id);
    expect(result.highlightId).toBe(leftSub.id);
  });

  it('keeps a tree that nothing else contains', () => {
    const lone = tree(99, 1);
    const result = largestContainingTree(lone, [root, lone]);
    expect(result.value.id).toBe(lone.id);
    expect(result.highlightId).toBe(lone.id);
  });

  it('resolves a chain tail to the full chain and highlights the head', () => {
    const full = chain(10, [101, 102, 103], [1, 2, 3]);
    const tail = chain(11, [102, 103], [2, 3]);
    const result = largestContainingChain(tail, [full, tail]);
    expect(result.value.id).toBe(full.id);
    expect(result.highlightId).toBe(102);
  });

  it('collects distinct trees and chains across all frames and globals', () => {
    const step: TraceStep = {
      i: 0,
      event: 'line',
      line: 1,
      func: 'visit',
      stack: [
        { id: 'frame-0', func: 'inorder', line: 1, locals: { root } },
        { id: 'frame-1', func: 'visit', line: 2, locals: { node: leftSub } },
      ],
      globals: { head: chain(10, [101], [1]) },
      stdoutLen: 0,
    };
    const { trees, chains } = collectStructures(step);
    expect(trees.map((t) => t.id).sort()).toEqual([1, 2]);
    expect(chains.map((c) => c.id)).toEqual([10]);
  });

  it('collects trees and chains stored on self attributes', () => {
    const fullChain = chain(20, [201, 202], [1, 2]);
    const step: TraceStep = {
      i: 0,
      event: 'line',
      line: 1,
      func: 'visit',
      stack: [
        {
          id: 'frame-0',
          func: 'visit',
          line: 1,
          locals: {
            self: {
              k: 'obj',
              id: 50,
              t: 'Solution',
              attrs: { root, head: fullChain },
              preview: '<Solution object>',
            },
          },
        },
      ],
      globals: {},
      stdoutLen: 0,
    };

    const { trees, chains } = collectStructures(step);
    expect(trees.map((t) => t.id)).toContain(root.id);
    expect(chains.map((c) => c.id)).toContain(fullChain.id);
  });
});

describe('findSharedReferences', () => {
  const ref = (id: number): EncodedValue => ({ k: 'ref', id });

  it('reports an object reached by a name and a nested path', () => {
    const sharedList = list(5, [1, 2, 3]);
    const matrix: EncodedValue = {
      k: 'seq',
      t: 'list',
      id: 9,
      items: [sharedList, ref(5)],
      len: 2,
      truncated: false,
    };
    const refs = findSharedReferences({ shared: sharedList, matrix, row: ref(5) });
    expect(refs).toHaveLength(1);
    expect(refs[0].id).toBe(5);
    expect([...refs[0].paths].sort()).toEqual(['matrix[0]', 'matrix[1]', 'row', 'shared']);
  });

  it('ignores bare-name-only aliases (already shown as a card alias badge)', () => {
    const shared = list(7, [1]);
    expect(findSharedReferences({ x: shared, y: ref(7) })).toEqual([]);
  });

  it('ignores objects that appear only once', () => {
    expect(findSharedReferences({ a: list(1, [1]), b: list(2, [2]) })).toEqual([]);
  });
});
