/**
 * Inputs panel (function mode): which function will be called, the
 * generated/overridden argument literals, the seed, and regeneration.
 *
 * Literals accept plain Python literals plus `tree([...])` and
 * `linked([...])` builders for TreeNode / ListNode arguments.
 */
import { Dices, FlaskConical, ListChecks, Play, Plus, Route, Trash2 } from 'lucide-react';
import type { PracticeTestCase, PracticeTestCaseUpdate } from '../app/practiceCases';
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
  testCases: PracticeTestCase[];
  testCasesBusy: boolean;
  onAddTestCase: () => void;
  onUpdateTestCase: (id: string, patch: PracticeTestCaseUpdate) => void;
  onRemoveTestCase: (id: string) => void;
  onRunTestCases: () => void;
  onTraceTestCase: (id: string) => void;
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
  testCases,
  testCasesBusy,
  onAddTestCase,
  onUpdateTestCase,
  onRemoveTestCase,
  onRunTestCases,
  onTraceTestCase,
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

  const updateCaseInput = (testCase: PracticeTestCase, index: number, value: string) => {
    const nextInputs = [...testCase.inputs];
    nextInputs[index] = value;
    onUpdateTestCase(testCase.id, { inputs: nextInputs });
  };

  return (
    <section className="panel inputs-panel" aria-label="Generated test inputs">
      <header className="panel-header">
        <h2>
          <FlaskConical size={14} /> Test inputs
        </h2>
        <span className="panel-hint">inputs are generated</span>
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

        <details className="test-cases-block">
          <summary>
            <span>
              <ListChecks size={13} /> Cases
            </span>
            <em>{testCases.length}</em>
          </summary>

          <div className="test-cases-body">
            <div className="test-cases-actions">
              <button disabled={!activeFunction || isBusy} onClick={onAddTestCase} type="button">
                <Plus size={13} />
                Add current
              </button>
              <button
                disabled={testCases.length === 0 || isBusy || testCasesBusy}
                onClick={onRunTestCases}
                type="button"
              >
                <Play size={13} />
                {testCasesBusy ? 'Running' : 'Run cases'}
              </button>
            </div>

            {testCases.length === 0 ? (
              <p className="test-cases-empty">No saved cases.</p>
            ) : (
              <div className="test-case-list">
                {testCases.map((testCase) => (
                  <article className="test-case-card" key={testCase.id}>
                    <header className="test-case-header">
                      <input
                        aria-label="Case name"
                        onChange={(event) =>
                          onUpdateTestCase(testCase.id, { name: event.target.value })
                        }
                        value={testCase.name}
                      />
                      <span className={`test-case-status is-${testCase.status}`}>
                        {statusLabel(testCase.status)}
                      </span>
                      <button
                        className="icon-button"
                        disabled={isBusy}
                        onClick={() => onTraceTestCase(testCase.id)}
                        title="Trace this case"
                        type="button"
                      >
                        <Route size={13} />
                      </button>
                      <button
                        className="icon-button"
                        disabled={isBusy}
                        onClick={() => onRemoveTestCase(testCase.id)}
                        title="Remove case"
                        type="button"
                      >
                        <Trash2 size={13} />
                      </button>
                    </header>

                    <div className="test-case-inputs">
                      {params.map((param, index) => (
                        <label key={`${testCase.id}-${param.name}`}>
                          <span>{param.name}</span>
                          <input
                            onChange={(event) =>
                              updateCaseInput(testCase, index, event.target.value)
                            }
                            spellCheck={false}
                            value={testCase.inputs[index] ?? ''}
                          />
                        </label>
                      ))}
                      <label>
                        <span>expected</span>
                        <input
                          onChange={(event) =>
                            onUpdateTestCase(testCase.id, { expected: event.target.value })
                          }
                          placeholder="optional"
                          spellCheck={false}
                          value={testCase.expected}
                        />
                      </label>
                    </div>

                    {testCase.error || testCase.actual !== null ? (
                      <div className="test-case-result">
                        <span>{testCase.error ? 'error' : 'actual'}</span>
                        <code>{testCase.error ?? testCase.actual}</code>
                        {testCase.runtimeMs !== null || testCase.memoryMb !== null ? (
                          <em>{formatCaseMetrics(testCase.runtimeMs, testCase.memoryMb)}</em>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </div>
        </details>
      </div>
    </section>
  );
}

function statusLabel(status: PracticeTestCase['status']): string {
  switch (status) {
    case 'pass':
      return 'pass';
    case 'fail':
      return 'fail';
    case 'error':
      return 'error';
    case 'running':
      return 'running';
    case 'ran':
      return 'ran';
    case 'idle':
    default:
      return 'saved';
  }
}

function formatCaseMetrics(runtimeMs: number | null, memoryMb: number | null): string {
  return [formatRuntime(runtimeMs), formatMemory(memoryMb)].filter(Boolean).join(' / ');
}

function formatRuntime(ms: number | null): string | null {
  if (ms === null) {
    return null;
  }
  return ms < 10 ? `${ms.toFixed(1)} ms` : `${Math.round(ms)} ms`;
}

function formatMemory(mb: number | null): string | null {
  if (mb === null) {
    return null;
  }
  return mb < 0.01 ? '<0.01 MB' : `${mb < 10 ? mb.toFixed(2) : mb.toFixed(1)} MB`;
}
