/**
 * Code editor: CodeMirror 6 with Python syntax highlighting, a moving
 * "current execution line" indicator, and an error-line marker.
 */
import { python } from '@codemirror/lang-python';
import { lintGutter, setDiagnostics, type Diagnostic as CMDiagnostic } from '@codemirror/lint';
import { StateEffect, StateField, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  GutterMarker,
  gutter,
  lineNumbers,
  type DecorationSet,
} from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import { useEffect, useMemo, useRef } from 'react';
import type { Diagnostic, Language } from '../engine/types';

type LineMarks = { active: number | null; error: number | null };

const setLineMarks = StateEffect.define<LineMarks>();
const setBreakpointLines = StateEffect.define<ReadonlySet<number>>();
const setExecutionCounts = StateEffect.define<ReadonlyMap<number, number>>();

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

const breakpointLinesField = StateField.define<ReadonlySet<number>>({
  create: () => new Set<number>(),
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setBreakpointLines)) {
        return effect.value;
      }
    }
    return value;
  },
});

const executionCountsField = StateField.define<ReadonlyMap<number, number>>({
  create: () => new Map<number, number>(),
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setExecutionCounts)) {
        return effect.value;
      }
    }
    return value;
  },
});

class BreakpointMarker extends GutterMarker {
  toDOM() {
    const marker = document.createElement('span');
    marker.className = 'cv-breakpoint-marker';
    marker.title = 'Breakpoint';
    return marker;
  }
}

class BreakpointSpacer extends GutterMarker {
  toDOM() {
    const marker = document.createElement('span');
    marker.className = 'cv-breakpoint-spacer';
    return marker;
  }
}

const breakpointMarker = new BreakpointMarker();
const breakpointSpacer = new BreakpointSpacer();

class ExecutionCountMarker extends GutterMarker {
  constructor(readonly count: number) {
    super();
  }

  toDOM() {
    const marker = document.createElement('span');
    marker.className = 'cv-exec-count-marker';
    marker.textContent = this.count > 999 ? '999+' : String(this.count);
    marker.title = `Executed ${this.count} time${this.count === 1 ? '' : 's'} in this run`;
    return marker;
  }
}

class ExecutionCountSpacer extends GutterMarker {
  toDOM() {
    const marker = document.createElement('span');
    marker.className = 'cv-exec-count-spacer';
    marker.textContent = '999+';
    return marker;
  }
}

const executionCountSpacer = new ExecutionCountSpacer();

function breakpointGutter(onToggleBreakpoint?: (line: number) => void): Extension {
  return [
    breakpointLinesField,
    gutter({
      class: 'cv-breakpoint-gutter',
      domEventHandlers: {
        mousedown(view, line, event) {
          if (!onToggleBreakpoint) {
            return false;
          }
          event.preventDefault();
          const lineNumber = view.state.doc.lineAt(line.from).number;
          onToggleBreakpoint(lineNumber);
          return true;
        },
      },
      initialSpacer: () => breakpointSpacer,
      lineMarker(view, line) {
        const lineNumber = view.state.doc.lineAt(line.from).number;
        return view.state.field(breakpointLinesField).has(lineNumber) ? breakpointMarker : null;
      },
      lineMarkerChange(update) {
        return (
          update.docChanged ||
          update.transactions.some((transaction) =>
            transaction.effects.some((effect) => effect.is(setBreakpointLines)),
          )
        );
      },
      renderEmptyElements: true,
    }),
  ];
}

function executionCountGutter(): Extension {
  return [
    executionCountsField,
    gutter({
      class: 'cv-exec-count-gutter',
      initialSpacer: () => executionCountSpacer,
      lineMarker(view, line) {
        const lineNumber = view.state.doc.lineAt(line.from).number;
        const count = view.state.field(executionCountsField).get(lineNumber) ?? 0;
        return count > 0 ? new ExecutionCountMarker(count) : null;
      },
      lineMarkerChange(update) {
        return (
          update.docChanged ||
          update.transactions.some((transaction) =>
            transaction.effects.some((effect) => effect.is(setExecutionCounts)),
          )
        );
      },
      renderEmptyElements: true,
    }),
  ];
}

function lineNumberGutter(onRunToLine?: (line: number) => void): Extension {
  return lineNumbers({
    domEventHandlers: {
      contextmenu(view, line, event) {
        if (!onRunToLine) {
          return false;
        }
        event.preventDefault();
        onRunToLine(view.state.doc.lineAt(line.from).number);
        return true;
      },
    },
  });
}

const baseExtensions = [python(), lineMarksField, lintGutter(), EditorView.lineWrapping];

function scrollLineWithinEditor(view: EditorView, lineNumber: number) {
  const scroller = view.scrollDOM;
  if (scroller.clientHeight <= 0) {
    return;
  }

  const line = view.state.doc.line(lineNumber);
  const block = view.lineBlockAt(line.from);
  const margin = Math.min(24, Math.max(6, scroller.clientHeight * 0.08));
  const visibleTop = scroller.scrollTop;
  const visibleBottom = visibleTop + scroller.clientHeight;

  if (block.top < visibleTop + margin) {
    scroller.scrollTop = Math.max(0, block.top - margin);
    return;
  }

  if (block.bottom > visibleBottom - margin) {
    scroller.scrollTop = Math.min(
      scroller.scrollHeight - scroller.clientHeight,
      block.bottom - scroller.clientHeight + margin,
    );
  }
}

/** Map analyzer diagnostics to CodeMirror diagnostics with document offsets. */
function toCmDiagnostics(view: EditorView, diagnostics: Diagnostic[]): CMDiagnostic[] {
  const doc = view.state.doc;
  return diagnostics.map((diagnostic) => {
    const lineNumber = Math.min(Math.max(diagnostic.line ?? 1, 1), doc.lines);
    const line = doc.line(lineNumber);
    const column = Math.min(Math.max(diagnostic.column ?? 0, 0), line.length);
    // Underline from the reported column to end of line (whole line when col 0).
    const from = line.from + column;
    const to = Math.max(from + 1, line.to);
    return { from, to, severity: diagnostic.severity, message: diagnostic.message };
  });
}

type EditorPanelProps = {
  code: string;
  onChange: (code: string) => void;
  activeLine: number | null;
  breakpoints: readonly number[];
  executionCounts: ReadonlyMap<number, number>;
  errorLine: number | null;
  diagnostics: Diagnostic[];
  onCursorLineChange?: (line: number | null) => void;
  onRunToLine?: (line: number) => void;
  onToggleBreakpoint?: (line: number) => void;
  readOnly?: boolean;
  language: Language;
  theme: 'light' | 'dark';
};

export function EditorPanel({
  code,
  onChange,
  activeLine,
  breakpoints,
  executionCounts,
  errorLine,
  diagnostics,
  onCursorLineChange,
  onRunToLine,
  onToggleBreakpoint,
  readOnly = false,
  language,
  theme,
}: EditorPanelProps) {
  const viewRef = useRef<EditorView | null>(null);
  const extensions = useMemo(
    () => [
      ...(language === 'python' ? baseExtensions : [lineMarksField, EditorView.lineWrapping]),
      lineNumberGutter(onRunToLine),
      breakpointGutter(onToggleBreakpoint),
      executionCountGutter(),
      ...(readOnly ? [EditorView.editable.of(false)] : []),
    ],
    [language, onRunToLine, onToggleBreakpoint, readOnly],
  );

  useEffect(() => {
    const view = viewRef.current;
    if (view) {
      view.dispatch({ effects: setLineMarks.of({ active: activeLine, error: errorLine }) });
      if (activeLine !== null && activeLine >= 1 && activeLine <= view.state.doc.lines) {
        scrollLineWithinEditor(view, activeLine);
      }
    }
  }, [activeLine, errorLine, code]);

  // Surface analyzer diagnostics inline (underlines + gutter markers + hover).
  useEffect(() => {
    const view = viewRef.current;
    if (view && language === 'python') {
      view.dispatch(setDiagnostics(view.state, toCmDiagnostics(view, diagnostics)));
    }
  }, [diagnostics, code, language]);

  useEffect(() => {
    const view = viewRef.current;
    if (view) {
      view.dispatch({ effects: setBreakpointLines.of(new Set(breakpoints)) });
    }
  }, [breakpoints, code]);

  useEffect(() => {
    const view = viewRef.current;
    if (view) {
      view.dispatch({ effects: setExecutionCounts.of(new Map(executionCounts)) });
    }
  }, [executionCounts, code]);

  useEffect(
    () => () => {
      onCursorLineChange?.(null);
    },
    [onCursorLineChange],
  );

  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');

  return (
    <section className="panel editor-panel" aria-label={`${language} source editor`}>
      <header className="panel-header">
        <h2>Code</h2>
        <span className="panel-hint">{code.split('\n').length} lines</span>
      </header>
      <div className="editor-host">
        <CodeMirror
          value={code}
          onChange={onChange}
          theme={theme}
          extensions={extensions}
          onCreateEditor={(view) => {
            viewRef.current = view;
            onCursorLineChange?.(view.state.doc.lineAt(view.state.selection.main.head).number);
          }}
          onUpdate={(update) => {
            if (update.selectionSet || update.docChanged) {
              onCursorLineChange?.(
                update.state.doc.lineAt(update.state.selection.main.head).number,
              );
            }
          }}
          basicSetup={{
            foldGutter: false,
            lineNumbers: false,
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
