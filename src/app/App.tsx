/**
 * App shell: layout, theme, share links, trace export/import, and wiring
 * between the session hook and the dashboard panels.
 */
import { MobileWorkspaceTabs } from '../components/MobileWorkspaceTabs';
import { panelMobileTab, useMobileWorkspace } from './useMobileWorkspace';
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
import { loadStoredCodeDraft } from './codeDraft';
import { useDraftPersistence } from './useDraftPersistence';
import { pairPercentage, type ColumnId, type PanelId } from './layoutState';
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
  const { mobile, mobileTab, setMobileTab } = useMobileWorkspace();
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
  const { draftAvailable, draftStatus, queueDraft, flushDraft } = useDraftPersistence();
  const {
    adjustColumnPair,
    adjustPanelPair,
    columnsTemplate,
    columnWeights,
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
  const {
    clearHistoryItemId,
    historyRefreshToken,
    setHistoryItemId,
    historySyncEnabled,
    setHistorySyncEnabled,
    historySaveStatus,
    historyError,
    retryHistorySave,
  } = useCodeHistorySync({
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
      flushDraft();
      userEditedRef.current = false;
      setExampleId(null);
      setWatchedVariables([]);
      resetTraceNavigation();
      importSession(code, result, step, language);
    },
    [clearHistoryItemId, flushDraft, importSession, resetTraceNavigation],
  );
  const {
    importError,
    dismissImportError,
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

  const handleCodeChange = useCallback(
    (code: string) => {
      clearHistoryItemId();
      userEditedRef.current = true;
      queueDraft(code, session.language);
      setExampleId(null);
      setWatchedVariables([]);
      resetTraceNavigation();
      setCode(code);
    },
    [clearHistoryItemId, queueDraft, resetTraceNavigation, session.language, setCode],
  );

  const handleExampleChange = useCallback(
    (id: string) => {
      flushDraft();
      if (id === CUSTOM_CODE_ID) {
        const draft = loadStoredCodeDraft();
        if (!draft) {
          return;
        }
        clearHistoryItemId();
        flushDraft();
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
      userEditedRef.current = false;
      setLanguage(example.language);
      setCode(example.code);
    },
    [clearHistoryItemId, flushDraft, resetTraceNavigation, session, setCode, setLanguage],
  );

  const handleLanguageChange = useCallback(
    (nextLanguage: Language) => {
      flushDraft();
      if (userEditedRef.current) queueDraft(session.code, nextLanguage);
      clearHistoryItemId();
      setExampleId(null);
      setWatchedVariables([]);
      resetTraceNavigation();
      setLanguage(nextLanguage);
    },
    [clearHistoryItemId, flushDraft, queueDraft, resetTraceNavigation, session.code, setLanguage],
  );

  const handleOpenHistoryItem = useCallback(
    (item: CodeHistoryItem) => {
      setHistoryItemId(item.id);
      flushDraft();
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
    [flushDraft, resetTraceNavigation, session, setHistoryItemId],
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

  const visiblePanels = mobile
    ? Object.fromEntries(Object.keys(panelVisibility).map((key) => [key, true]))
    : panelVisibility;

  const leftSlots: PanelSlotConfig[] = [
    visiblePanels.code
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
    showInputs && visiblePanels.inputs
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

  const centerSlots: PanelSlotConfig[] = visiblePanels.data
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
    visiblePanels.variables
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
    visiblePanels.watch
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
    visiblePanels.callStack && Boolean(run)
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
    visiblePanels.explainer
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
    visiblePanels.console
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
            data-panel-id={slot.id}
            hidden={mobile && panelMobileTab[slot.id] !== mobileTab}
            ref={(node) => registerPanelSlot(slot.id, node)}
            style={{ flex: panelWeights[slot.id] }}
          >
            {slot.content}
          </div>
          {!mobile && index < slots.length - 1 ? (
            <div
              aria-label={`Resize ${slot.id} and ${slots[index + 1].id}`}
              aria-orientation="horizontal"
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={pairPercentage(
                panelWeights[slot.id],
                panelWeights[slots[index + 1].id],
              )}
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
    <div
      className={`app-shell dashboard-instrument${embedMode ? ' app-shell-embed' : ''}${mobile ? ' mobile-workspace' : ''}`}
    >
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
            mobile={mobile}
            storageControls={
              <>
                <strong className="workspace-menu-heading">Saving and privacy</strong>
                <label className="panel-menu-item">
                  <input
                    type="checkbox"
                    checked={historySyncEnabled}
                    onChange={(event) => setHistorySyncEnabled(event.target.checked)}
                  />
                  Save runs to account history
                </label>
                <p className="account-note">
                  {historySyncEnabled
                    ? 'Successful runs send source code and inputs to your signed-in account. Turn off to keep future runs local.'
                    : 'Local only. Running code does not send it to account history. AI explanations send code only when requested.'}
                </p>
              </>
            }
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

        {!embedMode &&
          (draftStatus !== 'idle' || (historySyncEnabled && historySaveStatus !== 'idle')) && (
            <div className="persistence-status">
              {!embedMode && draftStatus !== 'idle' && (
                <div className="save-status" role={draftStatus === 'failed' ? 'alert' : 'status'}>
                  <span>
                    {draftStatus === 'pending'
                      ? 'Saving draft…'
                      : draftStatus === 'saved'
                        ? 'Draft saved on this device'
                        : draftStatus === 'cleared'
                          ? 'Draft cleared on this device'
                          : 'Draft not saved. Storage may be full or unavailable, or code exceeds 100,000 characters.'}
                  </span>
                  {draftStatus === 'failed' && (
                    <button type="button" onClick={flushDraft}>
                      Retry draft save
                    </button>
                  )}
                </div>
              )}
              {!embedMode && historySyncEnabled && historySaveStatus !== 'idle' && (
                <div
                  className="save-status"
                  role={historySaveStatus === 'failed' ? 'alert' : 'status'}
                >
                  <span>
                    {historySaveStatus === 'saving'
                      ? 'Saving run to account…'
                      : historySaveStatus === 'saved'
                        ? 'Run saved to account history'
                        : `History save failed: ${historyError}`}
                  </span>
                  {historySaveStatus === 'failed' && (
                    <button type="button" onClick={retryHistorySave}>
                      Retry history save
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        {importError ? (
          <div className="dashboard-onboarding" role="alert">
            <span>Import failed: {importError}</span>
            <button type="button" onClick={dismissImportError}>
              Dismiss
            </button>
          </div>
        ) : null}

        {!embedMode && !mobile && showDashboardOnboarding ? (
          <DashboardOnboardingBar onDismiss={dismissDashboardOnboarding} />
        ) : null}

        {mobile && <MobileWorkspaceTabs active={mobileTab} onChange={setMobileTab} />}
        {mobile && session.currentStep && (
          <button
            type="button"
            className="mobile-source-context"
            onClick={() => setMobileTab('Code')}
            title="Show current source line"
          >
            <span>
              Line {session.currentStep.line} ·{' '}
              {session.currentStep.phase === 'before'
                ? 'before'
                : session.currentStep.phase === 'after'
                  ? 'after'
                  : session.currentStep.event}
            </span>
            <code>{session.code.split('\n')[session.currentStep.line - 1] ?? ''}</code>
          </button>
        )}

        <main
          id="workspace-content"
          className="workbench"
          style={workbenchStyle}
          role={mobile ? 'tabpanel' : undefined}
          aria-labelledby={mobile ? `mobile-tab-${mobileTab}` : undefined}
        >
          {mobile && mobileTab === 'Inputs' && !showInputs && (
            <section className="panel mobile-empty-panel">
              <p>
                Function inputs and saved cases appear here for Python function examples. Scripts
                run directly from Code.
              </p>
            </section>
          )}
          {visibleColumns.length > 0 ? (
            visibleColumns.map((columnId, index) => (
              <Fragment key={columnId}>
                {renderPanelStack(columnId, columnSlots[columnId])}
                {!mobile && index < visibleColumns.length - 1 ? (
                  <div
                    aria-label={`Resize ${columnId} and ${visibleColumns[index + 1]} columns`}
                    aria-orientation="vertical"
                    aria-valuemax={100}
                    aria-valuemin={0}
                    aria-valuenow={pairPercentage(
                      columnWeights[columnId],
                      columnWeights[visibleColumns[index + 1]],
                    )}
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
          onStop={session.stopExecution}
          onRetryRuntime={session.retryRuntime}
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
