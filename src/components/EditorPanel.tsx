/**
 * Code editor: CodeMirror 6 with Python syntax highlighting, a moving
 * "current execution line" indicator, and an error-line marker.
 */
import { python } from '@codemirror/lang-python';
import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import { useEffect, useRef } from 'react';
import type { Diagnostic } from '../engine/types';

type LineMarks = { active: number | null; error: number | null };

const setLineMarks = StateEffect.define<LineMarks>();

const activeLineDecoration = Decoration.line({ class: 'cv-exec-line' });
const errorLineDecoration = Decoration.line({ class: 'cv-error-line' });

const lineMarksField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    let next = decorations.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setLineMarks)) {
        const marks = [];
        const docLines = transaction.state.doc.lines;
        const { active, error } = effect.value;
        if (error !== null && error >= 1 && error <= docLines) {
          marks.push(errorLineDecoration.range(transaction.state.doc.line(error).from));
        }
        if (active !== null && active >= 1 && active <= docLines && active !== error) {
          marks.push(activeLineDecoration.range(transaction.state.doc.line(active).from));
        }
        marks.sort((a, b) => a.from - b.from);
        next = Decoration.set(marks);
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const baseExtensions = [python(), lineMarksField, EditorView.lineWrapping];

type EditorPanelProps = {
  code: string;
  onChange: (code: string) => void;
  activeLine: number | null;
  errorLine: number | null;
  diagnostics: Diagnostic[];
  theme: 'light' | 'dark';
};

export function EditorPanel({
  code,
  onChange,
  activeLine,
  errorLine,
  diagnostics,
  theme,
}: EditorPanelProps) {
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    const view = viewRef.current;
    if (view) {
      view.dispatch({ effects: setLineMarks.of({ active: activeLine, error: errorLine }) });
      if (activeLine !== null && activeLine >= 1 && activeLine <= view.state.doc.lines) {
        view.dispatch({
          effects: EditorView.scrollIntoView(view.state.doc.line(activeLine).from, {
            y: 'nearest',
          }),
        });
      }
    }
  }, [activeLine, errorLine, code]);

  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');

  return (
    <section className="panel editor-panel" aria-label="Python source editor">
      <header className="panel-header">
        <h2>Code</h2>
        <span className="panel-hint">{code.split('\n').length} lines</span>
      </header>
      <div className="editor-host">
        <CodeMirror
          value={code}
          onChange={onChange}
          theme={theme}
          extensions={baseExtensions}
          onCreateEditor={(view) => {
            viewRef.current = view;
          }}
          basicSetup={{
            foldGutter: false,
            autocompletion: false,
            highlightActiveLine: false,
            highlightActiveLineGutter: false,
          }}
        />
      </div>
      {errors.length > 0 ? (
        <footer className="editor-diagnostics" role="alert">
          {errors.slice(0, 3).map((diagnostic, index) => (
            <p key={index}>
              {diagnostic.line ? `Line ${diagnostic.line}: ` : ''}
              {diagnostic.message}
            </p>
          ))}
        </footer>
      ) : null}
    </section>
  );
}
