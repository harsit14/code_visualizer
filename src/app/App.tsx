/**
 * App shell: layout, theme, share links, trace export/import, and wiring
 * between the session hook and the dashboard panels.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { CallStackPanel } from '../components/CallStackPanel';
import { ConsolePanel } from '../components/ConsolePanel';
import { ControlsBar } from '../components/ControlsBar';
import { DataPanel } from '../components/DataPanel';
import { EditorPanel } from '../components/EditorPanel';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { InputsPanel } from '../components/InputsPanel';
import { TopBar } from '../components/TopBar';
import { VariablesPanel } from '../components/VariablesPanel';
import { WatchPanel } from '../components/WatchPanel';
import type { SessionResult } from '../engine/types';
import { DEFAULT_EXAMPLE_ID, getExample } from '../examples/examples';
import {
  DEFAULT_COLUMN_WEIGHTS,
  DEFAULT_PANEL_VISIBILITY,
  DEFAULT_PANEL_WEIGHTS,
  PANEL_DEFINITIONS,
  normalizePanelVisibility,
  normalizeWeights,
  type ColumnId,
  type ColumnWeights,
  type PanelId,
  type PanelVisibility,
  type PanelWeights,
} from './layoutState';
import { decodeShareHash, encodeShareState } from './shareState';
import { useSession } from './useSession';

type Theme = 'light' | 'dark';

const EXPORT_VERSION = 2;
const DEFAULT_IMPORT_LABEL = 'Import';
const DEFAULT_IMPORT_TITLE = 'Import a previously exported trace';
const PANEL_VISIBILITY_STORAGE_KEY = 'cv-panel-visibility-v1';
const COLUMN_WEIGHTS_STORAGE_KEY = 'cv-column-weights-v1';
const PANEL_WEIGHTS_STORAGE_KEY = 'cv-panel-weights-v1';

const COLUMN_MIN_WIDTHS: Record<ColumnId, number> = {
  left: 300,
  center: 320,
  right: 280,
};

const PANEL_MIN_HEIGHT = 92;

type PanelSlotConfig = {
  content: ReactNode;
  id: PanelId;
};

function panelSlot(id: PanelId, content: ReactNode): PanelSlotConfig {
  return { content, id };
}

function isPanelSlot(slot: PanelSlotConfig | null): slot is PanelSlotConfig {
  return slot !== null;
}

function initialTheme(): Theme {
  const stored = window.localStorage.getItem('cv-theme');
  if (stored === 'light' || stored === 'dark') {
    return stored;
  }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function initialShare() {
  return decodeShareHash(window.location.hash);
}

function readStoredValue<T>(key: string, fallback: T, normalize: (value: unknown) => T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? normalize(JSON.parse(raw)) : fallback;
  } catch {
    return fallback;
  }
}

function saveStoredValue(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* local storage unavailable */
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isPanelId(id: string): id is PanelId {
  return PANEL_DEFINITIONS.some((panel) => panel.id === id);
}

function columnTrack(columnId: ColumnId, weights: ColumnWeights): string {
  return `minmax(${COLUMN_MIN_WIDTHS[columnId]}px, ${weights[columnId]}fr)`;
}

function workbenchColumns(columnIds: readonly ColumnId[], weights: ColumnWeights): string {
  if (columnIds.length === 0) {
    return '1fr';
  }
  return columnIds
    .flatMap((columnId, index) =>
      index === 0 ? [columnTrack(columnId, weights)] : ['10px', columnTrack(columnId, weights)],
    )
    .join(' ');
}

export function App() {
  const [shared] = useState(initialShare);
  const [exampleId, setExampleId] = useState<string | null>(
    shared ? (shared.exampleId ?? null) : DEFAULT_EXAMPLE_ID,
  );
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [shareLabel, setShareLabel] = useState('Share');
  const [importLabel, setImportLabel] = useState(DEFAULT_IMPORT_LABEL);
  const [importTitle, setImportTitle] = useState(DEFAULT_IMPORT_TITLE);
  const [watchedVariables, setWatchedVariables] = useState<string[]>([]);
  const [panelVisibility, setPanelVisibility] = useState<PanelVisibility>(() =>
    readStoredValue(
      PANEL_VISIBILITY_STORAGE_KEY,
      DEFAULT_PANEL_VISIBILITY,
      normalizePanelVisibility,
    ),
  );
  const [columnWeights, setColumnWeights] = useState<ColumnWeights>(() =>
    readStoredValue(COLUMN_WEIGHTS_STORAGE_KEY, DEFAULT_COLUMN_WEIGHTS, (value) =>
      normalizeWeights(value, DEFAULT_COLUMN_WEIGHTS),
    ),
  );
  const [panelWeights, setPanelWeights] = useState<PanelWeights>(() =>
    readStoredValue(PANEL_WEIGHTS_STORAGE_KEY, DEFAULT_PANEL_WEIGHTS, (value) =>
      normalizeWeights(value, DEFAULT_PANEL_WEIGHTS),
    ),
  );
  const columnRefs = useRef<Record<ColumnId, HTMLDivElement | null>>({
    left: null,
    center: null,
    right: null,
  });
  const panelSlotRefs = useRef<Partial<Record<PanelId, HTMLDivElement | null>>>({});
  const importStatusTimeoutRef = useRef<number | null>(null);

  const initialCode = shared?.code ?? getExample(DEFAULT_EXAMPLE_ID)?.code ?? '';
  const session = useSession(initialCode, {
    functionName: shared?.functionName,
    inputs: shared?.inputs,
    seed: shared?.seed,
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('cv-theme', theme);
  }, [theme]);

  useEffect(() => {
    saveStoredValue(PANEL_VISIBILITY_STORAGE_KEY, panelVisibility);
  }, [panelVisibility]);

  useEffect(() => {
    saveStoredValue(COLUMN_WEIGHTS_STORAGE_KEY, columnWeights);
  }, [columnWeights]);

  useEffect(() => {
    saveStoredValue(PANEL_WEIGHTS_STORAGE_KEY, panelWeights);
  }, [panelWeights]);

  useEffect(
    () => () => {
      if (importStatusTimeoutRef.current !== null) {
        window.clearTimeout(importStatusTimeoutRef.current);
      }
    },
    [],
  );

  // Analyze the initial snippet so the inputs panel is ready pre-run.
  useEffect(() => {
    session.scheduleAnalyze(session.code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard transport: ←/→ step, Space play/pause, Home/End jump. Ignored
  // while typing in the editor, inputs, or any form control.
  const { stepBack, stepForward, togglePlay, jumpToStep, totalSteps } = session;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable ||
          target.closest('.cm-editor'))
      ) {
        return;
      }
      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault();
          stepBack();
          break;
        case 'ArrowRight':
          event.preventDefault();
          stepForward();
          break;
        case ' ':
        case 'Spacebar':
          event.preventDefault();
          togglePlay();
          break;
        case 'Home':
          event.preventDefault();
          jumpToStep(0);
          break;
        case 'End':
          event.preventDefault();
          jumpToStep(totalSteps - 1);
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [stepBack, stepForward, togglePlay, jumpToStep, totalSteps]);

  const handleCodeChange = useCallback(
    (code: string) => {
      setExampleId(null);
      setWatchedVariables([]);
      session.setCode(code);
    },
    [session],
  );

  const handleExampleChange = useCallback(
    (id: string) => {
      const example = getExample(id);
      if (!example) {
        return;
      }
      setExampleId(id);
      setWatchedVariables([]);
      session.setCode(example.code);
    },
    [session],
  );

  const handleShare = useCallback(async () => {
    const url = new URL(window.location.href);
    url.hash = encodeShareState({
      code: session.code,
      exampleId: exampleId ?? undefined,
      inputs: session.inputLiterals,
      seed: session.seed ?? undefined,
      functionName: session.functionOverride ?? undefined,
    });
    window.history.replaceState(null, '', url);
    try {
      await navigator.clipboard?.writeText(url.toString());
      setShareLabel('Copied!');
    } catch {
      setShareLabel('Link set');
    }
    window.setTimeout(() => setShareLabel('Share'), 1800);
  }, [exampleId, session.code, session.functionOverride, session.inputLiterals, session.seed]);

  const handleExport = useCallback(() => {
    if (!session.result) {
      return;
    }
    const payload = {
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      code: session.code,
      step: session.step,
      result: session.result,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `code-visualizer-trace-${Date.now()}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [session.code, session.result, session.step]);

  const showImportStatus = useCallback((label: string, title: string) => {
    if (importStatusTimeoutRef.current !== null) {
      window.clearTimeout(importStatusTimeoutRef.current);
    }
    setImportLabel(label);
    setImportTitle(title);
    importStatusTimeoutRef.current = window.setTimeout(() => {
      setImportLabel(DEFAULT_IMPORT_LABEL);
      setImportTitle(DEFAULT_IMPORT_TITLE);
      importStatusTimeoutRef.current = null;
    }, 2200);
  }, []);

  const handleImport = useCallback(
    (file: File) => {
      void file
        .text()
        .then((text) => {
          try {
            const payload = JSON.parse(text) as {
              version?: number;
              code?: string;
              step?: number;
              result?: SessionResult;
            };
            if (typeof payload.code === 'string' && payload.result) {
              setExampleId(null);
              setWatchedVariables([]);
              session.importSession(payload.code, payload.result, payload.step ?? 0);
              showImportStatus('Imported', 'Trace imported successfully');
              return;
            }
            showImportStatus('Import failed', 'Selected JSON is not a Code Visualizer trace');
          } catch {
            showImportStatus('Import failed', 'Selected file is not valid JSON');
          }
        })
        .catch(() => showImportStatus('Import failed', 'Could not read selected file'));
    },
    [session, showImportStatus],
  );

  const toggleWatchedVariable = useCallback((name: string) => {
    setWatchedVariables((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name],
    );
  }, []);

  const removeWatchedVariable = useCallback((name: string) => {
    setWatchedVariables((current) => current.filter((item) => item !== name));
  }, []);

  const registerColumn = useCallback((columnId: ColumnId, node: HTMLDivElement | null) => {
    columnRefs.current[columnId] = node;
  }, []);

  const registerPanelSlot = useCallback((panelId: PanelId, node: HTMLDivElement | null) => {
    panelSlotRefs.current[panelId] = node;
  }, []);

  const togglePanelVisibility = useCallback((id: string, visible: boolean) => {
    if (!isPanelId(id)) {
      return;
    }
    setPanelVisibility((current) => ({ ...current, [id]: visible }));
  }, []);

  const resetLayout = useCallback(() => {
    setPanelVisibility({ ...DEFAULT_PANEL_VISIBILITY });
    setColumnWeights({ ...DEFAULT_COLUMN_WEIGHTS });
    setPanelWeights({ ...DEFAULT_PANEL_WEIGHTS });
  }, []);

  const startColumnResize = useCallback(
    (beforeColumn: ColumnId, afterColumn: ColumnId, event: ReactPointerEvent) => {
      if (event.button !== 0) {
        return;
      }
      const beforeNode = columnRefs.current[beforeColumn];
      const afterNode = columnRefs.current[afterColumn];
      if (!beforeNode || !afterNode) {
        return;
      }

      event.preventDefault();
      const startX = event.clientX;
      const startBefore = beforeNode.getBoundingClientRect().width;
      const startAfter = afterNode.getBoundingClientRect().width;
      const startWidths = Object.fromEntries(
        Object.entries(columnRefs.current)
          .map(([columnId, node]) => [columnId, node?.getBoundingClientRect().width])
          .filter((entry): entry is [ColumnId, number] => typeof entry[1] === 'number'),
      ) as Partial<ColumnWeights>;
      const total = startBefore + startAfter;
      const beforeMin = Math.min(COLUMN_MIN_WIDTHS[beforeColumn], total / 2);
      const afterMin = Math.min(COLUMN_MIN_WIDTHS[afterColumn], total / 2);
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const handleMove = (moveEvent: PointerEvent) => {
        const beforeWidth = clamp(
          startBefore + moveEvent.clientX - startX,
          beforeMin,
          total - afterMin,
        );
        setColumnWeights((current) => ({
          ...current,
          ...startWidths,
          [beforeColumn]: beforeWidth,
          [afterColumn]: total - beforeWidth,
        }));
      };

      const stopResize = () => {
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        window.removeEventListener('pointermove', handleMove);
      };

      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', stopResize, { once: true });
    },
    [],
  );

  const startPanelResize = useCallback(
    (beforePanel: PanelId, afterPanel: PanelId, event: ReactPointerEvent) => {
      if (event.button !== 0) {
        return;
      }
      const beforeNode = panelSlotRefs.current[beforePanel];
      const afterNode = panelSlotRefs.current[afterPanel];
      if (!beforeNode || !afterNode) {
        return;
      }

      event.preventDefault();
      const startY = event.clientY;
      const startBefore = beforeNode.getBoundingClientRect().height;
      const startAfter = afterNode.getBoundingClientRect().height;
      const startHeights = Object.fromEntries(
        Object.entries(panelSlotRefs.current)
          .map(([panelId, node]) => [panelId, node?.getBoundingClientRect().height])
          .filter((entry): entry is [PanelId, number] => typeof entry[1] === 'number'),
      ) as Partial<PanelWeights>;
      const total = startBefore + startAfter;
      const minHeight = Math.min(PANEL_MIN_HEIGHT, total / 2);
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;

      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';

      const handleMove = (moveEvent: PointerEvent) => {
        const beforeHeight = clamp(
          startBefore + moveEvent.clientY - startY,
          minHeight,
          total - minHeight,
        );
        setPanelWeights((current) => ({
          ...current,
          ...startHeights,
          [beforePanel]: beforeHeight,
          [afterPanel]: total - beforeHeight,
        }));
      };

      const stopResize = () => {
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        window.removeEventListener('pointermove', handleMove);
      };

      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', stopResize, { once: true });
    },
    [],
  );

  const run = session.result?.run ?? null;
  const errorLine = useMemo(() => {
    if (session.currentStep?.exc) {
      return session.currentStep.line;
    }
    if (session.result?.error?.line) {
      return session.result.error.line;
    }
    return null;
  }, [session.currentStep, session.result]);

  const atLastStep = session.totalSteps > 0 && session.step === session.totalSteps - 1;
  const previousStep = session.step > 0 ? session.steps[session.step - 1] : undefined;
  const showInputs = session.analysis?.mode === 'function';
  const panelControls = useMemo(
    () =>
      PANEL_DEFINITIONS.map((panel) => ({
        ...panel,
        visible: panelVisibility[panel.id],
      })),
    [panelVisibility],
  );

  const leftSlots: PanelSlotConfig[] = [
    panelVisibility.code
      ? panelSlot(
          'code',
          <ErrorBoundary
            className="editor-panel"
            resetKeys={[session.code, session.step]}
            title="Code"
          >
            <EditorPanel
              activeLine={session.currentStep?.line ?? null}
              code={session.code}
              diagnostics={session.analysis?.diagnostics ?? []}
              errorLine={errorLine}
              onChange={handleCodeChange}
              theme={theme}
            />
          </ErrorBoundary>,
        )
      : null,
    showInputs && panelVisibility.inputs
      ? panelSlot(
          'inputs',
          <ErrorBoundary
            className="inputs-panel"
            resetKeys={[session.code, session.analysis, run, session.inputDrafts]}
            title="Test inputs"
          >
            <InputsPanel
              activeFunction={session.activeFunction}
              analysis={session.analysis}
              drafts={session.inputDrafts}
              isBusy={session.isBusy}
              lastInputs={run?.inputs ?? null}
              onDraftsChange={session.setInputDrafts}
              onFunctionChange={session.setFunctionOverride}
              onRegenerate={session.regenerateInputs}
              onSeedChange={session.setSeed}
              seed={session.seed}
            />
          </ErrorBoundary>,
        )
      : null,
  ].filter(isPanelSlot);

  const centerSlots: PanelSlotConfig[] = panelVisibility.data
    ? [
        panelSlot(
          'data',
          <ErrorBoundary
            className="data-panel"
            resetKeys={[session.result, session.step, session.selectedFrameIndex]}
            title="Data"
          >
            <DataPanel
              analysis={session.analysis}
              atLastStep={atLastStep}
              currentStep={session.currentStep}
              frameIndex={session.selectedFrameIndex}
              returnValue={run?.returnValue ?? null}
            />
          </ErrorBoundary>,
        ),
      ]
    : [];

  const rightSlots: PanelSlotConfig[] = [
    panelVisibility.variables
      ? panelSlot(
          'variables',
          <ErrorBoundary
            className="variables-panel"
            resetKeys={[session.result, session.step, session.selectedFrameIndex]}
            title="Variables"
          >
            <VariablesPanel
              currentStep={session.currentStep}
              frameIndex={session.selectedFrameIndex}
              onToggleWatch={toggleWatchedVariable}
              previousStep={previousStep}
              watchedVariables={watchedVariables}
            />
          </ErrorBoundary>,
        )
      : null,
    watchedVariables.length > 0 && panelVisibility.watch
      ? panelSlot(
          'watch',
          <ErrorBoundary
            className="watch-panel"
            resetKeys={[session.result, session.step, session.selectedFrameIndex, watchedVariables]}
            title="Watch"
          >
            <WatchPanel
              analysis={session.analysis}
              currentStep={session.currentStep}
              frameIndex={session.selectedFrameIndex}
              onClear={() => setWatchedVariables([])}
              onJump={session.jumpToStep}
              onRemoveVariable={removeWatchedVariable}
              step={session.step}
              steps={session.steps}
              watchedVariables={watchedVariables}
            />
          </ErrorBoundary>,
        )
      : null,
    panelVisibility.callStack
      ? panelSlot(
          'callStack',
          <ErrorBoundary
            className="callstack-panel"
            resetKeys={[session.result, session.step, session.selectedFrameIndex]}
            title="Call stack"
          >
            <CallStackPanel
              currentStep={session.currentStep}
              onSelectFrame={session.setSelectedFrameIndex}
              selectedFrameIndex={session.selectedFrameIndex}
            />
          </ErrorBoundary>,
        )
      : null,
    panelVisibility.console
      ? panelSlot(
          'console',
          <ErrorBoundary
            className="console-panel"
            resetKeys={[session.result, session.step, session.complexity]}
            title="Console"
          >
            <ConsolePanel
              atLastStep={atLastStep}
              canMeasureComplexity={showInputs && !session.isBusy}
              complexity={session.complexity}
              complexityBusy={session.complexityBusy}
              currentStep={session.currentStep}
              onMeasureComplexity={() => void session.measureComplexity()}
              result={session.result}
            />
          </ErrorBoundary>,
        )
      : null,
  ].filter(isPanelSlot);

  const columnSlots: Record<ColumnId, PanelSlotConfig[]> = {
    left: leftSlots,
    center: centerSlots,
    right: rightSlots,
  };
  const visibleColumns = (['left', 'center', 'right'] as const).filter(
    (columnId) => columnSlots[columnId].length > 0,
  );
  const workbenchStyle = {
    '--workbench-columns': workbenchColumns(visibleColumns, columnWeights),
  } as CSSProperties;

  const renderPanelStack = (columnId: ColumnId, slots: PanelSlotConfig[]) => (
    <div className={`column column-${columnId}`} ref={(node) => registerColumn(columnId, node)}>
      {slots.map((slot, index) => (
        <Fragment key={slot.id}>
          <div
            className="panel-slot"
            ref={(node) => registerPanelSlot(slot.id, node)}
            style={{ flex: panelWeights[slot.id] }}
          >
            {slot.content}
          </div>
          {index < slots.length - 1 ? (
            <div
              aria-label={`Resize ${slot.id} and ${slots[index + 1].id}`}
              aria-orientation="horizontal"
              className="stack-resizer"
              onPointerDown={(event) => startPanelResize(slot.id, slots[index + 1].id, event)}
              role="separator"
            />
          ) : null}
        </Fragment>
      ))}
    </div>
  );

  return (
    <div className="app-shell">
      <TopBar
        canExport={Boolean(session.result?.run)}
        exampleId={exampleId}
        onExampleChange={handleExampleChange}
        onExport={handleExport}
        onImport={handleImport}
        importLabel={importLabel}
        importTitle={importTitle}
        onResetLayout={resetLayout}
        onShare={() => void handleShare()}
        onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
        onTogglePanel={togglePanelVisibility}
        panelControls={panelControls}
        shareLabel={shareLabel}
        status={session.status}
        theme={theme}
      />

      <main className="workbench" style={workbenchStyle}>
        {visibleColumns.length > 0 ? (
          visibleColumns.map((columnId, index) => (
            <Fragment key={columnId}>
              {renderPanelStack(columnId, columnSlots[columnId])}
              {index < visibleColumns.length - 1 ? (
                <div
                  aria-label={`Resize ${columnId} and ${visibleColumns[index + 1]} columns`}
                  aria-orientation="vertical"
                  className="column-resizer"
                  onPointerDown={(event) =>
                    startColumnResize(columnId, visibleColumns[index + 1], event)
                  }
                  role="separator"
                />
              ) : null}
            </Fragment>
          ))
        ) : (
          <section className="panel layout-empty" aria-label="No panels selected">
            <p>No panels selected.</p>
            <button className="ghost-button" onClick={resetLayout} type="button">
              Reset layout
            </button>
          </section>
        )}
      </main>

      <ControlsBar
        currentStep={session.currentStep}
        isBusy={session.isBusy}
        onJump={session.jumpToStep}
        onRun={() => void session.run()}
        onSpeedChange={session.setSpeed}
        onStepBack={session.stepBack}
        onStepForward={session.stepForward}
        onTogglePlay={session.togglePlay}
        playing={session.playing}
        speed={session.speed}
        step={session.step}
        totalSteps={session.totalSteps}
      />
    </div>
  );
}
