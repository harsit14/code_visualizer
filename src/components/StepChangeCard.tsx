/**
 * "What just happened" card: the statement that produced the current state,
 * the values it changed and anything it printed.
 */
import { Pin } from 'lucide-react';
import type { StepChange } from '../engine/stepChange';

type StepChangeCardProps = {
  change: StepChange | null;
  code: string;
  watchedVariables: readonly string[];
  onFocusLine?: (line: number) => void;
  onWatch?: (name: string) => void;
};

const SOURCE_PREVIEW = 64;

function sourceLine(code: string, line: number | null): string | null {
  if (line === null) return null;
  const text = code.split('\n')[line - 1]?.trim();
  if (!text) return null;
  return text.length > SOURCE_PREVIEW ? `${text.slice(0, SOURCE_PREVIEW - 1)}…` : text;
}

export function StepChangeCard({
  change,
  code,
  watchedVariables,
  onFocusLine,
  onWatch,
}: StepChangeCardProps) {
  if (!change) return null;
  const source = sourceLine(code, change.line);
  const printed = change.output.replace(/\n$/, '');
  return (
    <section aria-label="What just happened" className={`step-change step-change-${change.kind}`}>
      {change.line !== null ? (
        <p className="step-change-source">
          <button
            className="step-change-line"
            onClick={() => onFocusLine?.(change.line!)}
            title="Show this line in the editor"
            type="button"
          >
            Line {change.line}
          </button>
          {source ? <code>{source}</code> : null}
        </p>
      ) : null}
      <p className="step-change-summary">{change.summary}</p>
      {change.changes.length ? (
        <ul className="step-change-list">
          {change.changes.map((item) => {
            const watched = watchedVariables.includes(item.root);
            return (
              <li key={`${item.path}-${item.before}-${item.after}`}>
                <button
                  aria-label={
                    watched ? `${item.root} is pinned to Watch` : `Pin ${item.root} to Watch`
                  }
                  className="step-change-path"
                  disabled={watched || !onWatch}
                  onClick={() => onWatch?.(item.root)}
                  title={watched ? 'Pinned to Watch' : 'Pin to Watch'}
                  type="button"
                >
                  {item.path}
                  {watched ? <Pin aria-hidden="true" size={11} /> : null}
                </button>
                <span
                  className={item.before === null ? 'step-change-absent' : 'step-change-before'}
                >
                  {item.before ?? 'absent'}
                </span>
                <span aria-hidden="true" className="step-change-arrow">
                  →
                </span>
                <span className="sr-only"> becomes </span>
                <span className={item.after === null ? 'step-change-absent' : 'step-change-after'}>
                  {item.after ?? 'removed'}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {change.hiddenChanges > 0 ? (
        <p className="step-change-more">
          +{change.hiddenChanges} more change{change.hiddenChanges === 1 ? '' : 's'}
        </p>
      ) : null}
      {printed ? (
        <p className="step-change-output">
          Printed{' '}
          <code>
            {printed.length > SOURCE_PREVIEW ? `${printed.slice(0, SOURCE_PREVIEW - 1)}…` : printed}
          </code>
        </p>
      ) : null}
    </section>
  );
}
