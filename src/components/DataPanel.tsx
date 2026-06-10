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
import type { JSX } from 'react';
import { findArrayPointers, formatValue, groupChains, type ArrayPointer } from '../engine/trace';
import type { EncodedValue, TraceStep } from '../engine/types';

type TreeValue = Extract<EncodedValue, { k: 'tree' }>;
type ChainValue = Extract<EncodedValue, { k: 'listnode' }>;
type SeqValue = Extract<EncodedValue, { k: 'seq' }>;
type DictValue = Extract<EncodedValue, { k: 'dict' }>;

// ---------------------------------------------------------------- arrays

function ArrayBoxes({ value, pointers }: { value: SeqValue; pointers: ArrayPointer[] }) {
  const labels = new Map<number, string[]>();
  for (const pointer of pointers) {
    labels.set(pointer.index, [...(labels.get(pointer.index) ?? []), pointer.name]);
  }
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
            <span
              className={`array-cell${labels.has(cell.index) ? ' has-pointer' : ''}`}
              title={`index ${cell.index}`}
            >
              {cell.text}
            </span>
            {labels.has(cell.index) ? (
              <span className="array-pointer">▲ {labels.get(cell.index)!.join(', ')}</span>
            ) : null}
          </div>
        ))}
        {value.truncated ? (
          <div className="array-cell-wrap">
            <span className="array-index" />
            <span className="array-cell is-ellipsis">+{value.len - value.items.length}</span>
          </div>
        ) : null}
        {pointers.some((pointer) => pointer.index === value.items.length) && !value.truncated ? (
          <div className="array-cell-wrap">
            <span className="array-index">{value.items.length}</span>
            <span className="array-cell is-ellipsis">end</span>
            <span className="array-pointer">
              ▲{' '}
              {pointers
                .filter((pointer) => pointer.index === value.items.length)
                .map((pointer) => pointer.name)
                .join(', ')}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StringBoxes({ text, pointers }: { text: string; pointers: ArrayPointer[] }) {
  const labels = new Map<number, string[]>();
  for (const pointer of pointers) {
    labels.set(pointer.index, [...(labels.get(pointer.index) ?? []), pointer.name]);
  }
  return (
    <div className="array-render">
      <div className="array-row">
        {[...text].map((char, index) => (
          <div className="array-cell-wrap" key={index}>
            <span className="array-index">{index}</span>
            <span className={`array-cell${labels.has(index) ? ' has-pointer' : ''}`}>{char}</span>
            {labels.has(index) ? (
              <span className="array-pointer">▲ {labels.get(index)!.join(', ')}</span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- grids

function GridBoxes({ value }: { value: SeqValue }) {
  return (
    <table className="grid-render">
      <tbody>
        {value.items.map((row, rowIndex) => (
          <tr key={rowIndex}>
            <th>{rowIndex}</th>
            {row.k === 'seq' ? (
              row.items.map((cell, colIndex) => <td key={colIndex}>{formatValue(cell)}</td>)
            ) : (
              <td>{formatValue(row)}</td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ----------------------------------------------------------------- dicts

function DictTable({ value }: { value: DictValue }) {
  return (
    <table className="dict-render">
      <thead>
        <tr>
          <th>key</th>
          <th>value</th>
        </tr>
      </thead>
      <tbody>
        {value.entries.map(([key, item], index) => (
          <tr key={index}>
            <td>{formatValue(key)}</td>
            <td>{formatValue(item)}</td>
          </tr>
        ))}
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

function TreeDiagram({ value }: { value: TreeValue }) {
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
      {nodes.map((node, index) => (
        <g key={index}>
          <circle className="tree-node" cx={cx(node)} cy={cy(node)} r={TREE_R} />
          <text className="tree-label" x={cx(node)} y={cy(node) + 4}>
            {node.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

// ----------------------------------------------------------- linked lists

function ChainDiagram({
  value,
  pointerLabels,
}: {
  value: ChainValue;
  pointerLabels: Map<number, string[]>;
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
          <div className="chain-node">
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
  currentStep: TraceStep | undefined;
  frameIndex: number | null;
  returnValue: EncodedValue | null;
  atLastStep: boolean;
};

type Card = { names: string[]; value: EncodedValue; render: JSX.Element };

function buildCards(locals: Record<string, EncodedValue>): Card[] {
  const arrayPointers = findArrayPointers(locals);

  const byId = new Map<string, Card>();
  const cards: Card[] = [];

  // Linked lists are grouped so aliases and mid-chain pointers become
  // markers on one card instead of duplicate (or missing) cards.
  for (const group of groupChains(locals)) {
    if (group.names[0] === 'self') {
      continue;
    }
    cards.push({
      names: group.names,
      value: group.value,
      render: <ChainDiagram pointerLabels={group.labels} value={group.value} />,
    });
  }

  for (const [name, value] of Object.entries(locals)) {
    if (name === 'self') {
      continue; // the Solution instance is plumbing, not data
    }
    let render: JSX.Element | null = null;
    let identity: string | null = null;

    if (value.k === 'seq') {
      identity = `seq-${value.id}`;
      const isGrid = value.items.length > 0 && value.items.every((item) => item.k === 'seq');
      render = isGrid ? (
        <GridBoxes value={value} />
      ) : (
        <ArrayBoxes pointers={arrayPointers.get(name) ?? []} value={value} />
      );
    } else if (value.k === 'dict') {
      identity = `dict-${value.id}`;
      render = <DictTable value={value} />;
    } else if (value.k === 'tree') {
      identity = `tree-${value.id}`;
      render = <TreeDiagram value={value} />;
    } else if (value.k === 'listnode') {
      continue; // handled by groupChains above
    } else if (value.k === 'str' && (arrayPointers.get(name)?.length ?? 0) > 0) {
      identity = `str-${name}`;
      render = <StringBoxes pointers={arrayPointers.get(name) ?? []} text={value.v} />;
    } else if (value.k === 'obj') {
      identity = `obj-${value.id}`;
      render = (
        <table className="dict-render">
          <tbody>
            {Object.entries(value.attrs).map(([attr, attrValue]) => (
              <tr key={attr}>
                <td>.{attr}</td>
                <td>{formatValue(attrValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
    const card: Card = { names: [name], value, render };
    byId.set(identity, card);
    cards.push(card);
  }
  return cards;
}

export function DataPanel({ currentStep, frameIndex, returnValue, atLastStep }: DataPanelProps) {
  const stack = currentStep?.stack ?? [];
  const index = frameIndex !== null && frameIndex < stack.length ? frameIndex : stack.length - 1;
  const frame = index >= 0 ? stack[index] : undefined;
  const locals = { ...(currentStep?.globals ?? {}), ...(frame?.locals ?? {}) };
  const cards = frame ? buildCards(locals) : [];

  return (
    <section className="panel data-panel" aria-label="Data structures">
      <header className="panel-header">
        <h2>
          <Boxes size={14} /> Data
        </h2>
        {frame ? (
          <span className="panel-hint">
            {frame.func === '<module>' ? 'module scope' : `${frame.func}()`}
          </span>
        ) : null}
      </header>

      {!frame ? (
        <p className="panel-empty">Structures appear here while code runs.</p>
      ) : cards.length === 0 && !(atLastStep && returnValue) ? (
        <p className="panel-empty">
          No lists, dicts, trees, or linked lists in scope at this step.
        </p>
      ) : (
        <div className="panel-scroll data-cards">
          {cards.map((card) => (
            <article className="data-card" key={card.names[0]}>
              <h3>
                {card.names.join(' = ')}
                {card.names.length > 1 ? <span className="alias-badge">alias</span> : null}
              </h3>
              {card.render}
            </article>
          ))}
          {atLastStep && returnValue ? (
            <article className="data-card data-card-return">
              <h3>return value</h3>
              {returnValue.k === 'tree' ? (
                <TreeDiagram value={returnValue} />
              ) : returnValue.k === 'listnode' ? (
                <ChainDiagram
                  pointerLabels={new Map([[returnValue.nodes[0]?.id ?? -1, ['return']]])}
                  value={returnValue}
                />
              ) : returnValue.k === 'seq' ? (
                <ArrayBoxes pointers={[]} value={returnValue} />
              ) : returnValue.k === 'dict' ? (
                <DictTable value={returnValue} />
              ) : (
                <p className="return-preview">{formatValue(returnValue)}</p>
              )}
            </article>
          ) : null}
        </div>
      )}
    </section>
  );
}
