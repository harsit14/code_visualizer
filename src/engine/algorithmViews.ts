/**
 * Algorithm-focused interpretations of plain values: queues, stacks, binary
 * heaps, adjacency-list graphs and DP tables. Inference is conservative; the
 * Data panel lets learners pick a different view when a guess is wrong.
 */
import { formatValue } from './trace';
import type { EncodedValue } from './types';

type SeqValue = Extract<EncodedValue, { k: 'seq' }>;

export type AlgorithmView = 'list' | 'queue' | 'stack' | 'heap' | 'dp' | 'table' | 'graph';

export const VIEW_LABELS: Record<AlgorithmView, string> = {
  list: 'List',
  queue: 'Queue',
  stack: 'Stack',
  heap: 'Binary heap',
  dp: 'DP table',
  table: 'Table',
  graph: 'Graph',
};

const QUEUE_NAMES = /^(queue|q|frontier|todo|bfs|bfs_queue|to_visit)$/i;
const STACK_NAMES = /^(stack|stk|st|call_stack|dfs|dfs_stack)$/i;
const HEAP_NAMES = /(^|_)(heap|pq|minheap|maxheap|priority|min_heap|max_heap|open_set)(_|$)/i;
const DP_NAMES = /^(dp|memo|table|ways|cache|best|cost|f|lcs|lis|knap|count|counts)$/i;
const CURRENT_NAMES =
  /^(node|cur|curr|current|u|v|vertex|start|src|source|target|dest|nxt|next_node|neighbor|neighbour|nei|w)$/i;

function isScalar(value: EncodedValue | undefined): boolean {
  return (
    !!value &&
    (value.k === 'num' ||
      value.k === 'str' ||
      value.k === 'none' ||
      (value.k === 'repr' && value.id === undefined))
  );
}

function isSetLike(value: EncodedValue): boolean {
  return value.k === 'seq' && ['set', 'frozenset', 'Set'].includes(value.t);
}

function isGrid(value: SeqValue): boolean {
  return value.items.length > 0 && value.items.every((item) => item.k === 'seq');
}

// ---------------------------------------------------------------- graphs

export type GraphNode = { key: string; value: EncodedValue };
export type GraphEdge = { from: string; to: string; weight: string | null };
export type GraphModel = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  directed: boolean;
  truncated: boolean;
};

function neighbours(value: EncodedValue): { node: EncodedValue; weight: string | null }[] | null {
  if (value.k === 'seq') {
    const result: { node: EncodedValue; weight: string | null }[] = [];
    for (const item of value.items) {
      if (isScalar(item)) {
        result.push({ node: item, weight: null });
      } else if (item.k === 'seq' && item.items.length === 2 && isScalar(item.items[0])) {
        result.push({ node: item.items[0], weight: formatValue(item.items[1]) });
      } else {
        return null;
      }
    }
    return result;
  }
  if (value.k === 'dict') {
    if (!value.entries.every(([key]) => isScalar(key))) return null;
    return value.entries.map(([key, weight]) => ({ node: key, weight: formatValue(weight) }));
  }
  return null;
}

/** An adjacency list: scalar keys mapping to neighbour lists, sets or weight maps. */
export function adjacencyGraph(value: EncodedValue): GraphModel | null {
  if (value.k !== 'dict' || value.entries.length < 2) return null;
  const nodes = new Map<string, GraphNode>();
  const lists: [string, { node: EncodedValue; weight: string | null }[]][] = [];
  for (const [key, item] of value.entries) {
    if (!isScalar(key)) return null;
    const list = neighbours(item);
    if (!list) return null;
    const label = formatValue(key);
    nodes.set(label, { key: label, value: key });
    lists.push([label, list]);
  }
  let references = 0;
  let resolved = 0;
  const edges: GraphEdge[] = [];
  for (const [from, list] of lists) {
    for (const { node, weight } of list) {
      const to = formatValue(node);
      references += 1;
      if (nodes.has(to)) resolved += 1;
      edges.push({ from, to, weight });
    }
  }
  // Enough neighbours must be keys too (leaf nodes often are not); otherwise this
  // is an ordinary dict of lists, such as grouped anagrams.
  if (resolved === 0 || resolved / references < 0.4) return null;
  for (const edge of edges) {
    if (!nodes.has(edge.to)) {
      const leaf = list0(lists, edge.to);
      nodes.set(edge.to, {
        key: edge.to,
        value: leaf ?? { k: 'str', v: edge.to, truncated: false },
      });
    }
  }
  const keys = new Set(edges.map((edge) => `${edge.from}\u0000${edge.to}`));
  const directed = edges.some((edge) => !keys.has(`${edge.to}\u0000${edge.from}`));
  const truncated =
    value.truncated || value.entries.some(([, item]) => item.k === 'seq' && item.truncated);
  return { nodes: [...nodes.values()], edges, directed, truncated };
}

function list0(
  lists: [string, { node: EncodedValue; weight: string | null }[]][],
  label: string,
): EncodedValue | undefined {
  for (const [, list] of lists) {
    const found = list.find((item) => formatValue(item.node) === label);
    if (found) return found.node;
  }
  return undefined;
}

export type GraphDecorations = {
  visited: Set<string>;
  visitedBy: string[];
  frontier: string[];
  frontierBy: string | null;
  current: Map<string, string[]>;
  labels: Map<string, string[]>;
};

/** Colors graph nodes using other variables: visited sets, queues and the current node. */
export function graphDecorations(
  graphName: string,
  graph: GraphModel,
  locals: Record<string, EncodedValue>,
): GraphDecorations {
  const keys = new Set(graph.nodes.map((node) => node.key));
  const all = (items: EncodedValue[]) =>
    items.length > 0 && items.every((item) => isScalar(item) && keys.has(formatValue(item)));
  const decorations: GraphDecorations = {
    visited: new Set(),
    visitedBy: [],
    frontier: [],
    frontierBy: null,
    current: new Map(),
    labels: new Map(),
  };
  for (const [name, value] of Object.entries(locals)) {
    if (name === graphName) continue;
    if (value.k === 'seq' && isSetLike(value) && all(value.items)) {
      value.items.forEach((item) => decorations.visited.add(formatValue(item)));
      decorations.visitedBy.push(name);
    } else if (
      value.k === 'dict' &&
      all(value.entries.map(([key]) => key)) &&
      !adjacencyGraph(value)
    ) {
      decorations.visitedBy.push(name);
      for (const [key, item] of value.entries) {
        const node = formatValue(key);
        decorations.visited.add(node);
        const labels = decorations.labels.get(node) ?? [];
        labels.push(`${name}=${formatValue(item)}`);
        decorations.labels.set(node, labels);
      }
    } else if (
      value.k === 'seq' &&
      !isSetLike(value) &&
      (value.t === 'deque' || QUEUE_NAMES.test(name) || STACK_NAMES.test(name)) &&
      (value.items.length === 0 || all(value.items)) &&
      decorations.frontierBy === null
    ) {
      decorations.frontier = value.items.map((item) => formatValue(item));
      decorations.frontierBy = name;
    } else if (isScalar(value) && CURRENT_NAMES.test(name) && keys.has(formatValue(value))) {
      const node = formatValue(value);
      decorations.current.set(node, [...(decorations.current.get(node) ?? []), name]);
    }
  }
  return decorations;
}

// ------------------------------------------------------ view inference

export function viewOptions(value: EncodedValue): AlgorithmView[] {
  if (value.k === 'dict') return adjacencyGraph(value) ? ['graph', 'table'] : ['table'];
  if (value.k !== 'seq' || isSetLike(value)) return [];
  if (isGrid(value)) return ['list', 'dp'];
  return ['list', 'queue', 'stack', 'heap', 'dp'];
}

/** The view shown when the learner has not chosen one. */
export function inferView(name: string, value: EncodedValue): AlgorithmView | null {
  const options = viewOptions(value);
  if (options.length === 0) return null;
  if (value.k === 'dict') return options[0];
  const seq = value as SeqValue;
  if (isGrid(seq)) return DP_NAMES.test(name) ? 'dp' : 'list';
  if (seq.t === 'deque' || QUEUE_NAMES.test(name)) return 'queue';
  if (STACK_NAMES.test(name)) return 'stack';
  if (HEAP_NAMES.test(name)) return 'heap';
  if (DP_NAMES.test(name)) return 'dp';
  return 'list';
}

// ------------------------------------------------ queue / stack deltas

export type SequenceDelta = { removed: EncodedValue[]; added: number };

/** Items dequeued from the front and enqueued at the back since the previous step. */
export function queueDelta(previous: EncodedValue | undefined, current: SeqValue): SequenceDelta {
  if (!previous || previous.k !== 'seq' || previous.id !== current.id) {
    return { removed: [], added: 0 };
  }
  const before = previous.items.map((item) => JSON.stringify(item));
  const after = current.items.map((item) => JSON.stringify(item));
  for (let dropped = 0; dropped <= before.length; dropped += 1) {
    const rest = before.slice(dropped);
    if (rest.every((item, index) => after[index] === item) && after.length >= rest.length) {
      return { removed: previous.items.slice(0, dropped), added: after.length - rest.length };
    }
  }
  return { removed: [], added: 0 };
}

/** Items popped from and pushed onto the top (end) since the previous step. */
export function stackDelta(previous: EncodedValue | undefined, current: SeqValue): SequenceDelta {
  if (!previous || previous.k !== 'seq' || previous.id !== current.id) {
    return { removed: [], added: 0 };
  }
  let shared = 0;
  while (
    shared < previous.items.length &&
    shared < current.items.length &&
    JSON.stringify(previous.items[shared]) === JSON.stringify(current.items[shared])
  ) {
    shared += 1;
  }
  return { removed: previous.items.slice(shared), added: current.items.length - shared };
}

// ------------------------------------------------------ DP transitions

type IndexPath = number[];

class IndexExpression {
  private pos = 0;
  private readonly tokens: string[];

  constructor(
    text: string,
    private readonly ints: Map<string, number>,
  ) {
    this.tokens = text.match(/\d+|[A-Za-z_$][\w$]*|\/\/|[-+*/%()]/g) ?? [];
    const joined = this.tokens.join('');
    if (joined !== text.replace(/\s+/g, '')) throw new Error('unsupported index');
  }

  evaluate(): number {
    const value = this.sum();
    if (this.pos !== this.tokens.length) throw new Error('trailing tokens');
    return value;
  }

  private sum(): number {
    let value = this.product();
    while (this.tokens[this.pos] === '+' || this.tokens[this.pos] === '-') {
      const operator = this.tokens[this.pos++];
      const right = this.product();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  }

  private product(): number {
    let value = this.unary();
    while (['*', '//', '/', '%'].includes(this.tokens[this.pos])) {
      const operator = this.tokens[this.pos++];
      const right = this.unary();
      if (operator === '*') value *= right;
      else if (operator === '%') value = ((value % right) + right) % right;
      else value = Math.floor(value / right);
    }
    return value;
  }

  private unary(): number {
    if (this.tokens[this.pos] === '-') {
      this.pos += 1;
      return -this.unary();
    }
    if (this.tokens[this.pos] === '(') {
      this.pos += 1;
      const value = this.sum();
      if (this.tokens[this.pos++] !== ')') throw new Error('missing )');
      return value;
    }
    const token = this.tokens[this.pos++];
    if (token === undefined) throw new Error('missing operand');
    if (/^\d+$/.test(token)) return Number(token);
    const value = this.ints.get(token);
    if (value === undefined) throw new Error(`unknown ${token}`);
    return value;
  }
}

function intLocals(locals: Record<string, EncodedValue>): Map<string, number> {
  const ints = new Map<string, number>();
  for (const [name, value] of Object.entries(locals)) {
    if (value.k === 'num' && /^-?\d+$/.test(value.v)) ints.set(name, Number(value.v));
  }
  return ints;
}

function readAt(value: EncodedValue | undefined, path: IndexPath): EncodedValue | undefined {
  let current = value;
  for (const index of path) {
    if (!current || current.k !== 'seq') return undefined;
    current = current.items[index < 0 ? current.items.length + index : index];
  }
  return current;
}

export type DpTransition = {
  /** Cell written by the statement, as an index path. */
  target: IndexPath | null;
  /** Cells of the same table the statement read. */
  reads: IndexPath[];
  /** e.g. `ways[5] = ways[4] + ways[3] → 5 + 3 = 8` */
  formula: string | null;
};

function accessPattern(name: string): RegExp {
  const escaped = name.replace(/[$]/g, '\\$');
  return new RegExp(`(?<![\\w$.])${escaped}((?:\\[[^\\[\\]]+\\])+)`, 'g');
}

function parseIndices(brackets: string, ints: Map<string, number>): IndexPath | null {
  const parts = brackets.slice(1, -1).split('][');
  try {
    return parts.map((part) => new IndexExpression(part.trim(), ints).evaluate());
  } catch {
    return null;
  }
}

/**
 * Finds which cells of table `name` the line wrote and read, evaluating index
 * expressions with the values from before the line ran.
 */
export function dpTransition(
  name: string,
  sourceLine: string | null,
  before: Record<string, EncodedValue> | undefined,
  after: Record<string, EncodedValue>,
): DpTransition | null {
  if (!sourceLine || !before) return null;
  const assignment = /^(.*?)(?<![=!<>])(\+=|-=|\*=|=)(?!=)(.*)$/.exec(sourceLine.trim());
  if (!assignment) return null;
  const [, left, operator, right] = assignment;
  const ints = intLocals(before);
  const pattern = accessPattern(name);
  const targetMatch = [...left.trim().matchAll(pattern)].find(
    (match) => match.index === 0 && match[0].length === left.trim().replace(/;$/, '').length,
  );
  const target = targetMatch ? parseIndices(targetMatch[1], ints) : null;
  const reads: IndexPath[] = [];
  const valueSource = right.trim().replace(/;$/, '');
  let formulaRight = valueSource;
  for (const match of valueSource.matchAll(pattern)) {
    const path = parseIndices(match[1], ints);
    if (!path) continue;
    reads.push(path);
    const value = readAt(before[name], path);
    if (value) formulaRight = formulaRight.replace(match[0], formatValue(value));
  }
  if (!target && reads.length === 0) return null;
  let formula: string | null = null;
  if (target) {
    const written = readAt(after[name], target);
    const cell = `${name}${target.map((index) => `[${index}]`).join('')}`;
    const expression = `${cell} ${operator} ${valueSource}`;
    const values = formulaRight !== valueSource ? ` → ${formulaRight}` : '';
    const result = written ? formatValue(written) : null;
    // `dp[0] = 1` needs no "= 1" echo; recurrences show the computed value.
    const echo = result !== null && (values || result !== valueSource) ? ` = ${result}` : '';
    formula = `${expression}${values}${echo}`;
  }
  return { target, reads, formula };
}
