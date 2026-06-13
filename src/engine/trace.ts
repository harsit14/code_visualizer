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
      return 'dict';
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
    return [...value.v].length;
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

export type ChainValue = Extract<EncodedValue, { k: 'listnode' }>;

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
