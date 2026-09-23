/**
 * Algorithm views for the Data panel: queues, stacks, binary heaps and
 * adjacency-list graphs with visited/frontier/current coloring.
 */
import type { GraphDecorations, GraphModel, SequenceDelta } from '../../engine/algorithmViews';
import { formatValue } from '../../engine/trace';
import type { EncodedValue } from '../../engine/types';
import { pathForIndex, traceClasses, traceTitle, type TraceOverlay } from './DataPanelTrace';

type SeqValue = Extract<EncodedValue, { k: 'seq' }>;

const LABEL_LIMIT = 8;

function short(value: EncodedValue): string {
  const text = formatValue(value);
  return text.length > LABEL_LIMIT ? `${text.slice(0, LABEL_LIMIT - 1)}…` : text;
}

export function QueueView({
  value,
  delta,
  basePath,
  overlay,
}: {
  value: SeqValue;
  delta: SequenceDelta;
  basePath: string;
  overlay: TraceOverlay;
}) {
  const firstNew = value.items.length - delta.added;
  return (
    <div className="algo-queue" role="list" aria-label={`${basePath} as a queue, front first`}>
      {delta.removed.map((item, index) => (
        <span className="algo-item is-removed" key={`out-${index}`} role="listitem">
          {short(item)}
          <small>dequeued</small>
        </span>
      ))}
      <span className="algo-end">front</span>
      {value.items.length === 0 ? <span className="algo-empty">empty</span> : null}
      {value.items.map((item, index) => {
        const path = pathForIndex(basePath, index);
        return (
          <span
            className={`algo-item ${traceClasses(path, overlay)}${index >= firstNew ? ' is-added' : ''}`}
            key={index}
            role="listitem"
            title={traceTitle(path, overlay)}
          >
            {short(item)}
          </span>
        );
      })}
      {value.truncated ? (
        <span className="algo-item is-ellipsis">+{value.len - value.items.length}</span>
      ) : null}
      <span className="algo-end">back</span>
    </div>
  );
}

export function StackView({
  value,
  delta,
  basePath,
  overlay,
}: {
  value: SeqValue;
  delta: SequenceDelta;
  basePath: string;
  overlay: TraceOverlay;
}) {
  const firstNew = value.items.length - delta.added;
  const items = value.items.map((item, index) => ({ item, index })).reverse();
  return (
    <div className="algo-stack" role="list" aria-label={`${basePath} as a stack, top first`}>
      {[...delta.removed].reverse().map((item, index) => (
        <span className="algo-item is-removed" key={`out-${index}`} role="listitem">
          {short(item)}
          <small>popped</small>
        </span>
      ))}
      <span className="algo-end">top</span>
      {items.length === 0 ? <span className="algo-empty">empty</span> : null}
      {items.map(({ item, index }) => {
        const path = pathForIndex(basePath, index);
        return (
          <span
            className={`algo-item ${traceClasses(path, overlay)}${index >= firstNew ? ' is-added' : ''}`}
            key={index}
            role="listitem"
            title={traceTitle(path, overlay)}
          >
            {short(item)}
          </span>
        );
      })}
      {value.truncated ? (
        <span className="algo-note">+{value.len - value.items.length} more below</span>
      ) : null}
    </div>
  );
}

const HEAP_LIMIT = 31;
const HEAP_GAP = 46;
const HEAP_ROW = 52;

export function HeapView({
  value,
  basePath,
  overlay,
}: {
  value: SeqValue;
  basePath: string;
  overlay: TraceOverlay;
}) {
  const items = value.items.slice(0, HEAP_LIMIT);
  if (items.length === 0) return <p className="algo-empty">empty heap</p>;
  const levels = Math.floor(Math.log2(items.length)) + 1;
  const width = Math.max(2 ** (levels - 1) * HEAP_GAP, 160);
  const height = levels * HEAP_ROW;
  const position = (index: number) => {
    const level = Math.floor(Math.log2(index + 1));
    const offset = index - (2 ** level - 1);
    const slots = 2 ** level;
    return { x: ((offset + 0.5) * width) / slots, y: level * HEAP_ROW + 22 };
  };
  return (
    <div className="algo-heap">
      <svg
        aria-label={`${basePath} as a binary heap`}
        role="img"
        viewBox={`0 0 ${width} ${height}`}
        width={width}
      >
        {items.map((_, index) => {
          if (index === 0) return null;
          const from = position(Math.floor((index - 1) / 2));
          const to = position(index);
          return (
            <line
              className="algo-edge"
              key={`edge-${index}`}
              x1={from.x}
              x2={to.x}
              y1={from.y}
              y2={to.y}
            />
          );
        })}
        {items.map((item, index) => {
          const { x, y } = position(index);
          const path = pathForIndex(basePath, index);
          return (
            <g className={`algo-node ${traceClasses(path, overlay)}`} key={index}>
              <title>{`${traceTitle(path, overlay)} = ${formatValue(item)}`}</title>
              <circle cx={x} cy={y} r={17} />
              <text x={x} y={y + 4}>
                {short(item)}
              </text>
              <text className="algo-index" x={x} y={y + 30}>
                {index}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="algo-note">
        Index i has children 2i+1 and 2i+2
        {value.len > items.length ? `; showing the first ${items.length} of ${value.len}` : ''}.
      </p>
    </div>
  );
}

const GRAPH_LIMIT = 40;
const COLUMN = 96;
const ROW = 62;

function layered(
  graph: GraphModel,
  start: string | undefined,
): Map<string, { x: number; y: number }> {
  const adjacency = new Map<string, string[]>();
  for (const node of graph.nodes) adjacency.set(node.key, []);
  for (const edge of graph.edges) {
    adjacency.get(edge.from)?.push(edge.to);
    adjacency.get(edge.to)?.push(edge.from);
  }
  const layer = new Map<string, number>();
  const order = [...(start ? [start] : []), ...graph.nodes.map((node) => node.key)];
  for (const root of order) {
    if (layer.has(root)) continue;
    const base = layer.size ? Math.max(...layer.values()) + 1 : 0;
    layer.set(root, base);
    const queue = [root];
    while (queue.length) {
      const node = queue.shift()!;
      for (const next of adjacency.get(node) ?? []) {
        if (!layer.has(next)) {
          layer.set(next, layer.get(node)! + 1);
          queue.push(next);
        }
      }
    }
  }
  const rows = new Map<number, number>();
  const positions = new Map<string, { x: number; y: number }>();
  for (const node of graph.nodes) {
    const column = layer.get(node.key) ?? 0;
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    positions.set(node.key, { x: column * COLUMN + 36, y: row * ROW + 30 });
  }
  return positions;
}

export function GraphView({
  graph,
  decorations,
  basePath,
}: {
  graph: GraphModel;
  decorations: GraphDecorations;
  basePath: string;
}) {
  const shown = new Set(graph.nodes.slice(0, GRAPH_LIMIT).map((node) => node.key));
  const visible = { ...graph, nodes: graph.nodes.filter((node) => shown.has(node.key)) };
  // Layout is rooted at the first node so positions stay put while the search moves.
  const positions = layered(visible, visible.nodes[0]?.key);
  const points = [...positions.values()];
  const width = Math.max(...points.map((point) => point.x)) + 60;
  const height = Math.max(...points.map((point) => point.y)) + 48;
  const frontier = new Set(decorations.frontier);
  const markerId = `arrow-${basePath.replace(/[^\w-]/g, '_')}`;
  const legend = [
    decorations.current.size
      ? `current: ${[...new Set([...decorations.current.values()].flat())].join(', ')}`
      : '',
    decorations.frontierBy ? `frontier: ${decorations.frontierBy}` : '',
    decorations.visitedBy.length ? `visited: ${decorations.visitedBy.join(', ')}` : '',
  ].filter(Boolean);
  return (
    <div className="algo-graph">
      <svg
        aria-label={`${basePath} as ${graph.directed ? 'a directed' : 'an undirected'} graph`}
        role="img"
        viewBox={`0 0 ${width} ${height}`}
        width={width}
      >
        <defs>
          <marker
            id={markerId}
            markerHeight="6"
            markerWidth="6"
            orient="auto"
            refX="9"
            refY="5"
            viewBox="0 0 10 10"
          >
            <path className="algo-arrow" d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
        </defs>
        {visible.edges
          .filter((edge) => shown.has(edge.from) && shown.has(edge.to))
          .filter((edge) => graph.directed || edge.from <= edge.to)
          .map((edge, index) => {
            const from = positions.get(edge.from)!;
            const to = positions.get(edge.to)!;
            const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
            const shrink = 19 / length;
            const x2 = to.x - (to.x - from.x) * shrink;
            const y2 = to.y - (to.y - from.y) * shrink;
            return (
              <g key={`${edge.from}-${edge.to}-${index}`}>
                <line
                  className="algo-edge"
                  markerEnd={graph.directed ? `url(#${markerId})` : undefined}
                  x1={from.x}
                  x2={x2}
                  y1={from.y}
                  y2={y2}
                />
                {edge.weight !== null ? (
                  <text className="algo-weight" x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 4}>
                    {edge.weight}
                  </text>
                ) : null}
              </g>
            );
          })}
        {visible.nodes.map((node) => {
          const { x, y } = positions.get(node.key)!;
          const state = decorations.current.has(node.key)
            ? 'is-current'
            : frontier.has(node.key)
              ? 'is-frontier'
              : decorations.visited.has(node.key)
                ? 'is-visited'
                : '';
          const labels = decorations.labels.get(node.key) ?? [];
          return (
            <g className={`algo-node ${state}`} key={node.key}>
              <title>
                {[node.key, state.replace('is-', ''), ...labels].filter(Boolean).join(' · ')}
              </title>
              <circle cx={x} cy={y} r={17} />
              <text x={x} y={y + 4}>
                {short(node.value)}
              </text>
              {labels.length ? (
                <text className="algo-index" x={x} y={y + 30}>
                  {labels.join(' ')}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {legend.length ? <p className="algo-note">{legend.join(' · ')}</p> : null}
      {graph.truncated || graph.nodes.length > GRAPH_LIMIT ? (
        <p className="algo-note">Large graph: only part of it is shown.</p>
      ) : null}
    </div>
  );
}
