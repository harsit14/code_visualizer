import { formatValue, type ArrayPointerHints } from '../../engine/trace';
import type { EncodedValue } from '../../engine/types';

type SeqValue = Extract<EncodedValue, { k: 'seq' }>;

export type TraceOverlay = {
  changedPaths: Set<string>;
  newPaths: Set<string>;
  pointerLabels: Map<string, string[]>;
  changedObjectIds: Set<number>;
};

export const EMPTY_TRACE_OVERLAY: TraceOverlay = {
  changedPaths: new Set(),
  newPaths: new Set(),
  pointerLabels: new Map(),
  changedObjectIds: new Set(),
};

const MATRIX_INDEX_PAIRS: [string, string][] = [
  ['row', 'col'],
  ['row', 'column'],
  ['r', 'c'],
  ['i', 'j'],
  ['x', 'y'],
];

export function pathForIndex(basePath: string, index: number): string {
  return `${basePath}[${index}]`;
}

export function pathForAttr(basePath: string, attr: string): string {
  return `${basePath}.${attr}`;
}

export function pathForDictKey(basePath: string, key: EncodedValue): string {
  return `${basePath}[${formatValue(key)}]`;
}

function addTraceLabel(labels: Map<string, string[]>, path: string, label: string) {
  const existing = labels.get(path) ?? [];
  if (!existing.includes(label)) {
    labels.set(path, [...existing, label]);
  }
}

function objectIdForTrace(value: EncodedValue | null | undefined): number | null {
  if (!value) {
    return null;
  }
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

function markChanged(overlay: TraceOverlay, path: string, value: EncodedValue) {
  overlay.changedPaths.add(path);
  const id = objectIdForTrace(value);
  if (id !== null) {
    overlay.changedObjectIds.add(id);
  }
}

function markNew(overlay: TraceOverlay, path: string, value: EncodedValue) {
  overlay.newPaths.add(path);
  const id = objectIdForTrace(value);
  if (id !== null) {
    overlay.changedObjectIds.add(id);
  }
}

function compareTraceValues(
  current: EncodedValue,
  previous: EncodedValue | undefined,
  path: string,
  overlay: TraceOverlay,
  depth = 0,
) {
  if (!previous) {
    markNew(overlay, path, current);
    return;
  }
  if (current.k !== previous.k) {
    markChanged(overlay, path, current);
    return;
  }
  if (depth > 5) {
    if (formatValue(current) !== formatValue(previous)) {
      markChanged(overlay, path, current);
    }
    return;
  }

  if (current.k === 'seq' && previous.k === 'seq') {
    if (current.len !== previous.len || current.truncated !== previous.truncated) {
      markChanged(overlay, path, current);
    }
    current.items.forEach((item, index) => {
      compareTraceValues(
        item,
        previous.items[index],
        pathForIndex(path, index),
        overlay,
        depth + 1,
      );
    });
    return;
  }

  if (current.k === 'dict' && previous.k === 'dict') {
    if (current.len !== previous.len || current.truncated !== previous.truncated) {
      markChanged(overlay, path, current);
    }
    const previousEntries = new Map(
      previous.entries.map(([key, item]) => [formatValue(key), item]),
    );
    current.entries.forEach(([key, item]) => {
      compareTraceValues(
        item,
        previousEntries.get(formatValue(key)),
        pathForDictKey(path, key),
        overlay,
        depth + 1,
      );
    });
    return;
  }

  if (current.k === 'obj' && previous.k === 'obj') {
    for (const [attr, value] of Object.entries(current.attrs)) {
      compareTraceValues(value, previous.attrs[attr], pathForAttr(path, attr), overlay, depth + 1);
    }
    if (Object.keys(current.attrs).length !== Object.keys(previous.attrs).length) {
      markChanged(overlay, path, current);
    }
    return;
  }

  if (current.k === 'tree' && previous.k === 'tree') {
    if (formatValue(current.val) !== formatValue(previous.val)) {
      markChanged(overlay, `${path}.val`, current);
    }
    compareNullableTraceNode(current.left, previous.left, `${path}.left`, overlay, depth + 1);
    compareNullableTraceNode(current.right, previous.right, `${path}.right`, overlay, depth + 1);
    return;
  }

  if (current.k === 'listnode' && previous.k === 'listnode') {
    if (current.nodes.length !== previous.nodes.length || current.cyclic !== previous.cyclic) {
      markChanged(overlay, path, current);
    }
    current.nodes.forEach((node, index) => {
      const previousNode = previous.nodes[index];
      if (!previousNode || formatValue(node.val) !== formatValue(previousNode.val)) {
        overlay.changedObjectIds.add(node.id);
      }
    });
    return;
  }

  if (formatValue(current) !== formatValue(previous)) {
    markChanged(overlay, path, current);
  }
}

function compareNullableTraceNode(
  current: EncodedValue | null,
  previous: EncodedValue | null | undefined,
  path: string,
  overlay: TraceOverlay,
  depth: number,
) {
  if (!current) {
    return;
  }
  compareTraceValues(current, previous ?? undefined, path, overlay, depth);
}

function intLocals(locals: Record<string, EncodedValue>): Map<string, number> {
  const values = new Map<string, number>();
  for (const [name, value] of Object.entries(locals)) {
    if (value.k !== 'num' || value.t !== 'int') {
      continue;
    }
    const parsed = Number(value.v);
    if (Number.isFinite(parsed)) {
      values.set(name, parsed);
    }
  }
  return values;
}

function isMatrixLike(value: EncodedValue): value is SeqValue {
  return (
    value.k === 'seq' && value.items.length > 0 && value.items.every((item) => item.k === 'seq')
  );
}

function findPairedColumnName(rowName: string, ints: Map<string, number>): string | null {
  const direct = MATRIX_INDEX_PAIRS.find(([row]) => row === rowName)?.[1];
  if (direct && ints.has(direct)) {
    return direct;
  }
  return MATRIX_INDEX_PAIRS.find(([, col]) => ints.has(col))?.[1] ?? null;
}

function addMatrixPointerLabels(
  locals: Record<string, EncodedValue>,
  pointerHints: ArrayPointerHints | null | undefined,
  labels: Map<string, string[]>,
) {
  const ints = intLocals(locals);
  for (const [name, value] of Object.entries(locals)) {
    if (!isMatrixLike(value)) {
      continue;
    }
    const hintedRows = pointerHints?.[name] ?? [];
    const rowNames =
      hintedRows.length > 0
        ? hintedRows
        : MATRIX_INDEX_PAIRS.map(([row]) => row).filter((row) => ints.has(row));
    for (const rowName of rowNames) {
      const rowIndex = ints.get(rowName);
      if (rowIndex === undefined || rowIndex < 0 || rowIndex >= value.items.length) {
        continue;
      }
      const rowPath = pathForIndex(name, rowIndex);
      const row = value.items[rowIndex];
      const colName = findPairedColumnName(rowName, ints);
      const colIndex = colName ? ints.get(colName) : undefined;
      if (
        row.k === 'seq' &&
        colName &&
        colIndex !== undefined &&
        colIndex >= 0 &&
        colIndex < row.items.length
      ) {
        addTraceLabel(labels, pathForIndex(rowPath, colIndex), `${rowName}, ${colName}`);
      } else {
        addTraceLabel(labels, rowPath, rowName);
      }
    }
  }
}

export function buildTraceOverlay(
  locals: Record<string, EncodedValue>,
  previousLocals: Record<string, EncodedValue> | undefined,
  pointerHints: ArrayPointerHints | null | undefined,
): TraceOverlay {
  const overlay: TraceOverlay = {
    changedPaths: new Set(),
    newPaths: new Set(),
    pointerLabels: new Map(),
    changedObjectIds: new Set(),
  };
  for (const [name, value] of Object.entries(locals)) {
    if (name === 'self') {
      continue;
    }
    compareTraceValues(value, previousLocals?.[name], name, overlay);
  }
  addMatrixPointerLabels(locals, pointerHints, overlay.pointerLabels);
  return overlay;
}

export function traceClasses(path: string, overlay: TraceOverlay): string {
  return [
    overlay.changedPaths.has(path) ? 'is-changed' : '',
    overlay.newPaths.has(path) ? 'is-new' : '',
    overlay.pointerLabels.has(path) ? 'has-trace-pointer' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function traceTitle(path: string, overlay: TraceOverlay): string {
  const labels = overlay.pointerLabels.get(path);
  if (!labels || labels.length === 0) {
    return path;
  }
  return `${path} (${labels.join(', ')})`;
}

