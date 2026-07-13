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
import type { Language } from '../engine/types';
import { CUSTOM_CODE_ID, DEFAULT_EXAMPLE_ID, getExample } from '../examples/examples';
import { loadStoredCodeDraft, saveStoredCodeDraft } from './codeDraft';
import type { ColumnId, PanelId } from './layoutState';
import type { CodeHistoryItem } from './historyClient';
import { decodeShareHash } from './shareState';
import { useTheme } from './theme';
import { useCodeHistorySync } from './useCodeHistorySync';
import { useResizableLayout } from './useResizableLayout';
import { useSession } from './useSession';
import { useTraceNavigation } from './useTraceNavigation';
import { useTraceTransfer } from './useTraceTransfer';
import { useTransportShortcuts } from './useTransportShortcuts';

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
  const [bootDraft] = useState(() => (shared || initialEmbedMode() ? null : loadStoredCodeDraft()));
  const [exampleId, setExampleId] = useState<string | null>(
    shared ? (shared.exampleId ?? null) : bootDraft ? null : DEFAULT_EXAMPLE_ID,
  );
  const initialCode =
    shared?.code ?? bootDraft?.code ?? getExample(exampleId ?? DEFAULT_EXAMPLE_ID)?.code ?? '';
  const initialSessionLanguage = initialLanguage(
    exampleId,
    shared?.language ?? bootDraft?.language,
  );
  const { theme, toggleTheme } = useTheme();
  const [embedMode] = useState(initialEmbedMode);
  const [showDashboardOnboarding, setShowDashboardOnboarding] = useState(() =>
    initialDashboardOnboarding(embedMode),
  );
  const [watchedVariables, setWatchedVariables] = useState<string[]>([]);
  const [draftAvailable, setDraftAvailable] = useState(() => loadStoredCodeDraft() !== null);
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
    useLearnLayout,
    startColumnResize,
    startPanelResize,
    togglePanelVisibility,
  } = useResizableLayout(embedMode);
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
  const { clearHistoryItemId, historyRefreshToken, setHistoryItemId } = useCodeHistorySync({
    code: session.code,
    embedMode,
    exampleId,
    functionOverride: session.functionOverride,
    language: session.language,
    result: session.result,
  });
  const {
    breakpointLines,
    cursorLine,
    cursorTarget,
    executionCounts,
    nextBreakpointTarget,
    resetTraceNavigation,
    runToBreakpoint,
    runToCursor,
    runToLine,
    setCursorLine,
    stepOver,
    stepOverTarget,
    toggleBreakpoint,
  } = useTraceNavigation({
    jumpToStep,
    selectedFrameIndex,
    step,
    steps,
  });

  const handleImportedTrace = useCallback(
    ({
      code,
      language,
      result,
      step,
    }: {
      code: string;
      language: Language;
      result: Parameters<typeof importSession>[1];
      step: number;
    }) => {
      clearHistoryItemId();
      userEditedRef.current = false;
      setExampleId(null);
      setWatchedVariables([]);
      resetTraceNavigation();
      importSession(code, result, step, language);
    },
    [clearHistoryItemId, importSession, resetTraceNavigation],
  );
  const {
    embedLabel,
    handleEmbed,
    handleExport,
    handleExportSvg,
    handleImport,
    handleShare,
    importLabel,
    importTitle,
    shareLabel,
  } = useTraceTransfer({
    code: session.code,
    exampleId,
    functionOverride: session.functionOverride,
    inputLiterals: session.inputLiterals,
    language: session.language,
    onImportTrace: handleImportedTrace,
    result: session.result,
    seed: session.seed,
    step: session.step,
  });

  useTransportShortcuts({
    jumpToStep,
    run: session.run,
    stepBack: session.stepBack,
    stepForward: session.stepForward,
    togglePlay: session.togglePlay,
    totalSteps: session.totalSteps,
  });

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

  const handleCodeChange = useCallback(
    (code: string) => {
      clearHistoryItemId();
      userEditedRef.current = true;
      setExampleId(null);
      setWatchedVariables([]);
      resetTraceNavigation();
      setCode(code);
    },
    [clearHistoryItemId, resetTraceNavigation, setCode],
  );

  const handleExampleChange = useCallback(
    (id: string) => {
      if (id === CUSTOM_CODE_ID) {
        const draft = loadStoredCodeDraft();
        if (!draft) {
          return;
        }
        clearHistoryItemId();
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
      clearHistoryItemId();
      setExampleId(id);
      setWatchedVariables([]);
      resetTraceNavigation();
      setLanguage(example.language);
      setCode(example.code);
    },
    [clearHistoryItemId, resetTraceNavigation, session, setCode, setLanguage],
  );

  const handleLanguageChange = useCallback(
    (nextLanguage: Language) => {
      clearHistoryItemId();
      setExampleId(null);
      setWatchedVariables([]);
      resetTraceNavigation();
      setLanguage(nextLanguage);
    },
    [clearHistoryItemId, resetTraceNavigation, setLanguage],
  );

  const handleOpenHistoryItem = useCallback(
    (item: CodeHistoryItem) => {
      setHistoryItemId(item.id);
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
    [resetTraceNavigation, session, setHistoryItemId],
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
    panelVisibility.callStack && Boolean(run)
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
                adjustPanelPair(slot.id, slots[index + 1].id, event.key === 'ArrowUp' ? -1 : 1);
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
    <div className={`app-shell dashboard-instrument${embedMode ? ' app-shell-embed' : ''}`}>
      <section className="dashboard-stage" aria-label="Code Visualizer dashboard">
        {embedMode ? (
          <header className="embed-bar">
            <span className="embed-brand">
              <LogoMark />
              <strong>Code Visualizer</strong>
            </span>
            <span
              aria-atomic="true"
              aria-live="polite"
              className={`status-pill status-${session.status.phase}`}
              role="status"
            >
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
            onUseLearnLayout={useLearnLayout}
            onTogglePanel={togglePanelVisibility}
            onToggleTheme={toggleTheme}
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
