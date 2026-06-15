/**
 * Variables panel: locals of the selected frame (plus module globals in
 * function mode), with per-step diff highlighting — what changed, what's
 * new, what disappeared this step.
 */
import { Pin } from 'lucide-react';
import { diffLocals, expandSelf, formatValue, typeNameOf } from '../engine/trace';
import type { EncodedValue, TraceStep } from '../engine/types';

type VariablesPanelProps = {
  currentStep: TraceStep | undefined;
  previousStep: TraceStep | undefined;
  frameIndex: number | null;
  onToggleWatch: (name: string) => void;
  watchedVariables: readonly string[];
};

type RowProps = {
  name: string;
  value: EncodedValue;
  badge: 'new' | 'changed' | null;
  isWatched: boolean;
  onToggleWatch: (name: string) => void;
};

function VariableRow({ name, value, badge, isWatched, onToggleWatch }: RowProps) {
  return (
    <tr
      className={[badge ? `is-${badge}` : '', isWatched ? 'is-watched' : '']
        .filter(Boolean)
        .join(' ')}
    >
      <td className="var-name">
        <button
          aria-pressed={isWatched}
          className={['var-watch-button', isWatched ? 'is-active' : ''].filter(Boolean).join(' ')}
          onClick={() => onToggleWatch(name)}
          title={isWatched ? `Stop watching ${name}` : `Watch ${name}`}
          type="button"
        >
          <Pin size={11} />
          <span>{name}</span>
        </button>
      </td>
      <td className="var-type">{typeNameOf(value)}</td>
      <td className="var-value">
        {formatValue(value)}
        {badge ? <span className={`var-badge var-badge-${badge}`}>{badge}</span> : null}
      </td>
    </tr>
  );
}

export function VariablesPanel({
  currentStep,
  previousStep,
  frameIndex,
  onToggleWatch,
  watchedVariables,
}: VariablesPanelProps) {
  const stack = currentStep?.stack ?? [];
  const index = frameIndex !== null && frameIndex < stack.length ? frameIndex : stack.length - 1;
  const frame = index >= 0 ? stack[index] : undefined;
  const previousFrame = previousStep?.stack.find((candidate) => candidate.id === frame?.id);
  const locals = frame ? expandSelf(frame.locals) : {};
  const previousLocals = previousFrame ? expandSelf(previousFrame.locals) : undefined;
  const diff = frame ? diffLocals(previousLocals, locals) : null;
  const localEntries = Object.entries(locals);

  const globals = currentStep?.globals ?? {};
  const globalEntries = Object.entries(globals).filter(([, value]) => value.k !== 'func');
  const previousGlobals = previousStep?.globals ?? {};
  const globalsDiff = diffLocals(previousGlobals, globals);
  const stepKey = currentStep?.i ?? 'empty';

  return (
    <section className="panel variables-panel" aria-label="Variables">
      <header className="panel-header">
        <h2>Variables</h2>
        {frame ? (
          <span className="panel-hint">
            {frame.func === '<module>' ? 'module scope' : `${frame.func}()`}
          </span>
        ) : null}
      </header>

      {!frame ? (
        <p className="panel-empty">Run code to inspect variables.</p>
      ) : (
        <div className="panel-scroll">
          {frame.elided ? (
            <p className="panel-note">Frame too deep — locals were elided to save memory.</p>
          ) : null}
          <table className="var-table">
            <tbody>
              {localEntries.map(([name, value]) => (
                <VariableRow
                  badge={diff?.added.has(name) ? 'new' : diff?.changed.has(name) ? 'changed' : null}
                  isWatched={watchedVariables.includes(name)}
                  key={`${stepKey}-${name}`}
                  name={name}
                  onToggleWatch={onToggleWatch}
                  value={value}
                />
              ))}
              {diff && diff.removed.size > 0
                ? [...diff.removed].map((name) => (
                    <tr className="is-removed" key={`${stepKey}-removed-${name}`}>
                      <td className="var-name">{name}</td>
                      <td className="var-type" />
                      <td className="var-value">removed</td>
                    </tr>
                  ))
                : null}
            </tbody>
          </table>

          {globalEntries.length > 0 ? (
            <>
              <h3 className="subsection">Globals</h3>
              <table className="var-table">
                <tbody>
                  {globalEntries.map(([name, value]) => (
                    <VariableRow
                      badge={
                        globalsDiff.added.has(name)
                          ? 'new'
                          : globalsDiff.changed.has(name)
                            ? 'changed'
                            : null
                      }
                      isWatched={watchedVariables.includes(name)}
                      key={`${stepKey}-global-${name}`}
                      name={name}
                      onToggleWatch={onToggleWatch}
                      value={value}
                    />
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
        </div>
      )}
    </section>
  );
}
