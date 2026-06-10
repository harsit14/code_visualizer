/**
 * Variables panel: locals of the selected frame (plus module globals in
 * function mode), with per-step diff highlighting — what changed, what's
 * new, what disappeared this step.
 */
import { diffLocals, formatValue, typeNameOf } from '../engine/trace';
import type { EncodedValue, TraceStep } from '../engine/types';

type VariablesPanelProps = {
  currentStep: TraceStep | undefined;
  previousStep: TraceStep | undefined;
  frameIndex: number | null;
};

type RowProps = {
  name: string;
  value: EncodedValue;
  badge: 'new' | 'changed' | null;
};

function VariableRow({ name, value, badge }: RowProps) {
  return (
    <tr className={badge ? `is-${badge}` : undefined}>
      <td className="var-name">{name}</td>
      <td className="var-type">{typeNameOf(value)}</td>
      <td className="var-value">
        {formatValue(value)}
        {badge ? <span className={`var-badge var-badge-${badge}`}>{badge}</span> : null}
      </td>
    </tr>
  );
}

export function VariablesPanel({ currentStep, previousStep, frameIndex }: VariablesPanelProps) {
  const stack = currentStep?.stack ?? [];
  const index = frameIndex !== null && frameIndex < stack.length ? frameIndex : stack.length - 1;
  const frame = index >= 0 ? stack[index] : undefined;
  const previousFrame = previousStep?.stack.find((candidate) => candidate.id === frame?.id);
  const diff = frame ? diffLocals(previousFrame?.locals, frame.locals) : null;

  const globals = currentStep?.globals ?? {};
  const globalEntries = Object.entries(globals).filter(([, value]) => value.k !== 'func');
  const previousGlobals = previousStep?.globals ?? {};
  const globalsDiff = diffLocals(previousGlobals, globals);

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
              {Object.entries(frame.locals).map(([name, value]) => (
                <VariableRow
                  badge={diff?.added.has(name) ? 'new' : diff?.changed.has(name) ? 'changed' : null}
                  key={name}
                  name={name}
                  value={value}
                />
              ))}
              {diff && diff.removed.size > 0
                ? [...diff.removed].map((name) => (
                    <tr className="is-removed" key={`removed-${name}`}>
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
                      key={name}
                      name={name}
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
