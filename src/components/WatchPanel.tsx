import { Activity, ChevronDown, ChevronUp, X } from 'lucide-react';
import { expandSelf, formatValue, variableTimeline } from '../engine/trace';
import { effectiveFrame } from '../engine/traceNavigation';
import type {
  AnalysisInfo,
  AssignmentHint,
  EncodedValue,
  FrameSnapshot,
  FunctionInfo,
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

function currentValue(frame: FrameSnapshot | undefined, name: string): EncodedValue | undefined {
  return frame ? expandSelf(frame.locals)[name] : undefined;
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

function functionInfoForFrame(
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

function isParameterBinding(
  functionInfo: FunctionInfo | undefined,
  variableName: string,
  event: TraceStep['event'],
): boolean {
  return (
    event === 'call' && (functionInfo?.params.some((param) => param.name === variableName) ?? false)
  );
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
  const functionInfo = functionInfoForFrame(analysis, frame);

  return (
    <section className="panel watch-panel" aria-label="Watch variables">
      <header className="panel-header">
        <h2>
          <Activity size={14} /> Watch
        </h2>
        <button
          className="panel-header-action"
          disabled={watchedVariables.length === 0}
          onClick={onClear}
          type="button"
        >
          Clear
        </button>
      </header>

      {!frame ? (
        <p className="panel-empty">Run code, then use the plus buttons in Variables to pin values here.</p>
      ) : watchedVariables.length === 0 ? (
        <p className="panel-empty">Use the plus buttons in Variables to pin values here.</p>
      ) : (
        <div className="panel-scroll watch-list">
          {watchedVariables.map((name) => {
            const value = currentValue(frame, name);
            const entries = variableTimeline(steps, frame.id, name);
            const activeEntries = entries.filter((entry) => entry.step <= step);
            const visibleEntries = activeEntries.slice(-MAX_VISIBLE_EVENTS);
            const hiddenCount = Math.max(0, activeEntries.length - visibleEntries.length);
            // Run-until-change: jump straight to the next/previous step where
            // this watched variable changes in the current frame.
            const nextChange = entries.find((entry) => entry.step > step)?.step;
            const prevChange = [...entries].reverse().find((entry) => entry.step < step)?.step;

            return (
              <article className="watch-card" key={`${frame.id}-${name}`}>
                <header className="watch-card-header">
                  <div>
                    <h3>{name}</h3>
                    <p>{value ? formatValue(value) : 'not in scope'}</p>
                  </div>
                  <div className="watch-card-actions">
                    <button
                      className="icon-button"
                      disabled={prevChange === undefined}
                      onClick={() => prevChange !== undefined && onJump(prevChange)}
                      title={`Jump to previous change of ${name}`}
                      type="button"
                    >
                      <ChevronUp size={13} />
                    </button>
                    <button
                      className="icon-button"
                      disabled={nextChange === undefined}
                      onClick={() => nextChange !== undefined && onJump(nextChange)}
                      title={`Jump to next change of ${name}`}
                      type="button"
                    >
                      <ChevronDown size={13} />
                    </button>
                    <button
                      className="icon-button watch-remove"
                      onClick={() => onRemoveVariable(name)}
                      title={`Remove ${name} from watch`}
                      type="button"
                    >
                      <X size={13} />
                    </button>
                  </div>
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
                        const parameterBinding = isParameterBinding(
                          functionInfo,
                          name,
                          entry.event,
                        );
                        const assignmentHint = parameterBinding
                          ? undefined
                          : assignmentHintForEntry(assignmentHints, name, entry.executedLine);
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
                                {parameterBinding
                                  ? 'parameter input · call'
                                  : `line ${displayLine} · ${eventLabel(entry.event)}`}
                              </div>
                              <div className="watch-value">{entry.value}</div>
                              {parameterBinding ? (
                                <div className="watch-explain">
                                  <code>{name} received from the test input</code>
                                </div>
                              ) : assignmentHint ? (
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
