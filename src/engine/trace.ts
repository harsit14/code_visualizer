/**
 * Pure helpers over the engine's trace schema: compact value formatting,
 * step-to-step variable diffing, pointer-marker detection for arrays and
 * linked lists, and complexity growth-curve labeling.
 */
import type { ComplexitySample, EncodedValue, FrameSnapshot, TraceStep } from './types';

/** Render an encoded value as a compact one-line preview. */
export function formatValue(value: EncodedValue | null | undefined, depth = 0): string {
  if (!value) {
    return '';
  }

  switch (value.k) {
    case 'none':
      return 'None';
    case 'num':
      return value.v;
    case 'str':
      return `'${value.v}'${value.truncated ? '…' : ''}`;
    case 'seq': {
      if (depth > 2) {
        return '[…]';
      }
      const items = value.items.map((item) => formatValue(item, depth + 1));
      if (value.truncated) {
        items.push(`…+${value.len - value.items.length}`);
      }
      const body = items.join(', ');
      if (value.t === 'tuple') {
        return `(${body})`;
      }
      if (value.t === 'set' || value.t === 'frozenset') {
        return value.len === 0 ? 'set()' : `{${body}}`;
      }
      if (value.t === 'deque') {
        return `deque([${body}])`;
      }
      return `[${body}]`;
    }
    case 'dict': {
      if (depth > 2) {
        return '{…}';
      }
      const entries = value.entries.map(
        ([key, item]) => `${formatValue(key, depth + 1)}: ${formatValue(item, depth + 1)}`,
      );
      if (value.truncated) {
        entries.push(`…+${value.len - value.entries.length}`);
      }
      return `{${entries.join(', ')}}`;
    }
    case 'tree':
      return `Tree(${countTreeNodes(value)} nodes)`;
    case 'listnode': {
      const chain = value.nodes.map((node) => formatValue(node.val, depth + 1)).join(' → ');
      return `${chain}${value.cyclic ? ' ↻' : value.truncated ? ' →…' : ''}`;
    }
    case 'func':
      return `${value.name}()`;
    case 'obj':
      return value.preview;
    case 'ref':
      return `↺ ref`;
    case 'repr':
      return value.v;
    default:
      return '';
  }
}

function countTreeNodes(value: EncodedValue): number {
  if (!value || value.k !== 'tree') {
    return 0;
  }
  return (
    1 +
    (value.left ? countTreeNodes(value.left) : 0) +
    (value.right ? countTreeNodes(value.right) : 0)
  );
}

/** Type name shown next to a variable. */
export function typeNameOf(value: EncodedValue): string {
  switch (value.k) {
    case 'none':
      return 'None';
    case 'num':
      return value.t;
    case 'str':
      return 'str';
    case 'seq':
      return value.t;
    case 'dict':
      return value.t ?? 'dict';
    case 'tree':
      return 'TreeNode';
    case 'listnode':
      return 'ListNode';
    case 'func':
      return 'function';
    case 'obj':
      return value.t;
    case 'ref':
      return 'ref';
    case 'repr':
      return value.t;
    default:
      return '';
  }
}

export type LocalsDiff = {
  added: Set<string>;
  changed: Set<string>;
  removed: Set<string>;
};

/** Diff two locals maps structurally (order-insensitive). */
export function diffLocals(
  previous: Record<string, EncodedValue> | undefined,
  current: Record<string, EncodedValue>,
): LocalsDiff {
  const added = new Set<string>();
  const changed = new Set<string>();
  const removed = new Set<string>();
  const prev = previous ?? {};

  for (const [name, value] of Object.entries(current)) {
    if (!(name in prev)) {
      added.add(name);
    } else if (JSON.stringify(prev[name]) !== JSON.stringify(value)) {
      changed.add(name);
    }
  }
  for (const name of Object.keys(prev)) {
    if (!(name in current)) {
      removed.add(name);
    }
  }
  return { added, changed, removed };
}

/**
 * Replace a `self` instance with its public attributes as `self.<attr>`
 * entries, so instance state (memoization caches, accumulators, result
 * lists, …) is inspectable. An attribute-less instance is dropped entirely —
 * an empty `Solution()` is plumbing, not data.
 */
export function expandSelf(locals: Record<string, EncodedValue>): Record<string, EncodedValue> {
  const self = locals.self;
  if (!self || self.k !== 'obj') {
    return locals;
  }
  const expanded: Record<string, EncodedValue> = {};
  for (const [name, value] of Object.entries(locals)) {
    if (name !== 'self') {
      expanded[name] = value;
    }
  }
  for (const [attr, value] of Object.entries(self.attrs)) {
    expanded[`self.${attr}`] = value;
  }
  return expanded;
}

/** Find the frame in `step` matching `frame.id`, or undefined. */
export function findMatchingFrame(
  step: TraceStep | undefined,
  frameId: string,
): FrameSnapshot | undefined {
  return step?.stack.find((frame) => frame.id === frameId);
}

export type ArrayPointer = { name: string; index: number };
export type ArrayPointerHints = Record<string, string[]>;

function isIndexableSequence(value: EncodedValue): value is Extract<EncodedValue, { k: 'seq' }> {
  return value.k === 'seq' && (value.t === 'list' || value.t === 'tuple');
}

function sequenceLength(value: EncodedValue): number | null {
  if (isIndexableSequence(value)) {
    return value.len;
  }
  if (value.k === 'str') {
    // Use the original length so pointers into a truncated tail aren't filtered
    // out; fall back to the preview length for older traces without `len`.
    return value.len ?? [...value.v].length;
  }
  return null;
}

function dedupePointers(pointers: ArrayPointer[]): ArrayPointer[] {
  const seen = new Set<string>();
  const result: ArrayPointer[] = [];
  for (const pointer of pointers) {
    const key = `${pointer.name}:${pointer.index}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(pointer);
  }
  return result;
}

/**
 * Map sequence-valued locals to the integer locals that index into them
 * ("i", "left", "hi", ...) so the UI can draw markers on the array boxes.
 *
 * Uses only AST-analyzed pointer hints to avoid false positives.
 * When ``hints`` is ``undefined`` or ``null`` no pointers are attached.
 */
export function findArrayPointers(
  locals: Record<string, EncodedValue>,
  hints?: ArrayPointerHints | null,
): Map<string, ArrayPointer[]> {
  const result = new Map<string, ArrayPointer[]>();
  const intLocals = new Map<string, number>();

  for (const [name, value] of Object.entries(locals)) {
    if (value.k === 'num' && value.t === 'int') {
      const numeric = Number(value.v);
      if (Number.isFinite(numeric)) {
        intLocals.set(name, numeric);
      }
    }
  }

  if (hints == null) {
    return result;
  }

  for (const [name, value] of Object.entries(locals)) {
    const length = sequenceLength(value);
    if (length !== null && intLocals.size > 0) {
      const pointerNames = hints[name] ?? [];
      const pointers = pointerNames
        .map((pointerName) => ({
          name: pointerName,
          value: intLocals.get(pointerName),
        }))
        .filter(
          (pointer): pointer is { name: string; value: number } =>
            pointer.value !== undefined && pointer.value >= 0 && pointer.value <= length,
        )
        .map((pointer) => ({ name: pointer.name, index: pointer.value }));
      if (pointers.length > 0) {
        result.set(name, dedupePointers(pointers));
      }
    }
  }

  const byId = new Map<number, string[]>();
  for (const [name, value] of Object.entries(locals)) {
    if (isIndexableSequence(value)) {
      byId.set(value.id, [...(byId.get(value.id) ?? []), name]);
    }
  }
  for (const names of byId.values()) {
    const shared = dedupePointers(names.flatMap((name) => result.get(name) ?? []));
    if (shared.length > 0) {
      for (const name of names) {
        result.set(name, shared);
      }
    }
  }

  return result;
}

export type TreeValue = Extract<EncodedValue, { k: 'tree' }>;
export type ChainValue = Extract<EncodedValue, { k: 'listnode' }>;

/** Object ids of every node reachable in a tree encoding (incl. ref/repr boundaries). */
export function treeNodeIds(value: TreeValue): Set<number> {
  const ids = new Set<number>();
  const walk = (node: EncodedValue | null) => {
    if (!node) {
      return;
    }
    if (node.k === 'tree') {
      ids.add(node.id);
      walk(node.left);
      walk(node.right);
    } else if (node.k === 'ref' || (node.k === 'repr' && node.id !== undefined)) {
      ids.add(node.id!);
    }
  };
  walk(value);
  return ids;
}

/** Object ids of every node in a linked-list chain encoding. */
export function chainNodeIds(value: ChainValue): Set<number> {
  return new Set(value.nodes.map((node) => node.id));
}

/**
 * Recursion binds a *sub*-structure in each frame (e.g. `node` is one subtree
 * of the whole `root`). Given the current frame's structure and every
 * structure live in the step, return the largest one that still contains the
 * current root node — so the UI can draw the whole shape with a "you are here"
 * highlight instead of a context-free fragment. Falls back to `current`.
 */
export function largestContainingTree(
  current: TreeValue,
  candidates: TreeValue[],
): { value: TreeValue; highlightId: number } {
  let best = current;
  let bestCount = countTreeNodes(current);
  for (const candidate of candidates) {
    if (candidate.id === current.id) {
      continue;
    }
    const count = countTreeNodes(candidate);
    if (count > bestCount && treeNodeIds(candidate).has(current.id)) {
      best = candidate;
      bestCount = count;
    }
  }
  return { value: best, highlightId: current.id };
}

export function largestContainingChain(
  current: ChainValue,
  candidates: ChainValue[],
): { value: ChainValue; highlightId: number } {
  const headId = current.nodes[0]?.id ?? -1;
  let best = current;
  for (const candidate of candidates) {
    if (candidate.id === current.id || candidate.nodes.length <= best.nodes.length) {
      continue;
    }
    if (headId >= 0 && chainNodeIds(candidate).has(headId)) {
      best = candidate;
    }
  }
  return { value: best, highlightId: headId };
}

export type SharedReference = { id: number; kind: string; preview: string; paths: string[] };

/** Object id of any reference-typed encoded value (containers, refs), else null. */
function refIdOf(value: EncodedValue): number | null {
  switch (value.k) {
    case 'seq':
    case 'dict':
    case 'obj':
    case 'tree':
    case 'listnode':
    case 'ref':
      return value.id;
    case 'repr':
      return value.id ?? null;
    default:
      return null;
  }
}

/**
 * Find objects reachable under more than one path in the current scope —
 * i.e. aliasing. Catches what the per-card alias merge can't: the same list
 * held by a name *and* nested inside another container (`row` and `grid[0]`),
 * or one list shared by two structures. Mutating any path mutates them all.
 */
export function findSharedReferences(locals: Record<string, EncodedValue>): SharedReference[] {
  const collected = new Map<number, { value: EncodedValue; paths: string[]; seen: Set<string> }>();

  const note = (value: EncodedValue, path: string) => {
    const id = refIdOf(value);
    if (id === null) {
      return;
    }
    let entry = collected.get(id);
    if (!entry) {
      entry = { value, paths: [], seen: new Set() };
      collected.set(id, entry);
    }
    if (!entry.seen.has(path)) {
      entry.seen.add(path);
      entry.paths.push(path);
    }
    // Prefer a concrete value over a back-reference for the preview.
    if (entry.value.k === 'ref' && value.k !== 'ref') {
      entry.value = value;
    }
  };

  const walk = (value: EncodedValue, path: string, depth: number) => {
    note(value, path);
    if (depth >= 4) {
      return;
    }
    if (value.k === 'seq') {
      value.items.forEach((item, index) => walk(item, `${path}[${index}]`, depth + 1));
    } else if (value.k === 'dict') {
      value.entries.forEach(([key, val]) => walk(val, `${path}[${formatValue(key)}]`, depth + 1));
    } else if (value.k === 'obj') {
      Object.entries(value.attrs).forEach(([attr, val]) => walk(val, `${path}.${attr}`, depth + 1));
    }
  };

  for (const [name, value] of Object.entries(locals)) {
    if (name === 'self') {
      continue;
    }
    walk(value, name, 0);
  }

  const shared: SharedReference[] = [];
  for (const [id, entry] of collected) {
    // 2+ paths, at least one of them nested (bare-name aliases are already
    // surfaced by the data card's "alias" badge).
    if (entry.paths.length >= 2 && entry.paths.some((p) => p.includes('[') || p.includes('.'))) {
      shared.push({
        id,
        kind: typeNameOf(entry.value),
        preview: formatValue(entry.value),
        paths: entry.paths,
      });
    }
  }
  return shared.sort((a, b) => b.paths.length - a.paths.length);
}

/** Collect every distinct tree/chain value live across a step (all frames + globals). */
export function collectStructures(step: TraceStep | undefined): {
  trees: TreeValue[];
  chains: ChainValue[];
} {
  const trees: TreeValue[] = [];
  const chains: ChainValue[] = [];
  if (!step) {
    return { trees, chains };
  }
  const seen = new Set<number>();
  const scopes = [step.globals, ...step.stack.map((frame) => frame.locals)];
  for (const scope of scopes) {
    for (const value of Object.values(expandSelf(scope))) {
      if (value.k === 'tree' && !seen.has(value.id)) {
        seen.add(value.id);
        trees.push(value);
      } else if (value.k === 'listnode' && !seen.has(value.id)) {
        seen.add(value.id);
        chains.push(value);
      }
    }
  }
  return { trees, chains };
}

export type ChainGroup = {
  /** Variables whose head IS this card's head node (aliases). */
  names: string[];
  value: ChainValue;
  /** nodeId -> variable names pointing at that node (markers). */
  labels: Map<number, string[]>;
};

/**
 * Group linked-list locals into renderable chains.
 *
 * Longest chains claim their nodes first; any other variable whose head
 * node is already claimed (aliases like `curr`/`nxt`, or mid-chain
 * pointers like `slow`/`fast`) becomes a label on the owning chain
 * instead of its own card.
 */
export function groupChains(locals: Record<string, EncodedValue>): ChainGroup[] {
  const chains = Object.entries(locals)
    .filter(
      (entry): entry is [string, ChainValue] =>
        entry[1].k === 'listnode' && entry[1].nodes.length > 0,
    )
    .sort((a, b) => b[1].nodes.length - a[1].nodes.length);

  const owners = new Map<number, ChainGroup>();
  const groups: ChainGroup[] = [];

  for (const [name, value] of chains) {
    const headId = value.nodes[0].id;
    const owner = owners.get(headId);
    if (owner) {
      owner.labels.set(headId, [...(owner.labels.get(headId) ?? []), name]);
      if (headId === owner.value.nodes[0].id) {
        owner.names.push(name);
      }
      continue;
    }
    const group: ChainGroup = {
      names: [name],
      value,
      labels: new Map([[headId, [name]]]),
    };
    groups.push(group);
    for (const node of value.nodes) {
      if (!owners.has(node.id)) {
        owners.set(node.id, group);
      }
    }
  }
  return groups;
}

export type GrowthLabel = 'O(1)' | 'O(log n)' | 'O(n)' | 'O(n log n)' | 'O(n²)' | 'O(n³) or worse';

/**
 * Fit a growth label to (n, ops) samples by comparing against candidate
 * curves with least relative error. Needs >= 3 samples.
 */
export function fitGrowth(samples: ComplexitySample[]): GrowthLabel | null {
  const usable = samples.filter((sample) => sample.n > 1 && sample.ops > 0);
  if (usable.length < 3) {
    return null;
  }

  const candidates: { label: GrowthLabel; fn: (n: number) => number }[] = [
    { label: 'O(1)', fn: () => 1 },
    { label: 'O(log n)', fn: (n) => Math.log2(n) },
    { label: 'O(n)', fn: (n) => n },
    { label: 'O(n log n)', fn: (n) => n * Math.log2(n) },
    { label: 'O(n²)', fn: (n) => n * n },
    { label: 'O(n³) or worse', fn: (n) => n * n * n },
  ];

  let best: GrowthLabel | null = null;
  let bestError = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    // Scale each candidate to match the first sample, then measure error.
    const scale = usable[0].ops / candidate.fn(usable[0].n);
    let error = 0;
    for (const sample of usable) {
      const predicted = scale * candidate.fn(sample.n);
      error += Math.abs(Math.log(sample.ops / predicted));
    }
    if (error < bestError) {
      bestError = error;
      best = candidate.label;
    }
  }
  return best;
}

/** Slice the final stdout down to what was printed by step `step`. */
export function stdoutAtStep(fullStdout: string, step: TraceStep | undefined): string {
  if (!step) {
    return '';
  }
  return fullStdout.slice(0, step.stdoutLen);
}

/** Index of the first exception step, or -1. */
export function firstExceptionStep(steps: TraceStep[]): number {
  return steps.findIndex((step) => step.event === 'exception');
}

export type VariableTimelineEntry = {
  step: number;
  line: number;
  executedLine: number;
  event: TraceStep['event'];
  value: string;
  changedWith: string[];
};

/** Build the change timeline for one variable inside one frame invocation. */
export function variableTimeline(
  steps: TraceStep[],
  frameId: string,
  variableName: string,
): VariableTimelineEntry[] {
  const entries: VariableTimelineEntry[] = [];
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const frame = findMatchingFrame(step, frameId);
    if (!frame) {
      continue;
    }
    // Expand so `self.memo`-style instance state is trackable too.
    const locals = expandSelf(frame.locals);
    if (!(variableName in locals)) {
      continue;
    }

    const previousFrame = findMatchingFrame(steps[index - 1], frameId);
    const diff = diffLocals(previousFrame ? expandSelf(previousFrame.locals) : undefined, locals);
    if (!diff.added.has(variableName) && !diff.changed.has(variableName)) {
      continue;
    }

    const changedWith = [...diff.added, ...diff.changed]
      .filter((name) => name !== variableName)
      .sort();

    entries.push({
      step: step.i,
      line: frame.line,
      executedLine: previousFrame?.line ?? frame.line,
      event: step.event,
      value: formatValue(locals[variableName]),
      changedWith,
    });
  }
  return entries;
}
