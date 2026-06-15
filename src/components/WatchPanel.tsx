import { Activity, X } from 'lucide-react';
import { formatValue, variableTimeline } from '../engine/trace';
import type {
  AnalysisInfo,
  AssignmentHint,
  EncodedValue,
  FrameSnapshot,
  TraceStep,
} from '../engine/types';

type WatchPanelProps = {
  analysis: AnalysisInfo | null;
  currentStep: TraceStep | undefined;
  frameIndex: number | null;
  onClear: () => void;
  onJump: (step: number) => void;
  onRemoveVariable: (name: string) => void;
  step: number;
  steps: TraceStep[];
  watchedVariables: readonly string[];
};

const MAX_VISIBLE_EVENTS = 8;

function effectiveFrame(
  step: TraceStep | undefined,
  frameIndex: number | null,
): FrameSnapshot | undefined {
  const stack = step?.stack ?? [];
  const index = frameIndex !== null && frameIndex < stack.length ? frameIndex : stack.length - 1;
  return index >= 0 ? stack[index] : undefined;
}

function currentValue(frame: FrameSnapshot | undefined, name: string): EncodedValue | undefined {
  return frame?.locals[name];
}

function eventLabel(event: TraceStep['event']): string {
  return event === 'return' ? 'return' : event;
}

function assignmentHintsForFrame(
  analysis: AnalysisInfo | null,
  frame: FrameSnapshot | undefined,
): AssignmentHint[] {
  if (!analysis || !frame) {
    return [];
  }
  if (frame.func === '<module>') {
    return analysis.moduleAssignmentHints ?? [];
  }

  const exact = analysis.functions.find((fn) => fn.qualname === frame.qualname);
  if (exact) {
    return exact.assignmentHints ?? [];
  }
  const byName = analysis.functions.filter((fn) => fn.name === frame.func);
  return byName.length === 1 ? (byName[0].assignmentHints ?? []) : [];
}

function assignmentHintForEntry(
  hints: AssignmentHint[],
  target: string,
  line: number,
): AssignmentHint | undefined {
  return hints.find((hint) => hint.target === target && hint.line === line);
}

export function WatchPanel({
  analysis,
  currentStep,
  frameIndex,
  onClear,
  onJump,
  onRemoveVariable,
  step,
  steps,
  watchedVariables,
}: WatchPanelProps) {
  const frame = effectiveFrame(currentStep, frameIndex);
  const assignmentHints = assignmentHintsForFrame(analysis, frame);

  return (
    <section className="panel watch-panel" aria-label="Watch variables">
      <header className="panel-header">
        <h2>
          <Activity size={14} /> Watch
        </h2>
        <button className="panel-header-action" onClick={onClear} type="button">
          Clear
        </button>
      </header>

      {!frame ? (
        <p className="panel-empty">Pinned variable history appears here after a run.</p>
      ) : (
        <div className="panel-scroll watch-list">
          {watchedVariables.map((name) => {
            const value = currentValue(frame, name);
            const entries = variableTimeline(steps, frame.id, name);
            const activeEntries = entries.filter((entry) => entry.step <= step);
            const visibleEntries = activeEntries.slice(-MAX_VISIBLE_EVENTS);
            const hiddenCount = Math.max(0, activeEntries.length - visibleEntries.length);

            return (
              <article className="watch-card" key={`${frame.id}-${name}`}>
                <header className="watch-card-header">
                  <div>
                    <h3>{name}</h3>
                    <p>{value ? formatValue(value) : 'not in scope'}</p>
                  </div>
                  <button
                    className="icon-button watch-remove"
                    onClick={() => onRemoveVariable(name)}
                    title={`Remove ${name} from watch`}
                    type="button"
                  >
                    <X size={13} />
                  </button>
                </header>

                {hiddenCount > 0 ? (
                  <p className="watch-note">
                    {hiddenCount} earlier change{hiddenCount === 1 ? '' : 's'}
                  </p>
                ) : null}

                {visibleEntries.length === 0 ? (
                  <p className="watch-note">No changes in this frame yet.</p>
                ) : (
                  <ol className="watch-timeline">
                    {visibleEntries.map((entry) =>
                      (() => {
                        const assignmentHint = assignmentHintForEntry(
                          assignmentHints,
                          name,
                          entry.executedLine,
                        );
                        const displayLine = assignmentHint?.line ?? entry.line;
                        return (
                          <li
                            className={entry.step === currentStep?.i ? 'is-current' : undefined}
                            key={`${name}-${entry.step}`}
                          >
                            <button
                              className="watch-step"
                              onClick={() => onJump(entry.step)}
                              type="button"
                            >
                              {entry.step}
                            </button>
                            <div className="watch-event-body">
                              <div className="watch-event-meta">
                                line {displayLine} · {eventLabel(entry.event)}
                              </div>
                              <div className="watch-value">{entry.value}</div>
                              {assignmentHint ? (
                                <div className="watch-explain">
                                  <code>{assignmentHint.statement}</code>
                                  {assignmentHint.sources.length > 0 ? (
                                    <div className="watch-sources">
                                      {assignmentHint.sources.map((source) => (
                                        <span key={source}>{source}</span>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                              {entry.changedWith.length > 0 ? (
                                <div className="watch-related">
                                  {entry.changedWith.slice(0, 4).map((related) => (
                                    <span key={related}>{related}</span>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          </li>
                        );
                      })(),
                    )}
                  </ol>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
