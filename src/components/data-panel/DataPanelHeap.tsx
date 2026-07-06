import { HEAP_NODE_LIMIT, type HeapGraph } from './DataPanelHeapGraph';

export function HeapGraphView({
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

