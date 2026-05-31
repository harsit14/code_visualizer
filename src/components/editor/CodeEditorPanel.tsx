import { Braces, FileCode2, Trash2 } from 'lucide-react';
import type { PythonStaticDiagnostic } from '../../languages/python/runtimeTypes';

type CodeEditorPanelProps = {
  activeLine?: number;
  code: string;
  diagnostics: PythonStaticDiagnostic[];
  executedLines: number[];
  isCustomSnippet: boolean;
  onClear: () => void;
  onChange: (code: string) => void;
  onLineSelect: (line: number) => void;
  sourceTitle: string;
};

export function CodeEditorPanel({
  activeLine,
  code,
  diagnostics,
  executedLines,
  isCustomSnippet,
  onClear,
  onChange,
  onLineSelect,
  sourceTitle,
}: CodeEditorPanelProps) {
  const lines = code.split('\n');
  const executedLineSet = new Set(executedLines);
  const diagnosticByLine = new Map(
    diagnostics
      .filter((diagnostic) => diagnostic.line)
      .map((diagnostic) => [diagnostic.line as number, diagnostic]),
  );

  return (
    <section className="panel editor-panel" aria-label="Python source editor">
      <header className="panel-header">
        <div>
          <span className="eyebrow">Source</span>
          <h2>
            <FileCode2 size={18} />
            {sourceTitle}
          </h2>
        </div>
        <div className="editor-actions">
          <span className="panel-chip">
            <Braces size={14} />
            {lines.length} lines
          </span>
          {isCustomSnippet ? (
            <button
              className="compact-icon-button"
              disabled={code.length === 0}
              onClick={onClear}
              title="Clear custom snippet"
              type="button"
            >
              <Trash2 size={14} />
              <span>Clear</span>
            </button>
          ) : null}
        </div>
      </header>

      <div className="editor-shell">
        <ol className="line-gutter" aria-label="Executable source lines">
          {lines.map((_, index) => (
            <li key={index}>
              <button
                className={[
                  'line-jump',
                  activeLine === index + 1 ? 'is-active' : '',
                  executedLineSet.has(index + 1) ? 'is-executed' : '',
                  diagnosticByLine.has(index + 1) ? 'is-diagnostic' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                disabled={!executedLineSet.has(index + 1) && !diagnosticByLine.has(index + 1)}
                onClick={() => onLineSelect(index + 1)}
                title={
                  diagnosticByLine.has(index + 1)
                    ? `Diagnostic: ${diagnosticByLine.get(index + 1)?.message}`
                    : executedLineSet.has(index + 1)
                      ? `Jump to first execution of line ${index + 1}`
                      : `Line ${index + 1} has not run yet`
                }
                type="button"
              >
                {index + 1}
              </button>
            </li>
          ))}
        </ol>
        <textarea
          aria-label="Python code"
          className="code-input"
          onChange={(event) => onChange(event.target.value)}
          placeholder={isCustomSnippet ? 'Paste or type Python here' : undefined}
          spellCheck={false}
          value={code}
          wrap="off"
        />
      </div>
    </section>
  );
}
