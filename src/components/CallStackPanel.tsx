/**
 * Call stack panel: user frames at the current step, top of stack first.
 * Click a frame to point the Variables and Data panels at it.
 */
import { CornerDownLeft, Layers } from 'lucide-react';
import { formatValue } from '../engine/trace';
import type { TraceStep } from '../engine/types';

type CallStackPanelProps = {
  currentStep: TraceStep | undefined;
  selectedFrameIndex: number | null;
  onSelectFrame: (index: number | null) => void;
};

export function CallStackPanel({
  currentStep,
  selectedFrameIndex,
  onSelectFrame,
}: CallStackPanelProps) {
  const stack = currentStep?.stack ?? [];
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
        <ol className="stack-list">
          {[...stack].reverse().map((frame, reversedIndex) => {
            const index = stack.length - 1 - reversedIndex;
            const isTop = index === stack.length - 1;
            const isSelected = index === effectiveIndex;
            const isReturning = isTop && currentStep?.event === 'return';
            return (
              <li key={`${frame.id}-${index}`}>
                <button
                  className={['stack-frame', isSelected ? 'is-selected' : '', isTop ? 'is-top' : '']
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => onSelectFrame(index === stack.length - 1 ? null : index)}
                  type="button"
                >
                  <span className="frame-name">
                    {frame.func === '<module>' ? 'module' : `${frame.func}()`}
                  </span>
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
      )}
    </section>
  );
}
