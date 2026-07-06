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
  type ArrayPointer,
  type ArrayPointerHints,
} from '../engine/trace';
import { effectiveFrame } from '../engine/traceNavigation';
import { HeapGraphView } from './data-panel/DataPanelHeap';
import { buildHeapGraph } from './data-panel/DataPanelHeapGraph';
import {
  EMPTY_TRACE_OVERLAY,
  buildTraceOverlay,
  pathForAttr,
  pathForDictKey,
  pathForIndex,
  traceClasses,
  traceTitle,
  type TraceOverlay,
} from './data-panel/DataPanelTrace';
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
