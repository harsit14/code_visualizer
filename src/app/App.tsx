/**
 * App shell: layout, theme, share links, trace export/import, and wiring
 * between the session hook and the dashboard panels.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { CallStackPanel } from '../components/CallStackPanel';
import { ConsolePanel } from '../components/ConsolePanel';
import { ControlsBar } from '../components/ControlsBar';
import { DataPanel } from '../components/DataPanel';
import { DashboardOnboardingBar } from '../components/DashboardOnboardingBar';
import { EditorPanel } from '../components/EditorPanel';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { ExplainerPanel } from '../components/ExplainerPanel';
import { InputsPanel } from '../components/InputsPanel';
import { LandingPage } from '../components/LandingPage';
import { LogoMark } from '../components/LogoMark';
import { TopBar } from '../components/TopBar';
import { VariablesPanel } from '../components/VariablesPanel';
import { WatchPanel } from '../components/WatchPanel';
import { lineExecutionCounts } from '../engine/traceMetrics';
import {
  nextStepOnLine,
  stepOverStep,
  traceBreakpointStep,
  traceStepOnLine,
} from '../engine/traceNavigation';
import type { Language, SessionResult } from '../engine/types';
import { CUSTOM_CODE_ID, DEFAULT_EXAMPLE_ID, getExample } from '../examples/examples';
import { loadStoredCodeDraft, saveStoredCodeDraft } from './codeDraft';
import type { ColumnId, PanelId } from './layoutState';
import { saveCodeHistory, type CodeHistoryItem } from './historyClient';
import { buildIframeEmbedCode, decodeShareHash, encodeShareState } from './shareState';
import { applyTheme, initialTheme, type Theme } from './theme';
import { buildTraceSvgExport } from './traceSvgExport';
import { useResizableLayout } from './useResizableLayout';
import { useSession } from './useSession';

const EXPORT_VERSION = 2;
const DEFAULT_IMPORT_LABEL = 'Import';
const DEFAULT_IMPORT_TITLE = 'Import a previously exported trace';
const DASHBOARD_ONBOARDING_STORAGE_KEY = 'cv-dashboard-onboarding-v1';
const EMBED_SEARCH_PARAM = 'embed';

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

function initialShare() {
  return decodeShareHash(window.location.hash);
}

function initialEmbedMode() {
  return new URLSearchParams(window.location.search).get(EMBED_SEARCH_PARAM) === '1';
}

function initialDashboardOnboarding(embedMode: boolean) {
  if (embedMode) {
    return false;
  }
  try {
    return window.localStorage.getItem(DASHBOARD_ONBOARDING_STORAGE_KEY) !== 'dismissed';
  } catch {
    return true;
  }
}

function shouldShowDashboard(): boolean {
  return (
    initialEmbedMode() ||
    window.location.pathname.startsWith('/app') ||
    window.location.hash.startsWith('#cv=')
  );
}

function initialLanguage(exampleId: string | null, sharedLanguage: Language | undefined): Language {
  return sharedLanguage ?? (exampleId ? (getExample(exampleId)?.language ?? 'python') : 'python');
}

function historyTitle(exampleId: string | null, functionName: string | null, code: string): string {
  const exampleTitle = exampleId ? getExample(exampleId)?.title : null;
  if (exampleTitle) {
    return exampleTitle;
  }
  if (functionName) {
    return functionName;
  }
  return code
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)
    ?.slice(0, 80) ?? 'Untitled code';
}

export function App() {
  const [showDashboard, setShowDashboard] = useState(shouldShowDashboard);
  const openLanding = useCallback(() => {
    window.history.pushState(null, '', '/');
    setShowDashboard(false);
  }, []);

  useEffect(() => {
    const syncRoute = () => setShowDashboard(shouldShowDashboard());
    window.addEventListener('popstate', syncRoute);
    window.addEventListener('hashchange', syncRoute);
    return () => {
      window.removeEventListener('popstate', syncRoute);
      window.removeEventListener('hashchange', syncRoute);
    };
  }, []);

  return showDashboard ? <DashboardApp onOpenLanding={openLanding} /> : <LandingPage />;
}

type DashboardAppProps = {
  onOpenLanding: () => void;
};

function DashboardApp({ onOpenLanding }: DashboardAppProps) {
  const [shared] = useState(initialShare);
  // Restore the local draft on boot unless a share link or embed supplies code.
  const [bootDraft] = useState(() =>
    shared || initialEmbedMode() ? null : loadStoredCodeDraft(),
  );
  const [exampleId, setExampleId] = useState<string | null>(
    shared ? (shared.exampleId ?? null) : bootDraft ? null : DEFAULT_EXAMPLE_ID,
  );
  const initialCode =
    shared?.code ?? bootDraft?.code ?? getExample(exampleId ?? DEFAULT_EXAMPLE_ID)?.code ?? '';
  const initialSessionLanguage = initialLanguage(
    exampleId,
    shared?.language ?? bootDraft?.language,
  );
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [shareLabel, setShareLabel] = useState('Share');
  const [embedLabel, setEmbedLabel] = useState('Embed');
  const [embedMode] = useState(initialEmbedMode);
  const [showDashboardOnboarding, setShowDashboardOnboarding] = useState(() =>
    initialDashboardOnboarding(embedMode),
  );
  const [importLabel, setImportLabel] = useState(DEFAULT_IMPORT_LABEL);
  const [importTitle, setImportTitle] = useState(DEFAULT_IMPORT_TITLE);
  const [watchedVariables, setWatchedVariables] = useState<string[]>([]);
  const [draftAvailable, setDraftAvailable] = useState(() => loadStoredCodeDraft() !== null);
  const [historyRefreshToken, setHistoryRefreshToken] = useState(0);
  const [breakpoints, setBreakpoints] = useState<Set<number>>(() => new Set());
  const [cursorLine, setCursorLine] = useState<number | null>(null);
  const {
    adjustColumnPair,
    adjustPanelPair,
    columnsTemplate,
    panelControls,
    panelVisibility,
    panelWeights,
    registerColumn,
    registerPanelSlot,
    resetLayout,
    showAllPanels,
    startColumnResize,
    startPanelResize,
    togglePanelVisibility,
  } = useResizableLayout(embedMode);
  const importStatusTimeoutRef = useRef<number | null>(null);
  const currentHistoryIdRef = useRef<string | null>(null);
  // Only actual typing produces a draft; programmatic loads (examples,
  // history, imports, the restore itself) must not overwrite it.
  const userEditedRef = useRef(false);

  const session = useSession(initialCode, {
    language: initialSessionLanguage,
    functionName: shared?.functionName,
    inputs: shared?.inputs,
    seed: shared?.seed,
  });
  const { importSession, jumpToStep, selectedFrameIndex, setCode, setLanguage, step, steps } =
    session;

  const executionCounts = useMemo(() => lineExecutionCounts(steps), [steps]);
  const breakpointLines = useMemo(() => [...breakpoints].sort((a, b) => a - b), [breakpoints]);
  const nextBreakpointTarget = useMemo(
    () => traceBreakpointStep(steps, step, breakpoints),
    [breakpoints, step, steps],
  );
  const cursorTarget = useMemo(
    () => traceStepOnLine(steps, step, cursorLine),
    [cursorLine, step, steps],
  );
  const stepOverTarget = useMemo(
    () => stepOverStep(steps, step, selectedFrameIndex),
    [selectedFrameIndex, step, steps],
  );

  const resetTraceNavigation = useCallback(() => {
    setBreakpoints(new Set());
    setCursorLine(null);
  }, []);

  const toggleBreakpoint = useCallback((line: number) => {
    setBreakpoints((current) => {
      const next = new Set(current);
      if (next.has(line)) {
        next.delete(line);
      } else {
        next.add(line);
      }
      return next;
    });
  }, []);

  const runToLine = useCallback(
    (line: number) => {
      const target = nextStepOnLine(steps, step, line);
      if (target !== null) {
        jumpToStep(target);
      }
    },
    [jumpToStep, step, steps],
  );

  const runToBreakpoint = useCallback(() => {
    if (nextBreakpointTarget !== null) {
      jumpToStep(nextBreakpointTarget);
    }
  }, [jumpToStep, nextBreakpointTarget]);

  const runToCursor = useCallback(() => {
    if (cursorTarget !== null) {
      jumpToStep(cursorTarget);
    }
  }, [cursorTarget, jumpToStep]);

  const stepOver = useCallback(() => {
    if (stepOverTarget !== null) {
      jumpToStep(stepOverTarget);
    }
  }, [jumpToStep, stepOverTarget]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

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

  // Autosave custom code as a local draft so switching examples or
  // languages, or reloading the page, never loses typed work.
  useEffect(() => {
    if (embedMode || exampleId !== null || !userEditedRef.current) {
      return;
    }
    const timeout = window.setTimeout(() => {
      saveStoredCodeDraft(session.code, session.language);
      setDraftAvailable(session.code.trim().length > 0);
    }, 600);
    return () => window.clearTimeout(timeout);
  }, [embedMode, exampleId, session.code, session.language]);

  useEffect(() => {
    if (embedMode || session.result?.status !== 'ok' || !session.result.run) {
      return;
    }

    let cancelled = false;
    const run = session.result.run;
    void saveCodeHistory({
      code: session.code,
      exampleId,
      functionName: run.functionName ?? session.functionOverride,
      id: currentHistoryIdRef.current,
      inputs: run.inputs.map((input) => input.literal),
      language: session.language,
      seed: run.seed,
      title: historyTitle(exampleId, run.functionName ?? session.functionOverride, session.code),
    })
      .then((item) => {
        if (!cancelled && item) {
          currentHistoryIdRef.current = item.id;
          setHistoryRefreshToken((current) => current + 1);
        }
      })
      .catch(() => {
        /* History is best-effort: guests and local static dev can still run code. */
      });

    return () => {
      cancelled = true;
    };
  }, [
    embedMode,
    exampleId,
    session.code,
    session.functionOverride,
    session.language,
    session.result,
  ]);

  // Keyboard transport: Cmd/Ctrl+Enter run, ←/→ step, Space play/pause,
  // Home/End jump. Transport keys are ignored while typing; run is global.
  const { stepBack, stepForward, togglePlay, totalSteps, run: runSession } = session;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key === 'Enter') {
        event.preventDefault();
        void runSession();
        return;
      }
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
  }, [stepBack, stepForward, togglePlay, jumpToStep, totalSteps, runSession]);

  const handleCodeChange = useCallback(
    (code: string) => {
      currentHistoryIdRef.current = null;
      userEditedRef.current = true;
      setExampleId(null);
      setWatchedVariables([]);
      resetTraceNavigation();
      setCode(code);
    },
    [resetTraceNavigation, setCode],
  );

  const handleExampleChange = useCallback(
    (id: string) => {
      if (id === CUSTOM_CODE_ID) {
        const draft = loadStoredCodeDraft();
        if (!draft) {
          return;
        }
        currentHistoryIdRef.current = null;
        userEditedRef.current = false;
        setExampleId(null);
        setWatchedVariables([]);
        resetTraceNavigation();
        session.loadSource(draft.code, { language: draft.language });
        return;
      }
      const example = getExample(id);
      if (!example) {
        return;
      }
      currentHistoryIdRef.current = null;
      setExampleId(id);
      setWatchedVariables([]);
      resetTraceNavigation();
      setLanguage(example.language);
      setCode(example.code);
    },
    [resetTraceNavigation, session, setCode, setLanguage],
  );

  const handleLanguageChange = useCallback(
    (nextLanguage: Language) => {
      currentHistoryIdRef.current = null;
      setExampleId(null);
      setWatchedVariables([]);
      resetTraceNavigation();
      setLanguage(nextLanguage);
    },
    [resetTraceNavigation, setLanguage],
  );

  const buildShareUrl = useCallback(
    (embed: boolean) => {
      const url = new URL(window.location.href);
      url.hash = encodeShareState({
        code: session.code,
        exampleId: exampleId ?? undefined,
        inputs: session.inputLiterals,
        language: session.language,
        seed: session.seed ?? undefined,
        functionName: session.functionOverride ?? undefined,
      });
      if (embed) {
        url.searchParams.set(EMBED_SEARCH_PARAM, '1');
      } else {
        url.searchParams.delete(EMBED_SEARCH_PARAM);
      }
      return url;
    },
    [
      exampleId,
      session.code,
      session.functionOverride,
      session.inputLiterals,
      session.language,
      session.seed,
    ],
  );

  const handleShare = useCallback(async () => {
    const url = buildShareUrl(false);
    window.history.replaceState(null, '', url);
    try {
      if (!navigator.clipboard) {
        throw new Error('Clipboard unavailable');
      }
      await navigator.clipboard.writeText(url.toString());
      setShareLabel('Copied!');
    } catch {
      setShareLabel('Link set');
    }
    window.setTimeout(() => setShareLabel('Share'), 1800);
  }, [buildShareUrl]);

  const handleEmbed = useCallback(async () => {
    const url = buildShareUrl(true);
    const code = buildIframeEmbedCode(url.toString());
    try {
      if (!navigator.clipboard) {
        throw new Error('Clipboard unavailable');
      }
      await navigator.clipboard.writeText(code);
      setEmbedLabel('Copied!');
    } catch {
      setEmbedLabel('Copy failed');
    }
    window.setTimeout(() => setEmbedLabel('Embed'), 1800);
  }, [buildShareUrl]);

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
      language: session.language,
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
  }, [session.code, session.language, session.result, session.step]);

  const handleExportSvg = useCallback(() => {
    const exportData = buildTraceSvgExport(session.code, session.result);
    if (!exportData) {
      return;
    }
    const blob = new Blob([exportData.svg], {
      type: 'image/svg+xml;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = exportData.filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [session.code, session.result]);

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
              language?: Language;
              step?: number;
              result?: SessionResult;
            };
            if (typeof payload.code === 'string' && payload.result) {
              const importedLanguage: Language =
                payload.language === 'javascript' || payload.language === 'typescript'
                  ? payload.language
                  : 'python';
              currentHistoryIdRef.current = null;
              userEditedRef.current = false;
              setExampleId(null);
              setWatchedVariables([]);
              resetTraceNavigation();
              importSession(payload.code, payload.result, payload.step ?? 0, importedLanguage);
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
    [resetTraceNavigation, importSession, showImportStatus],
  );

  const handleOpenHistoryItem = useCallback(
    (item: CodeHistoryItem) => {
      currentHistoryIdRef.current = item.id;
      userEditedRef.current = false;
      setExampleId(item.exampleId);
      setWatchedVariables([]);
      resetTraceNavigation();
      session.loadSource(item.code, {
        functionName: item.functionName,
        inputs: item.inputs,
        language: item.language,
        seed: item.seed,
      });
    },
    [resetTraceNavigation, session],
  );

  const toggleWatchedVariable = useCallback((name: string) => {
    setWatchedVariables((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name],
    );
  }, []);

  const removeWatchedVariable = useCallback((name: string) => {
    setWatchedVariables((current) => current.filter((item) => item !== name));
  }, []);

  const dismissDashboardOnboarding = useCallback(() => {
    setShowDashboardOnboarding(false);
    try {
      window.localStorage.setItem(DASHBOARD_ONBOARDING_STORAGE_KEY, 'dismissed');
    } catch {
      /* local storage unavailable */
    }
  }, []);

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
  const showInputs = session.language === 'python' && session.analysis?.mode === 'function';

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
              breakpoints={breakpointLines}
              code={session.code}
              diagnostics={session.analysis?.diagnostics ?? []}
              errorLine={errorLine}
              executionCounts={executionCounts}
              language={session.language}
              onChange={embedMode ? () => {} : handleCodeChange}
              onCursorLineChange={setCursorLine}
              onRunToLine={embedMode ? undefined : runToLine}
              onToggleBreakpoint={embedMode ? undefined : toggleBreakpoint}
              readOnly={embedMode}
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
              onAddEdgeTestCases={session.addEdgeTestCases}
              onAddTestCase={session.addTestCase}
              onAcceptTestCaseActual={session.acceptTestCaseActual}
              onDraftsChange={session.setInputDrafts}
              onFunctionChange={session.setFunctionOverride}
              onPracticeNotebookChange={session.updatePracticeNotebook}
              onRegenerate={session.regenerateInputs}
              onRemoveTestCase={session.removeTestCase}
              onRunFailedTestCases={session.runFailedTestCases}
              onRunTestCases={session.runTestCases}
              onSeedChange={session.setSeed}
              onTraceTestCase={session.traceTestCase}
              onUpdateTestCase={session.updateTestCase}
              practiceNotebook={session.practiceNotebook}
              seed={session.seed}
              testCases={session.testCases}
              testCasesBusy={session.testCasesBusy}
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
              previousStep={previousStep}
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
    panelVisibility.watch
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
              step={session.step}
              steps={session.steps}
            />
          </ErrorBoundary>,
        )
      : null,
    panelVisibility.explainer
      ? panelSlot(
          'explainer',
          <ErrorBoundary
            className="explainer-panel"
            resetKeys={[session.code, session.result, session.step, session.selectedFrameIndex]}
            title="Explainer"
          >
            <ExplainerPanel
              code={session.code}
              currentStep={session.currentStep}
              frameIndex={session.selectedFrameIndex}
              language={session.language}
              previousStep={previousStep}
              result={session.result}
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
              canMeasureComplexity={session.language === 'python' && showInputs && !session.isBusy}
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
    '--workbench-columns': columnsTemplate(visibleColumns),
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
              onKeyDown={(event) => {
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                adjustPanelPair(
                  slot.id,
                  slots[index + 1].id,
                  event.key === 'ArrowUp' ? -1 : 1,
                );
              }}
              onPointerDown={(event) => startPanelResize(slot.id, slots[index + 1].id, event)}
              role="separator"
              tabIndex={0}
            />
          ) : null}
        </Fragment>
      ))}
    </div>
  );

  return (
    <div className={`app-shell design-traced${embedMode ? ' app-shell-embed' : ''}`}>
      <section className="dashboard-stage" aria-label="Code Visualizer dashboard">
        {embedMode ? (
          <header className="embed-bar">
            <span className="embed-brand">
              <LogoMark />
              <strong>Code Visualizer</strong>
            </span>
            <span className={`status-pill status-${session.status.phase}`}>
              {session.status.message}
            </span>
          </header>
        ) : (
          <TopBar
            canExport={Boolean(session.result?.run)}
            embedLabel={embedLabel}
            exampleId={exampleId}
            hasDraft={draftAvailable}
            importLabel={importLabel}
            importTitle={importTitle}
            language={session.language}
            onEmbed={() => void handleEmbed()}
            onExampleChange={handleExampleChange}
            onExport={handleExport}
            onExportSvg={handleExportSvg}
            onImport={handleImport}
            onOpenHistoryItem={handleOpenHistoryItem}
            onLanguageChange={handleLanguageChange}
            onOpenLanding={onOpenLanding}
            onResetLayout={resetLayout}
            onShare={() => void handleShare()}
            onShowAllPanels={showAllPanels}
            onTogglePanel={togglePanelVisibility}
            onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
            historyRefreshToken={historyRefreshToken}
            panelControls={panelControls}
            shareLabel={shareLabel}
            status={session.status}
            theme={theme}
          />
        )}

        {!embedMode && showDashboardOnboarding ? (
          <DashboardOnboardingBar onDismiss={dismissDashboardOnboarding} />
        ) : null}

        <p className="viewport-note">Best on desktop or tablet.</p>

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
                    onKeyDown={(event) => {
                      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
                        return;
                      }
                      event.preventDefault();
                      event.stopPropagation();
                      adjustColumnPair(
                        columnId,
                        visibleColumns[index + 1],
                        event.key === 'ArrowLeft' ? -1 : 1,
                      );
                    }}
                    onPointerDown={(event) =>
                      startColumnResize(columnId, visibleColumns[index + 1], event)
                    }
                    role="separator"
                    tabIndex={0}
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
          breakpointCount={breakpointLines.length}
          canRunToBreakpoint={nextBreakpointTarget !== null}
          canRunToCursor={cursorTarget !== null}
          canStepOver={stepOverTarget !== null}
          cursorLine={cursorLine}
          currentStep={session.currentStep}
          exampleId={exampleId}
          isBusy={session.isBusy}
          onExampleChange={handleExampleChange}
          onJump={session.jumpToStep}
          onRun={() => void session.run()}
          onRunToBreakpoint={runToBreakpoint}
          onRunToCursor={runToCursor}
          onSpeedChange={session.setSpeed}
          onStepBack={session.stepBack}
          onStepForward={session.stepForward}
          onStepOver={stepOver}
          onTogglePlay={session.togglePlay}
          playing={session.playing}
          speed={session.speed}
          status={session.status}
          step={session.step}
          totalSteps={session.totalSteps}
        />
      </section>
    </div>
  );
}
