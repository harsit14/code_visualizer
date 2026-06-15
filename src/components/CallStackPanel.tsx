/**
 * Call stack panel: current user frames plus a persistent call tree built
 * from the trace up to the selected step.
 */
import { CornerDownLeft, Layers } from 'lucide-react';
import { formatValue } from '../engine/trace';
import type { EncodedValue, FrameSnapshot, TraceStep } from '../engine/types';

type CallTreeNode = {
  id: string;
  frameId: string;
  func: string;
  line: number;
  children: CallTreeNode[];
  firstStep: number;
  lastStep: number;
  returnStep: number | null;
  returnValue: EncodedValue | null;
  exceptionStep: number | null;
};

type CallStackPanelProps = {
  currentStep: TraceStep | undefined;
  step: number;
  steps: readonly TraceStep[];
  selectedFrameIndex: number | null;
  onSelectFrame: (index: number | null) => void;
};

function frameLabel(frame: Pick<FrameSnapshot, 'func'>): string {
  return frame.func === '<module>' ? 'module' : `${frame.func}()`;
}

function buildCallTree(
  steps: readonly TraceStep[],
  currentIndex: number,
): { roots: CallTreeNode[]; activeFrameIds: ReadonlySet<string> } {
  const roots: CallTreeNode[] = [];
  const nodes = new Map<string, CallTreeNode>();
  const activeInstances = new Map<string, string>();
  let nextId = 1;

  for (let index = 0; index <= currentIndex && index < steps.length; index += 1) {
    const step = steps[index];
    const stackInstanceIds: string[] = [];
    const stackFrameIds = new Set<string>();

    for (const frame of step.stack) {
      stackFrameIds.add(frame.id);
      let instanceId = activeInstances.get(frame.id);
      const parentId = stackInstanceIds[stackInstanceIds.length - 1] ?? null;

      if (!instanceId) {
        instanceId = `call-${nextId++}`;
        activeInstances.set(frame.id, instanceId);
        const node: CallTreeNode = {
          id: instanceId,
          frameId: frame.id,
          func: frame.func,
          line: frame.line,
          children: [],
          firstStep: index,
          lastStep: index,
          returnStep: null,
          returnValue: null,
          exceptionStep: null,
        };
        nodes.set(instanceId, node);
        const parent = parentId ? nodes.get(parentId) : null;
        if (parent) {
          parent.children.push(node);
        } else {
          roots.push(node);
        }
      }

      const node = nodes.get(instanceId);
      if (node) {
        node.line = frame.line;
        node.lastStep = index;
      }
      stackInstanceIds.push(instanceId);
    }

    const topInstanceId = stackInstanceIds[stackInstanceIds.length - 1];
    const topNode = topInstanceId ? nodes.get(topInstanceId) : null;
    if (topNode && step.event === 'return') {
      topNode.returnStep = index;
      topNode.returnValue = step.ret ?? null;
    }
    if (topNode && (step.event === 'exception' || step.exc)) {
      topNode.exceptionStep = index;
    }

    for (const frameId of activeInstances.keys()) {
      if (!stackFrameIds.has(frameId)) {
        activeInstances.delete(frameId);
      }
    }
  }

  return {
    roots,
    activeFrameIds: new Set(steps[currentIndex]?.stack.map((frame) => frame.id) ?? []),
  };
}

function nodeStatus(
  node: CallTreeNode,
  currentStep: TraceStep | undefined,
  isActive: boolean,
): string {
  const currentTop = currentStep?.stack.at(-1);
  const isCurrentTop = currentTop?.id === node.frameId;

  if (isCurrentTop && currentStep?.event === 'return') {
    return 'returning';
  }
  if (isCurrentTop && (currentStep?.event === 'exception' || currentStep?.exc)) {
    return 'raised';
  }
  if (node.exceptionStep !== null) {
    return 'raised';
  }
  if (node.returnStep !== null) {
    return 'returned';
  }
  if (!isActive) {
    return 'stopped';
  }
  return 'active';
}

function renderTreeNodes({
  nodes,
  activeFrameIds,
  currentStep,
  onSelectFrame,
}: {
  nodes: readonly CallTreeNode[];
  activeFrameIds: ReadonlySet<string>;
  currentStep: TraceStep | undefined;
  onSelectFrame: (index: number | null) => void;
}) {
  const stack = currentStep?.stack ?? [];

  return nodes.map((node) => {
    const activeIndex = stack.findIndex((frame) => frame.id === node.frameId);
    const isActive = activeFrameIds.has(node.frameId);
    const isCurrent = stack.at(-1)?.id === node.frameId;
    const status = nodeStatus(node, currentStep, isActive);
    const canSelect = activeIndex >= 0;

    return (
      <li key={node.id}>
        <button
          className={[
            'call-tree-node',
            isActive ? 'is-active' : '',
            isCurrent ? 'is-current' : '',
            `is-${status}`,
          ]
            .filter(Boolean)
            .join(' ')}
          disabled={!canSelect}
          onClick={() => onSelectFrame(activeIndex === stack.length - 1 ? null : activeIndex)}
          type="button"
        >
          <span className="call-tree-name">{frameLabel(node)}</span>
          <span className="call-tree-line">line {node.line}</span>
          <span className="call-tree-status">{status}</span>
          {node.returnValue ? (
            <span className="call-tree-return">
              <CornerDownLeft size={11} /> {formatValue(node.returnValue)}
            </span>
          ) : null}
        </button>
        {node.children.length > 0 ? (
          <ol>
            {renderTreeNodes({ nodes: node.children, activeFrameIds, currentStep, onSelectFrame })}
          </ol>
        ) : null}
      </li>
    );
  });
}

export function CallStackPanel({
  currentStep,
  step,
  steps,
  selectedFrameIndex,
  onSelectFrame,
}: CallStackPanelProps) {
  const stack = currentStep?.stack ?? [];
  const callTree = buildCallTree(steps, step);
  const effectiveIndex =
    selectedFrameIndex !== null && selectedFrameIndex < stack.length
      ? selectedFrameIndex
      : stack.length - 1;

  return (
    <section className="panel callstack-panel" aria-label="Call stack">
      <header className="panel-header">
        <h2>
          <Layers size={14} /> Call stack
        </h2>
        <span className="panel-hint">
          {stack.length} frame{stack.length === 1 ? '' : 's'}
        </span>
      </header>

      {stack.length === 0 ? (
        <p className="panel-empty">No active frames.</p>
      ) : (
        <div className="panel-scroll callstack-body">
          <ol className="stack-list">
            {[...stack].reverse().map((frame, reversedIndex) => {
              const index = stack.length - 1 - reversedIndex;
              const isTop = index === stack.length - 1;
              const isSelected = index === effectiveIndex;
              const isReturning = isTop && currentStep?.event === 'return';
              return (
                <li key={`${frame.id}-${index}`}>
                  <button
                    className={[
                      'stack-frame',
                      isSelected ? 'is-selected' : '',
                      isTop ? 'is-top' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => onSelectFrame(index === stack.length - 1 ? null : index)}
                    type="button"
                  >
                    <span className="frame-name">{frameLabel(frame)}</span>
                    <span className="frame-line">line {frame.line}</span>
                    {isReturning && currentStep?.ret !== undefined ? (
                      <span className="frame-return">
                        <CornerDownLeft size={12} /> {formatValue(currentStep.ret)}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ol>

          {callTree.roots.length > 0 ? (
            <div className="call-tree-section">
              <h3>Call tree</h3>
              <ol className="call-tree-list">
                {renderTreeNodes({
                  nodes: callTree.roots,
                  activeFrameIds: callTree.activeFrameIds,
                  currentStep,
                  onSelectFrame,
                })}
              </ol>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
