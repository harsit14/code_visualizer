/**
 * Data panel: structure-aware rendering of the selected frame's values.
 *
 * - lists/tuples → indexed boxes with pointer markers (i, j, left, right …)
 * - nested lists → grid cells
 * - dicts → key/value tables
 * - TreeNode → SVG node diagram
 * - ListNode → chained node boxes with pointer labels and cycle arrows
 * - aliases (two names, same object id) are rendered once, labels joined
 */
import { Boxes } from 'lucide-react';
import { useState, type JSX } from 'react';
import {
  collectStructures,
  expandSelf,
  findArrayPointers,
  findSharedReferences,
  formatValue,
  groupChains,
  largestContainingChain,
  largestContainingTree,
  typeNameOf,
  type ArrayPointer,
  type ArrayPointerHints,
} from '../engine/trace';
import { effectiveFrame } from '../engine/traceNavigation';
import type {
  AnalysisInfo,
  EncodedValue,
  FrameSnapshot,
  FunctionInfo,
  TraceStep,
} from '../engine/types';

type TreeValue = Extract<EncodedValue, { k: 'tree' }>;
type ChainValue = Extract<EncodedValue, { k: 'listnode' }>;
type SeqValue = Extract<EncodedValue, { k: 'seq' }>;
type StringValue = Extract<EncodedValue, { k: 'str' }>;
type DictValue = Extract<EncodedValue, { k: 'dict' }>;
type HeapEdge = {
  label: string;
  targetId: number;
  targetPath: string;
  displayLabel?: string;
};
type HeapNode = {
  id: number;
  label: string;
  kind: string;
  preview: string;
  paths: string[];
  roots: string[];
  edges: HeapEdge[];
  shape?: 'matrix';
};
type HeapGraph = {
  nodes: HeapNode[];
  rootEdges: { name: string; targetId: number }[];
  truncated: boolean;
};
type TraceOverlay = {
  changedPaths: Set<string>;
  newPaths: Set<string>;
  pointerLabels: Map<string, string[]>;
  changedObjectIds: Set<number>;
};

const HEAP_NODE_LIMIT = 24;

const EMPTY_TRACE_OVERLAY: TraceOverlay = {
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

function pathForIndex(basePath: string, index: number): string {
  return `${basePath}[${index}]`;
}

function pathForAttr(basePath: string, attr: string): string {
  return `${basePath}.${attr}`;
}

function pathForDictKey(basePath: string, key: EncodedValue): string {
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

function buildTraceOverlay(
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

function traceClasses(path: string, overlay: TraceOverlay): string {
  return [
    overlay.changedPaths.has(path) ? 'is-changed' : '',
    overlay.newPaths.has(path) ? 'is-new' : '',
    overlay.pointerLabels.has(path) ? 'has-trace-pointer' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function traceTitle(path: string, overlay: TraceOverlay): string {
  const labels = overlay.pointerLabels.get(path);
  if (!labels || labels.length === 0) {
    return path;
  }
  return `${path} (${labels.join(', ')})`;
}

function TraceBadges({ labels }: { labels: string[] | undefined }) {
  if (!labels || labels.length === 0) {
    return null;
  }
  return <span className="trace-badge">{labels.join(', ')}</span>;
}

// ---------------------------------------------------------------- arrays

function ArrayBoxes({
  value,
  pointers,
  basePath,
  overlay = EMPTY_TRACE_OVERLAY,
}: {
  value: SeqValue;
  pointers: ArrayPointer[];
  basePath: string;
  overlay?: TraceOverlay;
}) {
  const visibleEnd = value.items.length;
  const labels = new Map<number, string[]>();
  for (const pointer of pointers) {
    // Pointers landing on a hidden (truncated) cell are surfaced on the
    // overflow cell below rather than dropped silently.
    if (pointer.index < visibleEnd) {
      labels.set(pointer.index, [...(labels.get(pointer.index) ?? []), pointer.name]);
    }
  }
  // Pointers at or past the last shown cell (e.g. `hi` resting on len(nums),
  // or any pointer inside the truncated tail).
  const endPointers = pointers.filter((pointer) => pointer.index >= visibleEnd);
  const endLabel = endPointers.map((pointer) => pointer.name).join(', ');
  const cells = value.items.map((item, index) => ({
    index,
    text: formatValue(item),
  }));

  return (
    <div className="array-render">
      <div className="array-row">
        {cells.map((cell) => (
          <div className="array-cell-wrap" key={cell.index}>
            <span className="array-index">{cell.index}</span>
            {(() => {
              const path = pathForIndex(basePath, cell.index);
              const pointerLabels = [
                ...(labels.get(cell.index) ?? []),
                ...(overlay.pointerLabels.get(path) ?? []),
              ];
              const classes = [
                'array-cell',
                pointerLabels.length > 0 ? 'has-pointer' : '',
                traceClasses(path, overlay),
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <>
                  <span className={classes} title={traceTitle(path, overlay)}>
                    {cell.text}
                    <TraceBadges labels={overlay.pointerLabels.get(path)} />
                  </span>
                  {pointerLabels.length > 0 ? (
                    <span className="array-pointer">▲ {pointerLabels.join(', ')}</span>
                  ) : null}
                </>
              );
            })()}
          </div>
        ))}
        {value.truncated ? (
          <div className="array-cell-wrap">
            <span className="array-index" />
            <span
              className={`array-cell is-ellipsis${endPointers.length > 0 ? ' has-pointer' : ''}`}
            >
              +{value.len - value.items.length}
            </span>
            {endPointers.length > 0 ? <span className="array-pointer">▲ {endLabel}</span> : null}
          </div>
        ) : endPointers.length > 0 ? (
          <div className="array-cell-wrap">
            <span className="array-index">{visibleEnd}</span>
            <span className="array-cell is-ellipsis">end</span>
            <span className="array-pointer">▲ {endLabel}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StringBoxes({
  value,
  pointers,
  basePath,
  overlay = EMPTY_TRACE_OVERLAY,
}: {
  value: StringValue;
  pointers: ArrayPointer[];
  basePath: string;
  overlay?: TraceOverlay;
}) {
  const chars = [...value.v];
  const visibleEnd = chars.length;
  const labels = new Map<number, string[]>();
  for (const pointer of pointers) {
    if (pointer.index < visibleEnd) {
      labels.set(pointer.index, [...(labels.get(pointer.index) ?? []), pointer.name]);
    }
  }
  const endPointers = pointers.filter((pointer) => pointer.index >= visibleEnd);
  const endLabel = endPointers.map((pointer) => pointer.name).join(', ');

  return (
    <div className="array-render">
      <div className="array-row">
        {chars.map((char, index) => (
          <div className="array-cell-wrap" key={index}>
            <span className="array-index">{index}</span>
            {(() => {
              const path = pathForIndex(basePath, index);
              const pointerLabels = [
                ...(labels.get(index) ?? []),
                ...(overlay.pointerLabels.get(path) ?? []),
              ];
              return (
                <>
                  <span
                    className={[
                      'array-cell',
                      pointerLabels.length > 0 ? 'has-pointer' : '',
                      traceClasses(path, overlay),
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    title={traceTitle(path, overlay)}
                  >
                    {char}
                    <TraceBadges labels={overlay.pointerLabels.get(path)} />
                  </span>
                  {pointerLabels.length > 0 ? (
                    <span className="array-pointer">▲ {pointerLabels.join(', ')}</span>
                  ) : null}
                </>
              );
            })()}
          </div>
        ))}
        {value.truncated ? (
          <div className="array-cell-wrap">
            <span className="array-index" />
            <span
              className={`array-cell is-ellipsis${endPointers.length > 0 ? ' has-pointer' : ''}`}
            >
              …
            </span>
            {endPointers.length > 0 ? <span className="array-pointer">▲ {endLabel}</span> : null}
          </div>
        ) : endPointers.length > 0 ? (
          <div className="array-cell-wrap">
            <span className="array-index">{visibleEnd}</span>
            <span className="array-cell is-ellipsis">end</span>
            <span className="array-pointer">▲ {endLabel}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- grids

function GridBoxes({
  value,
  basePath,
  overlay = EMPTY_TRACE_OVERLAY,
}: {
  value: SeqValue;
  basePath: string;
  overlay?: TraceOverlay;
}) {
  return (
    <table className="grid-render">
      <tbody>
        {value.items.map((row, rowIndex) => {
          const rowPath = pathForIndex(basePath, rowIndex);
          return (
            <tr className={traceClasses(rowPath, overlay)} key={rowIndex}>
              <th title={traceTitle(rowPath, overlay)}>
                {rowIndex}
                <TraceBadges labels={overlay.pointerLabels.get(rowPath)} />
              </th>
              {row.k === 'seq' ? (
                row.items.map((cell, colIndex) => {
                  const cellPath = pathForIndex(rowPath, colIndex);
                  return (
                    <td
                      className={traceClasses(cellPath, overlay)}
                      key={colIndex}
                      title={traceTitle(cellPath, overlay)}
                    >
                      <span className="data-cell-value">{formatValue(cell)}</span>
                      <TraceBadges labels={overlay.pointerLabels.get(cellPath)} />
                    </td>
                  );
                })
              ) : (
                <td className={traceClasses(rowPath, overlay)} title={traceTitle(rowPath, overlay)}>
                  <span className="data-cell-value">{formatValue(row)}</span>
                  <TraceBadges labels={overlay.pointerLabels.get(rowPath)} />
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ----------------------------------------------------------------- dicts

function DictTable({
  value,
  basePath,
  overlay = EMPTY_TRACE_OVERLAY,
}: {
  value: DictValue;
  basePath: string;
  overlay?: TraceOverlay;
}) {
  return (
    <table className="dict-render">
      <thead>
        <tr>
          <th>key</th>
          <th>value</th>
        </tr>
      </thead>
      <tbody>
        {value.entries.map(([key, item], index) => {
          const path = pathForDictKey(basePath, key);
          return (
            <tr className={traceClasses(path, overlay)} key={index}>
              <td>{formatValue(key)}</td>
              <td title={traceTitle(path, overlay)}>
                <span className="data-cell-value">{formatValue(item)}</span>
                <TraceBadges labels={overlay.pointerLabels.get(path)} />
              </td>
            </tr>
          );
        })}
        {value.truncated ? (
          <tr>
            <td colSpan={2}>… {value.len - value.entries.length} more</td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}

// ----------------------------------------------------------------- trees

type LaidOutNode = { id: number; x: number; y: number; label: string };
type LaidOutEdge = { from: LaidOutNode; to: LaidOutNode };

function layoutTree(root: TreeValue): { nodes: LaidOutNode[]; edges: LaidOutEdge[] } {
  const nodes: LaidOutNode[] = [];
  const edges: LaidOutEdge[] = [];
  let cursor = 0;

  function place(node: EncodedValue | null, depth: number): LaidOutNode | null {
    if (!node) {
      return null;
    }
    if (node.k !== 'tree') {
      const leaf: LaidOutNode = {
        id: -1 - nodes.length,
        x: cursor++,
        y: depth,
        label: node.k === 'ref' ? '↺' : '…',
      };
      nodes.push(leaf);
      return leaf;
    }
    const left = place(node.left, depth + 1);
    const self: LaidOutNode = {
      id: node.id,
      x: cursor++,
      y: depth,
      label: formatValue(node.val),
    };
    nodes.push(self);
    const right = place(node.right, depth + 1);
    if (left) {
      edges.push({ from: self, to: left });
    }
    if (right) {
      edges.push({ from: self, to: right });
    }
    return self;
  }

  place(root, 0);
  return { nodes, edges };
}

const TREE_X = 52;
const TREE_Y = 58;
const TREE_R = 17;

function TreeDiagram({
  value,
  highlightId,
  changedIds = EMPTY_TRACE_OVERLAY.changedObjectIds,
}: {
  value: TreeValue;
  highlightId?: number;
  changedIds?: Set<number>;
}) {
  const { nodes, edges } = layoutTree(value);
  const width = (Math.max(...nodes.map((node) => node.x)) + 1) * TREE_X;
  const height = (Math.max(...nodes.map((node) => node.y)) + 1) * TREE_Y;

  const cx = (node: LaidOutNode) => node.x * TREE_X + TREE_X / 2;
  const cy = (node: LaidOutNode) => node.y * TREE_Y + TREE_Y / 2;

  return (
    <svg
      className="tree-render"
      role="img"
      aria-label="Binary tree"
      viewBox={`0 0 ${width} ${height}`}
      style={{ maxWidth: width }}
    >
      {edges.map((edge, index) => (
        <line
          className="tree-edge"
          key={index}
          x1={cx(edge.from)}
          x2={cx(edge.to)}
          y1={cy(edge.from)}
          y2={cy(edge.to)}
        />
      ))}
      {nodes.map((node, index) => {
        const isCurrent = highlightId !== undefined && node.id === highlightId;
        const isChanged = changedIds.has(node.id);
        return (
          <g key={index}>
            <circle
              className={['tree-node', isCurrent ? 'is-current' : '', isChanged ? 'is-changed' : '']
                .filter(Boolean)
                .join(' ')}
              cx={cx(node)}
              cy={cy(node)}
              r={TREE_R}
            />
            <text
              className={[
                'tree-label',
                isCurrent ? 'is-current' : '',
                isChanged ? 'is-changed' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              x={cx(node)}
              y={cy(node) + 4}
            >
              {node.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ----------------------------------------------------------- linked lists

function ChainDiagram({
  value,
  pointerLabels,
  highlightId,
  changedIds = EMPTY_TRACE_OVERLAY.changedObjectIds,
}: {
  value: ChainValue;
  pointerLabels: Map<number, string[]>;
  highlightId?: number;
  changedIds?: Set<number>;
}) {
  return (
    <div className="chain-render">
      {value.nodes.map((node, index) => (
        <div className="chain-node-wrap" key={node.id}>
          {pointerLabels.has(node.id) ? (
            <span className="chain-pointer">{pointerLabels.get(node.id)!.join(', ')} ▼</span>
          ) : (
            <span className="chain-pointer chain-pointer-empty" />
          )}
          <div
            className={[
              'chain-node',
              node.id === highlightId ? 'is-current' : '',
              changedIds.has(node.id) ? 'is-changed' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <span className="chain-val">{formatValue(node.val)}</span>
            <span className="chain-next">next</span>
          </div>
          {index < value.nodes.length - 1 ? <span className="chain-arrow">→</span> : null}
        </div>
      ))}
      <div className="chain-node-wrap">
        <span className="chain-pointer chain-pointer-empty" />
        <div className="chain-terminal">
          {value.cyclic ? '↻ cycle' : value.truncated ? '…' : 'None'}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- heap map

function objectIdOf(value: EncodedValue): number | null {
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

function matrixSummary(value: SeqValue): string | null {
  const hasOnlyRowReferences = value.items.every((item) => item.k === 'seq' || item.k === 'ref');
  const rows = value.items.filter((item): item is SeqValue => item.k === 'seq');
  if (!hasOnlyRowReferences || rows.length === 0) {
    return null;
  }
  const firstRowLength = rows[0]?.len ?? 0;
  const uniform = rows.every((row) => row.len === firstRowLength);
  return uniform ? `${value.len} rows x ${firstRowLength} cols` : `${value.len} rows`;
}

function heapPreview(value: EncodedValue): { kind: string; preview: string; shape?: 'matrix' } {
  if (value.k === 'tree') {
    return { kind: 'TreeNode', preview: `val=${formatValue(value.val)}` };
  }
  if (value.k === 'listnode') {
    const head = value.nodes[0];
    return {
      kind: 'ListNode',
      preview: head ? `val=${formatValue(head.val)}` : formatValue(value),
    };
  }
  if (value.k === 'seq') {
    const summary = matrixSummary(value);
    if (summary) {
      return { kind: value.t, preview: summary, shape: 'matrix' };
    }
    return { kind: value.t, preview: formatValue(value) };
  }
  if (value.k === 'ref') {
    return { kind: 'reference', preview: 'linked object' };
  }
  return { kind: typeNameOf(value), preview: formatValue(value) };
}

function pathRank(path: string): number {
  return (path.match(/\.|\[/g) ?? []).length;
}

function labelForNode(node: HeapNode): string {
  if (node.roots.length > 0) {
    return node.roots.join(' / ');
  }
  const paths = [...node.paths].sort((a, b) => pathRank(a) - pathRank(b) || a.localeCompare(b));
  return paths[0] ?? node.kind;
}

function buildHeapGraph(locals: Record<string, EncodedValue>): HeapGraph | null {
  const nodes = new Map<number, HeapNode>();
  const rootEdges: { name: string; targetId: number }[] = [];
  const expanded = Object.entries(locals).filter(([name]) => name !== 'self');

  const ensureNode = (id: number, value: EncodedValue) => {
    const existing = nodes.get(id);
    const preview = heapPreview(value);
    if (existing) {
      if (existing.kind === 'reference' && value.k !== 'ref') {
        existing.kind = preview.kind;
        existing.preview = preview.preview;
        existing.shape = preview.shape;
      }
      return existing;
    }
    const node: HeapNode = {
      id,
      label: '',
      kind: preview.kind,
      preview: preview.preview,
      paths: [],
      roots: [],
      edges: [],
      shape: preview.shape,
    };
    nodes.set(id, node);
    return node;
  };

  const ensureRawNode = (id: number, kind: string, preview: string) => {
    const existing = nodes.get(id);
    if (existing) {
      if (existing.kind === 'reference') {
        existing.kind = kind;
        existing.preview = preview;
      }
      return existing;
    }
    const node: HeapNode = { id, label: '', kind, preview, paths: [], roots: [], edges: [] };
    nodes.set(id, node);
    return node;
  };

  const addPath = (node: HeapNode, path: string) => {
    if (!node.paths.includes(path)) {
      node.paths.push(path);
    }
  };

  const addEdge = (
    source: HeapNode,
    label: string,
    targetId: number,
    targetPath: string,
    displayLabel?: string,
  ) => {
    if (!source.edges.some((edge) => edge.label === label && edge.targetId === targetId)) {
      source.edges.push({ label, targetId, targetPath, displayLabel });
    }
  };

  const visited = new Set<number>();
  const walk = (value: EncodedValue, depth: number, path: string) => {
    const id = objectIdOf(value);
    if (id === null) {
      return;
    }
    const node = ensureNode(id, value);
    addPath(node, path);
    if (visited.has(id) || depth >= 4) {
      return;
    }
    visited.add(id);

    if (value.k === 'seq') {
      value.items.forEach((item, index) => {
        const targetId = objectIdOf(item);
        if (targetId !== null) {
          const childPath = `${path}[${index}]`;
          addEdge(
            node,
            `[${index}]`,
            targetId,
            childPath,
            node.shape === 'matrix' ? `row ${index}` : undefined,
          );
          walk(item, depth + 1, childPath);
        }
      });
    } else if (value.k === 'dict') {
      value.entries.forEach(([key, item]) => {
        const targetId = objectIdOf(item);
        if (targetId !== null) {
          const childPath = `${path}[${formatValue(key)}]`;
          addEdge(node, `[${formatValue(key)}]`, targetId, childPath);
          walk(item, depth + 1, childPath);
        }
      });
    } else if (value.k === 'obj') {
      Object.entries(value.attrs).forEach(([attr, item]) => {
        const targetId = objectIdOf(item);
        if (targetId !== null) {
          const childPath = `${path}.${attr}`;
          addEdge(node, `.${attr}`, targetId, childPath);
          walk(item, depth + 1, childPath);
        }
      });
    } else if (value.k === 'tree') {
      for (const [label, child] of [
        ['left', value.left],
        ['right', value.right],
      ] as const) {
        if (!child) {
          continue;
        }
        const targetId = objectIdOf(child);
        if (targetId !== null) {
          const childPath = `${path}.${label}`;
          addEdge(node, label, targetId, childPath);
          walk(child, depth + 1, childPath);
        }
      }
    } else if (value.k === 'listnode') {
      value.nodes.forEach((listNode, index) => {
        const raw = ensureRawNode(listNode.id, 'ListNode', `val=${formatValue(listNode.val)}`);
        addPath(raw, `${path}${index === 0 ? '' : `.next${index}`}`);
        if (index < value.nodes.length - 1) {
          addEdge(raw, 'next', value.nodes[index + 1].id, `${path}.next${index + 1}`);
        }
      });
    }
  };

  for (const [name, value] of expanded) {
    const targetId = objectIdOf(value);
    if (targetId === null) {
      continue;
    }
    rootEdges.push({ name, targetId });
    const node = ensureNode(targetId, value);
    if (!node.roots.includes(name)) {
      node.roots.push(name);
    }
    walk(value, 0, name);
  }

  if (nodes.size === 0) {
    return null;
  }

  const visibleNodes = [...nodes.values()].slice(0, HEAP_NODE_LIMIT);
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  return {
    nodes: visibleNodes.map((node) => ({
      ...node,
      label: labelForNode(node),
      edges: node.edges.filter((edge) => visibleIds.has(edge.targetId)),
    })),
    rootEdges: rootEdges.filter((edge) => visibleIds.has(edge.targetId)),
    truncated: nodes.size > HEAP_NODE_LIMIT,
  };
}

function HeapGraphView({
  graph,
  selectedId,
  onSelect,
}: {
  graph: HeapGraph;
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const nodeLabels = new Map(graph.nodes.map((node) => [node.id, node.label]));

  return (
    <div className="heap-map">
      <div className="heap-roots" aria-label="Reference roots">
        {graph.rootEdges.map((edge) => (
          <button
            className={edge.targetId === selectedId ? 'is-selected' : ''}
            key={`${edge.name}-${edge.targetId}`}
            onClick={() => onSelect(edge.targetId)}
            type="button"
          >
            <span>{edge.name}</span>
          </button>
        ))}
      </div>
      <div className="heap-nodes">
        {graph.nodes.map((node) => (
          <div className={`heap-node${node.id === selectedId ? ' is-selected' : ''}`} key={node.id}>
            <button className="heap-node-main" onClick={() => onSelect(node.id)} type="button">
              <span className="heap-node-label">{node.label}</span>
              <span className="heap-node-kind">{node.kind}</span>
              <span className="heap-node-preview">{node.preview}</span>
            </button>
            {node.roots.length > 0 ? (
              <div className="heap-node-roots">
                {node.roots.map((root) => (
                  <span key={root}>{root}</span>
                ))}
              </div>
            ) : null}
            {node.edges.length > 0 ? (
              <ul className="heap-links">
                {node.edges.map((edge) => (
                  <li key={`${edge.label}-${edge.targetId}`}>
                    <button
                      className={edge.targetId === selectedId ? 'is-selected' : ''}
                      onClick={() => onSelect(edge.targetId)}
                      type="button"
                    >
                      <span>{edge.displayLabel ?? edge.label}</span>
                      <span>→ {nodeLabels.get(edge.targetId) ?? edge.targetPath}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
      </div>
      {graph.truncated ? (
        <p className="heap-note">Showing the first {HEAP_NODE_LIMIT} objects.</p>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------- the panel

type DataPanelProps = {
  analysis: AnalysisInfo | null;
  currentStep: TraceStep | undefined;
  previousStep?: TraceStep;
  frameIndex: number | null;
  returnValue: EncodedValue | null;
  atLastStep: boolean;
};

type Card = { names: string[]; value: EncodedValue; render: JSX.Element; wide?: boolean };

function pointerHintsForFrame(
  analysis: AnalysisInfo | null,
  frame: FrameSnapshot | undefined,
): ArrayPointerHints | null | undefined {
  if (!analysis || !frame) {
    return undefined;
  }
  if (frame.func === '<module>') {
    return analysis.modulePointerHints ?? undefined;
  }

  const exact = analysis.functions.find((fn) => fn.qualname === frame.qualname);
  if (exact) {
    return exact.pointerHints;
  }
  const byName = analysis.functions.filter((fn) => fn.name === frame.func);
  return byName.length === 1 ? byName[0].pointerHints : undefined;
}

function findFunctionInfo(
  analysis: AnalysisInfo | null,
  frame: FrameSnapshot | undefined,
): FunctionInfo | undefined {
  if (!analysis || !frame || frame.func === '<module>') {
    return undefined;
  }
  const exact = analysis.functions.find((fn) => fn.qualname === frame.qualname);
  if (exact) {
    return exact;
  }
  const byName = analysis.functions.filter((fn) => fn.name === frame.func);
  return byName.length === 1 ? byName[0] : undefined;
}

function buildCards(
  locals: Record<string, EncodedValue>,
  pointerHints: ArrayPointerHints | null | undefined,
  structures: { trees: TreeValue[]; chains: ChainValue[] },
  overlay: TraceOverlay,
): Card[] {
  const arrayPointers = findArrayPointers(locals, pointerHints);

  const byId = new Map<string, Card>();
  const cards: Card[] = [];

  // Linked lists are grouped so aliases and mid-chain pointers become
  // markers on one card instead of duplicate (or missing) cards. In recursive
  // code the frame holds a tail; resolve to the whole chain and highlight the
  // current head node so context isn't lost.
  for (const group of groupChains(locals)) {
    if (group.names[0] === 'self') {
      continue;
    }
    const whole = largestContainingChain(group.value, structures.chains);
    cards.push({
      names: group.names,
      value: whole.value,
      render: (
        <ChainDiagram
          changedIds={overlay.changedObjectIds}
          highlightId={whole.highlightId}
          pointerLabels={group.labels}
          value={whole.value}
        />
      ),
      wide: true,
    });
  }

  for (const [name, value] of Object.entries(locals)) {
    if (name === 'self') {
      continue; // the Solution instance is plumbing, not data
    }
    let render: JSX.Element | null = null;
    let identity: string | null = null;
    // Structurally wide cards (grids, trees, chains, long sequences) span the
    // full row; compact ones pack side-by-side to fill the column.
    let wide = false;

    if (value.k === 'seq') {
      identity = `seq-${value.id}`;
      const isGrid = value.items.length > 0 && value.items.every((item) => item.k === 'seq');
      wide = isGrid || value.items.length > 8;
      render = isGrid ? (
        <GridBoxes basePath={name} overlay={overlay} value={value} />
      ) : (
        <ArrayBoxes
          basePath={name}
          overlay={overlay}
          pointers={arrayPointers.get(name) ?? []}
          value={value}
        />
      );
    } else if (value.k === 'dict') {
      identity = `dict-${value.id}`;
      render = <DictTable basePath={name} overlay={overlay} value={value} />;
    } else if (value.k === 'tree') {
      // In recursive traversals the frame's local is one subtree; show the
      // whole tree with this node highlighted ("you are here").
      const whole = largestContainingTree(value, structures.trees);
      identity = `tree-${whole.value.id}-${whole.highlightId}`;
      wide = true;
      render = (
        <TreeDiagram
          changedIds={overlay.changedObjectIds}
          highlightId={whole.highlightId}
          value={whole.value}
        />
      );
    } else if (value.k === 'listnode') {
      continue; // handled by groupChains above
    } else if (value.k === 'str' && (arrayPointers.get(name)?.length ?? 0) > 0) {
      identity = `str-${name}`;
      wide = [...value.v].length > 8;
      render = (
        <StringBoxes
          basePath={name}
          overlay={overlay}
          pointers={arrayPointers.get(name) ?? []}
          value={value}
        />
      );
    } else if (value.k === 'obj') {
      identity = `obj-${value.id}`;
      const attrs = Object.entries(value.attrs);
      render =
        attrs.length > 0 ? (
          <table className="dict-render">
            <tbody>
              {attrs.map(([attr, attrValue]) => {
                const path = pathForAttr(name, attr);
                return (
                  <tr className={traceClasses(path, overlay)} key={attr}>
                    <td>.{attr}</td>
                    <td title={traceTitle(path, overlay)}>
                      <span className="data-cell-value">{formatValue(attrValue)}</span>
                      <TraceBadges labels={overlay.pointerLabels.get(path)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="object-preview">{value.preview}</p>
        );
    }

    if (!render || !identity) {
      continue;
    }
    const existing = byId.get(identity);
    if (existing) {
      existing.names.push(name); // alias of an already-rendered object
      continue;
    }
    const card: Card = { names: [name], value, render, wide };
    byId.set(identity, card);
    cards.push(card);
  }
  return cards;
}

export function DataPanel({
  analysis,
  currentStep,
  previousStep,
  frameIndex,
  returnValue,
  atLastStep,
}: DataPanelProps) {
  const [selectedHeapId, setSelectedHeapId] = useState<number | null>(null);
  const frame = effectiveFrame(currentStep, frameIndex);
  const previousFrame = previousStep?.stack.find((candidate) => candidate.id === frame?.id);
  const functionInfo = findFunctionInfo(analysis, frame);
  const pointerHints = pointerHintsForFrame(analysis, frame);
  const frameLocals = frame ? expandSelf(frame.locals) : {};
  const previousFrameLocals = previousFrame ? expandSelf(previousFrame.locals) : undefined;
  const locals = { ...(currentStep?.globals ?? {}), ...frameLocals };
  const previousLocals = previousFrame
    ? { ...(previousStep?.globals ?? {}), ...previousFrameLocals }
    : undefined;
  const structures = collectStructures(currentStep);
  const traceOverlay = frame
    ? buildTraceOverlay(locals, previousLocals, pointerHints)
    : EMPTY_TRACE_OVERLAY;
  const cards = frame ? buildCards(locals, pointerHints, structures, traceOverlay) : [];
  const sharedRefs = frame ? findSharedReferences(locals) : [];
  const heapGraph = frame ? buildHeapGraph(locals) : null;

  return (
    <section className="panel data-panel" aria-label="Data structures">
      <header className="panel-header">
        <h2>
          <Boxes size={14} /> Data
        </h2>
        {frame ? (
          <span className="panel-hint">
            {frame.func === '<module>'
              ? 'module scope'
              : `${functionInfo?.qualname ?? frame.qualname ?? frame.func}()`}
          </span>
        ) : null}
      </header>

      {!frame ? (
        <p className="panel-empty">Structures appear here while code runs.</p>
      ) : cards.length === 0 &&
        sharedRefs.length === 0 &&
        !heapGraph &&
        !(atLastStep && returnValue) ? (
        <p className="panel-empty">
          No lists, dicts, trees, or linked lists in scope at this step.
        </p>
      ) : (
        <div className="panel-scroll data-cards">
          {cards.map((card) => (
            <article
              className={`data-card${card.wide ? ' data-card-wide' : ''}`}
              key={card.names[0]}
            >
              <h3>
                {card.names.join(' = ')}
                {card.names.length > 1 ? <span className="alias-badge">alias</span> : null}
              </h3>
              {card.render}
            </article>
          ))}
          {heapGraph ? (
            <article className="data-card data-card-wide heap-card">
              <h3>reference map</h3>
              <HeapGraphView
                graph={heapGraph}
                onSelect={setSelectedHeapId}
                selectedId={selectedHeapId}
              />
            </article>
          ) : null}
          {atLastStep && returnValue ? (
            <article className="data-card data-card-wide data-card-return">
              <h3>return value</h3>
              {returnValue.k === 'tree' ? (
                <TreeDiagram value={returnValue} />
              ) : returnValue.k === 'listnode' ? (
                <ChainDiagram
                  pointerLabels={new Map([[returnValue.nodes[0]?.id ?? -1, ['return']]])}
                  value={returnValue}
                />
              ) : returnValue.k === 'seq' ? (
                <ArrayBoxes basePath="return" pointers={[]} value={returnValue} />
              ) : returnValue.k === 'dict' ? (
                <DictTable basePath="return" value={returnValue} />
              ) : (
                <p className="return-preview">{formatValue(returnValue)}</p>
              )}
            </article>
          ) : null}
          {sharedRefs.length > 0 ? (
            <article className="data-card data-card-wide data-card-shared">
              <h3>shared references</h3>
              <p className="shared-ref-note">
                Same object reached by multiple paths — mutating one changes all.
              </p>
              <ul className="shared-ref-list">
                {sharedRefs.map((ref) => (
                  <li className="shared-ref" key={ref.id}>
                    <div className="shared-ref-paths">
                      {ref.paths.map((path) => (
                        <code key={path}>{path}</code>
                      ))}
                    </div>
                    <span className="shared-ref-value">
                      <span className="shared-ref-kind">{ref.kind}</span> {ref.preview}
                    </span>
                  </li>
                ))}
              </ul>
            </article>
          ) : null}
        </div>
      )}
    </section>
  );
}
