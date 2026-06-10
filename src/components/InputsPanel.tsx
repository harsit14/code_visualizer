/**
 * Inputs panel (function mode): which function will be called, the
 * generated/overridden argument literals, the seed, and regeneration.
 *
 * Literals accept plain Python literals plus `tree([...])` and
 * `linked([...])` builders for TreeNode / ListNode arguments.
 */
import { Dices, FlaskConical } from 'lucide-react';
import type { AnalysisInfo, FunctionInfo, GeneratedInputInfo } from '../engine/types';

type InputsPanelProps = {
  analysis: AnalysisInfo | null;
  activeFunction: FunctionInfo | null;
  onFunctionChange: (qualname: string | null) => void;
  lastInputs: GeneratedInputInfo[] | null;
  drafts: Record<string, string> | null;
  onDraftsChange: (drafts: Record<string, string> | null) => void;
  seed: number | null;
  onSeedChange: (seed: number | null) => void;
  onRegenerate: () => void;
  isBusy: boolean;
};

const SOURCE_LABEL: Record<string, string> = {
  hint: 'from type hint',
  usage: 'from usage',
  name: 'from name',
  default: 'assumed',
};

export function InputsPanel({
  analysis,
  activeFunction,
  onFunctionChange,
  lastInputs,
  drafts,
  onDraftsChange,
  seed,
  onSeedChange,
  onRegenerate,
  isBusy,
}: InputsPanelProps) {
  if (!analysis || analysis.mode !== 'function') {
    return null;
  }

  const functions = analysis.functions;
  const params = activeFunction?.params ?? [];

  const literalFor = (name: string, index: number): string => {
    if (drafts?.[name] !== undefined) {
      return drafts[name];
    }
    const last = lastInputs?.[index];
    return last && last.name === name ? last.literal : '';
  };

  return (
    <section className="panel inputs-panel" aria-label="Generated test inputs">
      <header className="panel-header">
        <h2>
          <FlaskConical size={14} /> Test inputs
        </h2>
        <span className="panel-hint">no entry point — inputs are generated</span>
      </header>

      <div className="inputs-body">
        {functions.length > 1 ? (
          <label className="inputs-row">
            <span className="inputs-label">function</span>
            <select
              onChange={(event) =>
                onFunctionChange(
                  event.target.value === analysis.defaultFunction ? null : event.target.value,
                )
              }
              value={activeFunction?.qualname ?? ''}
            >
              {functions.map((fn) => (
                <option key={fn.qualname} value={fn.qualname}>
                  {fn.qualname}({fn.params.map((param) => param.name).join(', ')})
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="inputs-target">
            calling{' '}
            <code>
              {activeFunction?.qualname}({params.map((param) => param.name).join(', ')})
            </code>
          </p>
        )}

        {params.map((param, index) => (
          <label className="inputs-row" key={param.name}>
            <span className="inputs-label">
              {param.name}
              <em title={`Inferred as ${param.inferred} (${SOURCE_LABEL[param.source]})`}>
                {param.inferred} · {SOURCE_LABEL[param.source]}
              </em>
            </span>
            <input
              onChange={(event) =>
                onDraftsChange({ ...(drafts ?? {}), [param.name]: event.target.value })
              }
              placeholder="run to generate"
              spellCheck={false}
              type="text"
              value={literalFor(param.name, index)}
            />
          </label>
        ))}

        <div className="inputs-actions">
          <label className="seed-control">
            seed
            <input
              onChange={(event) =>
                onSeedChange(event.target.value === '' ? null : Number(event.target.value))
              }
              type="number"
              value={seed ?? ''}
            />
          </label>
          <button disabled={isBusy} onClick={onRegenerate} type="button">
            <Dices size={13} />
            Regenerate &amp; run
          </button>
          {drafts ? (
            <button className="ghost-button" onClick={() => onDraftsChange(null)} type="button">
              Discard edits
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
