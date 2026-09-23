/**
 * Call stack panel: current user frames plus a persistent call tree built
 * from the trace up to the selected step.
 */
import { CornerDownLeft, Layers } from 'lucide-react';
import { useMemo } from 'react';
import { callTreeAt, indexCallTree, type CallTreeView } from '../engine/callTree';
import { formatValue } from '../engine/trace';
import type { FrameSnapshot, TraceStep } from '../engine/types';

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

function nodeStatus(
  node: CallTreeView,
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

function earlierCalls(count: number) {
  return count > 0 ? (
    <li className="call-tree-more">
      +{count} earlier call{count === 1 ? '' : 's'}
    </li>
  ) : null;
}

function renderTreeNodes({
  nodes,
  activeFrameIds,
  currentStep,
  onSelectFrame,
}: {
  nodes: readonly CallTreeView[];
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
            {earlierCalls(node.hiddenEarlier)}
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
  // Indexed once per trace; each step only derives the visible part.
  const index = useMemo(() => indexCallTree(steps), [steps]);
  const callTree = useMemo(() => callTreeAt(index, steps, step), [index, steps, step]);
  const activeFrameIds = useMemo(
    () => new Set(currentStep?.stack.map((frame) => frame.id) ?? []),
    [currentStep],
  );
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
                {earlierCalls(callTree.hiddenEarlier)}
                {renderTreeNodes({
                  nodes: callTree.roots,
                  activeFrameIds,
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
