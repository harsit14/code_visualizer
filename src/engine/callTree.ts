/**
 * Call tree for a whole trace, indexed once per result. `callTreeAt` derives the
 * tree as it looked at any step in time proportional to the nodes shown, instead
 * of replaying the trace prefix on every step change.
 */
import type { EncodedValue, TraceStep } from './types';

export type IndexedCall = {
  id: string;
  frameId: string;
  func: string;
  /** Position in the stack; stable for the frame's lifetime. */
  depth: number;
  children: IndexedCall[];
  firstStep: number;
  lastStep: number;
  returnStep: number | null;
  returnValue: EncodedValue | null;
  exceptionStep: number | null;
};

export type CallTreeView = {
  id: string;
  frameId: string;
  func: string;
  line: number;
  children: CallTreeView[];
  /** Earlier sibling calls left out to keep long recursions readable. */
  hiddenEarlier: number;
  returnStep: number | null;
  returnValue: EncodedValue | null;
  exceptionStep: number | null;
};

export function indexCallTree(steps: readonly TraceStep[]): IndexedCall[] {
  const roots: IndexedCall[] = [];
  const nodes = new Map<string, IndexedCall>();
  // Frame ids can be reused after a frame ends (CPython addresses), so a frame id
  // maps to a call only while it stays on the stack.
  const active = new Map<string, IndexedCall>();
  let nextId = 1;

  steps.forEach((step, index) => {
    const onStack = new Set<string>();
    let parent: IndexedCall | null = null;
    step.stack.forEach((frame, depth) => {
      onStack.add(frame.id);
      let node = active.get(frame.id);
      if (!node) {
        node = {
          id: `call-${nextId++}`,
          frameId: frame.id,
          func: frame.func,
          depth,
          children: [],
          firstStep: index,
          lastStep: index,
          returnStep: null,
          returnValue: null,
          exceptionStep: null,
        };
        active.set(frame.id, node);
        nodes.set(node.id, node);
        (parent ? parent.children : roots).push(node);
      }
      node.lastStep = index;
      parent = node;
    });
    const top = parent as IndexedCall | null;
    if (top && step.event === 'return' && top.returnStep === null) {
      top.returnStep = index;
      top.returnValue = step.ret ?? null;
    }
    if (top && (step.event === 'exception' || step.exc) && top.exceptionStep === null) {
      top.exceptionStep = index;
    }
    for (const frameId of active.keys()) {
      if (!onStack.has(frameId)) active.delete(frameId);
    }
  });
  return roots;
}

function visibleCount(nodes: readonly IndexedCall[], step: number): number {
  // Siblings are in call order, so the visible ones form a prefix.
  let low = 0;
  let high = nodes.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (nodes[middle].firstStep <= step) low = middle + 1;
    else high = middle;
  }
  return low;
}

function view(
  nodes: readonly IndexedCall[],
  steps: readonly TraceStep[],
  step: number,
  maxChildren: number,
): { views: CallTreeView[]; hidden: number } {
  const visible = visibleCount(nodes, step);
  const start = Math.max(0, visible - maxChildren);
  const views = nodes.slice(start, visible).map((node) => {
    const seen = Math.min(node.lastStep, step);
    const children = view(node.children, steps, step, maxChildren);
    const returned = node.returnStep !== null && node.returnStep <= step;
    return {
      id: node.id,
      frameId: node.frameId,
      func: node.func,
      line: steps[seen]?.stack[node.depth]?.line ?? 0,
      children: children.views,
      hiddenEarlier: children.hidden,
      returnStep: returned ? node.returnStep : null,
      returnValue: returned ? node.returnValue : null,
      exceptionStep:
        node.exceptionStep !== null && node.exceptionStep <= step ? node.exceptionStep : null,
    };
  });
  return { views, hidden: start };
}

/** The call tree as of `step`, keeping at most `maxChildren` recent calls per parent. */
export function callTreeAt(
  roots: readonly IndexedCall[],
  steps: readonly TraceStep[],
  step: number,
  maxChildren = 24,
): { roots: CallTreeView[]; hiddenEarlier: number } {
  const result = view(roots, steps, step, maxChildren);
  return { roots: result.views, hiddenEarlier: result.hidden };
}
