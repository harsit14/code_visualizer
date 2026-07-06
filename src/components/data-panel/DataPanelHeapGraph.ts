import { formatValue, typeNameOf } from '../../engine/trace';
import type { EncodedValue } from '../../engine/types';

type SeqValue = Extract<EncodedValue, { k: 'seq' }>;
export const HEAP_NODE_LIMIT = 24;

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
export type HeapGraph = {
  nodes: HeapNode[];
  rootEdges: { name: string; targetId: number }[];
  truncated: boolean;
};
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

export function buildHeapGraph(locals: Record<string, EncodedValue>): HeapGraph | null {
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

