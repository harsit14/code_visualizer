import { describe, expect, it } from 'vitest';
import {
  adjacencyGraph,
  dpTransition,
  graphDecorations,
  inferView,
  queueDelta,
  stackDelta,
  viewOptions,
} from './algorithmViews';
import { runJavaScriptTrace } from './jsTraceEngine';
import type { EncodedValue } from './types';

const num = (v: number): EncodedValue => ({ k: 'num', t: 'int', v: String(v) });
const str = (v: string): EncodedValue => ({ k: 'str', v, truncated: false });
const seq = (items: EncodedValue[], t = 'list', id = 1): EncodedValue => ({
  k: 'seq',
  t,
  id,
  items,
  len: items.length,
  truncated: false,
});
const dict = (entries: [EncodedValue, EncodedValue][], id = 9): EncodedValue => ({
  k: 'dict',
  id,
  entries,
  len: entries.length,
  truncated: false,
});

const graph = dict([
  [str('A'), seq([str('B'), str('C')], 'list', 2)],
  [str('B'), seq([str('D')], 'list', 3)],
  [str('C'), seq([str('D')], 'list', 4)],
]);

describe('adjacency graphs', () => {
  it('recognizes adjacency lists, leaf nodes and direction', () => {
    const model = adjacencyGraph(graph)!;
    expect(model.nodes.map((node) => node.key)).toEqual(["'A'", "'B'", "'C'", "'D'"]);
    expect(model.edges).toHaveLength(4);
    expect(model.directed).toBe(true);
    const undirected = adjacencyGraph(
      dict([
        [num(1), seq([num(2)])],
        [num(2), seq([num(1)])],
      ]),
    )!;
    expect(undirected.directed).toBe(false);
  });

  it('reads weighted neighbours from pairs or maps', () => {
    const weighted = adjacencyGraph(
      dict([
        [str('a'), seq([seq([str('b'), num(4)], 'tuple', 5)])],
        [str('b'), dict([[str('a'), num(4)]], 6)],
      ]),
    )!;
    expect(weighted.edges.map((edge) => edge.weight)).toEqual(['4', '4']);
  });

  it('ignores dicts of lists that are not graphs', () => {
    expect(
      adjacencyGraph(
        dict([
          [str('fruits'), seq([str('apple')])],
          [str('veg'), seq([str('kale')])],
        ]),
      ),
    ).toBeNull();
    expect(adjacencyGraph(dict([[str('A'), seq([str('A')])]]))).toBeNull();
  });

  it('colors visited sets, distance maps, the queue and the current node', () => {
    const model = adjacencyGraph(graph)!;
    const decorations = graphDecorations('graph', model, {
      graph,
      seen: seq([str('A'), str('B')], 'set', 7),
      dist: dict([[str('A'), num(0)]], 8),
      queue: seq([str('C')], 'deque', 10),
      node: str('B'),
      label: str('B'),
    });
    expect([...decorations.visited].sort()).toEqual(["'A'", "'B'"]);
    expect(decorations.labels.get("'A'")).toEqual(['dist=0']);
    expect(decorations.frontier).toEqual(["'C'"]);
    expect(decorations.current.get("'B'")).toEqual(['node']);
  });
});

describe('view inference', () => {
  it.each([
    ['queue', seq([num(1)], 'deque'), 'queue'],
    ['q', seq([num(1)]), 'queue'],
    ['stack', seq([num(1)]), 'stack'],
    ['min_heap', seq([num(1)]), 'heap'],
    ['dp', seq([num(1)]), 'dp'],
    ['nums', seq([num(1)]), 'list'],
    ['grid', seq([seq([num(1)], 'list', 2)]), 'list'],
    ['dp', seq([seq([num(1)], 'list', 2)]), 'dp'],
    ['graph', graph, 'graph'],
    ['counts', dict([[str('a'), num(1)]]), 'table'],
  ])('%s → %s', (name, value, expected) => {
    expect(inferView(name, value)).toBe(expected);
  });

  it('offers manual views that fit the value', () => {
    expect(viewOptions(seq([num(1)]))).toEqual(['list', 'queue', 'stack', 'heap', 'dp']);
    expect(viewOptions(graph)).toEqual(['graph', 'table']);
    expect(viewOptions(seq([num(1)], 'set'))).toEqual([]);
    expect(viewOptions(num(1))).toEqual([]);
  });
});

describe('queue and stack deltas', () => {
  it('finds dequeued and enqueued items', () => {
    const before = seq([str('A'), str('B')], 'deque', 3);
    const after = seq([str('B'), str('C'), str('D')], 'deque', 3);
    expect(queueDelta(before, after as never)).toEqual({ removed: [str('A')], added: 2 });
  });

  it('finds popped and pushed items', () => {
    const before = seq([num(1), num(2), num(3)], 'list', 4);
    const after = seq([num(1), num(9)], 'list', 4);
    expect(stackDelta(before, after as never)).toEqual({ removed: [num(2), num(3)], added: 1 });
    expect(stackDelta(seq([], 'list', 5), after as never)).toEqual({ removed: [], added: 0 });
  });
});

describe('dpTransition', () => {
  it('shows which cells a recurrence read and wrote', () => {
    const steps = runJavaScriptTrace(
      'const ways = [1, 1, 0, 0];\nfor (let i = 2; i < 4; i++) {\n  ways[i] = ways[i - 1] + ways[i - 2];\n}',
      'javascript',
    ).run!.steps;
    const index = steps.findIndex((step) => step.event === 'line' && step.line === 3);
    const before = steps[index].stack[0].locals;
    const after = steps[index + 1].stack[0].locals;
    expect(dpTransition('ways', 'ways[i] = ways[i - 1] + ways[i - 2];', before, after)).toEqual({
      target: [2],
      reads: [[1], [0]],
      formula: 'ways[2] = ways[i - 1] + ways[i - 2] → 1 + 1 = 2',
    });
  });

  it('handles 2D tables, compound assignment and unknown indices', () => {
    const table = seq([seq([num(1), num(2)], 'list', 2), seq([num(3), num(0)], 'list', 3)]);
    const filled = seq([seq([num(1), num(2)], 'list', 2), seq([num(3), num(5)], 'list', 3)]);
    const result = dpTransition(
      'dp',
      'dp[r][c] = min(dp[r - 1][c], dp[r][c - 1]) + 2',
      { dp: table, r: num(1), c: num(1) },
      { dp: filled, r: num(1), c: num(1) },
    )!;
    expect(result.target).toEqual([1, 1]);
    expect(result.reads).toEqual([
      [0, 1],
      [1, 0],
    ]);
    expect(result.formula).toBe(
      'dp[1][1] = min(dp[r - 1][c], dp[r][c - 1]) + 2 → min(2, 3) + 2 = 5',
    );
    expect(
      dpTransition(
        'dp',
        'dp[i] += dp[j]',
        { dp: seq([num(1), num(2)]), i: num(1), j: num(0) },
        {
          dp: seq([num(1), num(3)]),
        },
      )?.formula,
    ).toBe('dp[1] += dp[j] → 1 = 3');
    expect(
      dpTransition('dp', 'dp[0] = 1', { dp: seq([num(0)]) }, { dp: seq([num(1)]) })?.formula,
    ).toBe('dp[0] = 1');
    expect(
      dpTransition('dp', 'dp[k] = 1', { dp: seq([num(0)]) }, { dp: seq([num(1)]) }),
    ).toBeNull();
    expect(
      dpTransition('dp', 'total = 1', { dp: seq([num(0)]) }, { dp: seq([num(0)]) }),
    ).toBeNull();
  });
});
