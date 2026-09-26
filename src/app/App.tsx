/**
 * App shell: layout, theme, share links, trace export/import, presentation
 * mode, and wiring between the session hook and the dashboard panels.
 */
import { MobileWorkspaceTabs } from '../components/MobileWorkspaceTabs';
import { WorkspaceLibrary } from '../components/WorkspaceLibrary';
import { useWorkspaceLibrary } from './useWorkspaceLibrary';
import type { WorkspaceContent } from './workspaceFormat';
import { mobileTabs, panelMobileTab, useMobileWorkspace } from './useMobileWorkspace';
import { Fragment, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { GitCompare } from 'lucide-react';
import { CallStackPanel } from '../components/CallStackPanel';
import { ConsolePanel } from '../components/ConsolePanel';
import { ControlsBar } from '../components/ControlsBar';
import { DataPanel } from '../components/DataPanel';
import { DashboardOnboardingBar } from '../components/DashboardOnboardingBar';
import { EditorPanel } from '../components/EditorPanel';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { ExplainerPanel } from '../components/ExplainerPanel';
import { InputsPanel } from '../components/InputsPanel';
import { LessonCard } from '../components/LessonCard';
import { PresentationBar } from '../components/PresentationBar';
import { TraceFinder } from '../components/TraceFinder';
import { LogoMark } from '../components/LogoMark';
import { TopBar } from '../components/TopBar';
import { VariablesPanel } from '../components/VariablesPanel';
import { WatchPanel } from '../components/WatchPanel';
import { describeStepChange } from '../engine/stepChange';
import {
  checkpointCaptions,
  checkpointNavigation,
  moveCheckpoint,
  normalizeCheckpoints,
  toggleCheckpoint,
} from '../engine/traceCheckpoints';
import { normalizeBookmarks, type TraceBookmark } from '../engine/traceSearch';
import type { Language, SessionResult } from '../engine/types';
import { CUSTOM_CODE_ID, DEFAULT_EXAMPLE_ID, getExample } from '../examples/examples';
import {
  getLesson,
  isCorrectPrediction,
  resolveCheckpoints,
  type LessonAnswer,
} from '../lessons/lessons';
import { loadStoredCodeDraft } from './codeDraft';
import { useDraftPersistence } from './useDraftPersistence';
import {
  pairPercentage,
  PRESENTATION_PANEL_VISIBILITY,
  type ColumnId,
  type PanelId,
  type PanelVisibility,
} from './layoutState';
import type { ImportedTrace } from './traceImport';
import type { CodeHistoryItem } from './historyClient';
import { decodeShareHash } from './shareState';
import { useTheme } from './theme';
import { useCodeHistorySync } from './useCodeHistorySync';
import { useHostCapabilities } from './hostCapabilities';
import { useResizableLayout } from './useResizableLayout';
import { useRunBaseline } from './useRunBaseline';
import { useSession } from './useSession';
import { useTraceNavigation } from './useTraceNavigation';
import { useTraceTransfer } from './useTraceTransfer';
import { useTransportShortcuts } from './useTransportShortcuts';

// The comparison view and engine load only once the panel is shown.
const RunComparisonPanel = lazy(() =>
  import('../components/RunComparisonPanel').then((module) => ({
    default: module.RunComparisonPanel,
  })),
);

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

function initialLanguage(exampleId: string | null, sharedLanguage: Language | undefined): Language {
  return sharedLanguage ?? (exampleId ? (getExample(exampleId)?.language ?? 'python') : 'python');
}

type DashboardAppProps = {
  onOpenLanding: () => void;
};

const NO_BOOKMARKS: TraceBookmark[] = [];
const NO_CHECKPOINTS: number[] = [];
const NO_ANSWERS: Record<number, LessonAnswer> = {};
const PRESENTATION_MOBILE_TABS = mobileTabs.filter((tab) => tab !== 'Inputs');

export function DashboardApp({ onOpenLanding }: DashboardAppProps) {
  const { mobile, mobileTab, setMobileTab } = useMobileWorkspace();
  const capabilities = useHostCapabilities();
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
  // Presentation overrides the visible panels while it is on; null otherwise.
  const [presentation, setPresentation] = useState<PanelVisibility | null>(null);
  const presentButtonRef = useRef<HTMLButtonElement>(null);
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
  } = useResizableLayout(embedMode, presentation);
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
    restoreBreakpoints,
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

  // Bookmarks belong to one recorded trace; a new run or edit starts empty.
  // Checkpoints are bookmarked steps in presentation order.
  const [bookmarkState, setBookmarkState] = useState<{
    owner: SessionResult | null;
    items: TraceBookmark[];
    checkpoints: number[];
  }>({ owner: null, items: NO_BOOKMARKS, checkpoints: NO_CHECKPOINTS });
  const ownsBookmarks = bookmarkState.owner === session.result && Boolean(session.result);
  const bookmarks = ownsBookmarks ? bookmarkState.items : NO_BOOKMARKS;
  const checkpoints = ownsBookmarks ? bookmarkState.checkpoints : NO_CHECKPOINTS;
  const toggleBookmark = useCallback(
    (target: number) => {
      if (!session.result) return;
      setBookmarkState((state) => {
        const owned = state.owner === session.result;
        const items = owned ? state.items : NO_BOOKMARKS;
        const nextItems = items.some((bookmark) => bookmark.step === target)
          ? items.filter((bookmark) => bookmark.step !== target)
          : normalizeBookmarks([...items, { step: target, note: '' }], session.totalSteps);
        return {
          owner: session.result,
          items: nextItems,
          // Removing a bookmark also removes its checkpoint.
          checkpoints: normalizeCheckpoints(owned ? state.checkpoints : NO_CHECKPOINTS, nextItems),
        };
      });
    },
    [session.result, session.totalSteps],
  );
  const toggleCheckpointStep = useCallback(
    (target: number) => {
      setBookmarkState((state) =>
        state.owner === session.result
          ? {
              ...state,
              checkpoints: normalizeCheckpoints(
                toggleCheckpoint(state.checkpoints, target),
                state.items,
              ),
            }
          : state,
      );
    },
    [session.result],
  );
  const moveCheckpointStep = useCallback(
    (target: number, direction: -1 | 1) => {
      setBookmarkState((state) =>
        state.owner === session.result
          ? { ...state, checkpoints: moveCheckpoint(state.checkpoints, target, direction) }
          : state,
      );
    },
    [session.result],
  );
  const setBookmarkNote = useCallback(
    (target: number, note: string) => {
      setBookmarkState((state) =>
        state.owner === session.result
          ? {
              ...state,
              items: state.items.map((bookmark) =>
                bookmark.step === target ? { ...bookmark, note: note.slice(0, 500) } : bookmark,
              ),
            }
          : state,
      );
    },
    [session.result],
  );
  const { baseline, canKeepBaseline, keepBaseline, clearBaseline } = useRunBaseline({
    code: session.code,
    language: session.language,
    result: session.result,
  });
  const keepRunAsBaseline = useCallback(() => {
    keepBaseline();
    togglePanelVisibility('compare', true);
  }, [keepBaseline, togglePanelVisibility]);

  // A guided lesson is active while its unedited example is loaded.
  const lesson = session.language === 'python' ? getLesson(exampleId) : undefined;
  const lessonCheckpoints = useMemo(
    () => (lesson && session.result?.run ? resolveCheckpoints(lesson, session.steps) : null),
    [lesson, session.result, session.steps],
  );
  const [lessonState, setLessonState] = useState<{
    owner: SessionResult | null;
    answers: Record<number, LessonAnswer>;
  }>({ owner: null, answers: NO_ANSWERS });
  const lessonAnswers =
    lessonState.owner === session.result && session.result ? lessonState.answers : NO_ANSWERS;
  const answerCheckpoint = useCallback(
    (index: number, prediction: string) => {
      const checkpoint = lessonCheckpoints?.find((item) => item.index === index);
      if (!checkpoint || !session.result) return;
      setLessonState((state) => ({
        owner: session.result,
        answers: {
          ...(state.owner === session.result ? state.answers : NO_ANSWERS),
          [index]: { prediction, correct: isCorrectPrediction(prediction, checkpoint.answer) },
        },
      }));
    },
    [lessonCheckpoints, session.result],
  );
  const openCheckpoint = lessonCheckpoints?.find(
    (item) => item.step === session.step && !lessonAnswers[item.index],
  );
  // Playback pauses once at each unanswered checkpoint; pressing Play again continues.
  const pausedCheckpoint = useRef<{ result: SessionResult | null; step: number } | null>(null);
  const { playing, togglePlay } = session;
  useEffect(() => {
    if (!playing || !openCheckpoint) return;
    const last = pausedCheckpoint.current;
    if (last && last.result === session.result && last.step === openCheckpoint.step) return;
    pausedCheckpoint.current = { result: session.result, step: openCheckpoint.step };
    togglePlay();
  }, [openCheckpoint, playing, session.result, togglePlay]);

  const [finderRequest, setFinderRequest] = useState(0);
  const [editorFocus, setEditorFocus] = useState<{ line: number; token: number } | null>(null);
  const focusEditorLine = useCallback(
    (line: number) => {
      setEditorFocus((current) => ({ line, token: (current?.token ?? 0) + 1 }));
      if (mobile) setMobileTab('Code');
    },
    [mobile, setMobileTab],
  );

  const workspaceContent = useMemo<WorkspaceContent>(
    () => ({
      code: session.code,
      language: session.language,
      functionName: session.functionOverride ?? session.activeFunction?.qualname ?? null,
      inputDrafts:
        session.inputDrafts ??
        (session.activeFunction && session.inputLiterals
          ? Object.fromEntries(
              session.activeFunction.params.map((param, index) => [
                param.name,
                session.inputLiterals![index],
              ]),
            )
          : null),
      seed: session.seed,
      cases: session.testCases,
      notebook: session.practiceNotebook,
      watches: watchedVariables,
      breakpoints: breakpointLines,
      result: session.result,
      step: session.step,
      bookmarks,
      checkpoints,
    }),
    [
      bookmarks,
      checkpoints,
      session.code,
      session.language,
      session.functionOverride,
      session.activeFunction,
      session.inputDrafts,
      session.inputLiterals,
      session.seed,
      session.testCases,
      session.practiceNotebook,
      watchedVariables,
      breakpointLines,
      session.result,
      session.step,
    ],
  );
  const library = useWorkspaceLibrary(
    workspaceContent,
    (content) => {
      flushDraft();
      clearHistoryItemId();
      // Opening local replay is not a request to upload it to account history.
      setHistorySyncEnabled(false);
      userEditedRef.current = false;
      setExampleId(null);
      setWatchedVariables(content.watches);
      restoreBreakpoints(content.breakpoints);
      setBookmarkState({
        owner: content.result,
        items: content.bookmarks,
        checkpoints: content.checkpoints,
      });
      session.restoreWorkspace(content);
    },
    session.enableWorkspacePersistence,
    !embedMode,
  );
  const {
    active: activeWorkspace,
    confirmReplace: confirmWorkspaceReplace,
    detach: detachWorkspace,
  } = library;
  const { leaveWorkspace } = session;
  /** Confirms replacing an open workspace, then detaches it so later saves start a new one. */
  const replaceWorkspace = useCallback(() => {
    if (!activeWorkspace) return true;
    if (!confirmWorkspaceReplace()) return false;
    detachWorkspace();
    leaveWorkspace();
    return true;
  }, [activeWorkspace, confirmWorkspaceReplace, detachWorkspace, leaveWorkspace]);

  const handleImportedTrace = useCallback(
    ({ code, language, result, step, bookmarks, checkpoints }: ImportedTrace) => {
      if (!replaceWorkspace()) return;
      clearHistoryItemId();
      flushDraft();
      userEditedRef.current = false;
      setExampleId(null);
      setWatchedVariables([]);
      resetTraceNavigation();
      importSession(code, result, step, language);
      setBookmarkState({ owner: result, items: bookmarks, checkpoints });
    },
    [clearHistoryItemId, flushDraft, importSession, resetTraceNavigation, replaceWorkspace],
  );
  const {
    importError,
    dismissImportError,
    embedLabel,
    handleEmbed,
    handleExport,
    handleExportReplay,
    handleExportSvg,
    handleImport,
    handleShare,
    importLabel,
    importTitle,
    replayNotice,
    dismissReplayNotice,
    shareLabel,
  } = useTraceTransfer({
    bookmarks,
    checkpoints,
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

  const canPresent = !embedMode && session.totalSteps > 0;
  // The trace can disappear under presentation (for example a restored
  // workspace without a run); leave rather than present an empty stage.
  if (presentation && !canPresent) setPresentation(null);
  const presenting = presentation !== null && canPresent;
  const togglePresentation = useCallback(() => {
    if (presenting) {
      setPresentation(null);
      return;
    }
    if (!canPresent) return;
    setPresentation({
      ...PRESENTATION_PANEL_VISIBILITY,
      // Output stays on stage only for programs that print.
      console: Boolean(session.result?.run?.stdout),
    });
    if (mobileTab === 'Inputs') setMobileTab('Code');
  }, [canPresent, mobileTab, presenting, session.result, setMobileTab]);
  // The toggle is unmounted while presenting; return focus to it afterwards.
  const wasPresenting = useRef(false);
  useEffect(() => {
    if (wasPresenting.current && !presenting) presentButtonRef.current?.focus();
    wasPresenting.current = presenting;
  }, [presenting]);

  const orderedCheckpoints = useMemo(
    () => checkpointCaptions(checkpoints, bookmarks),
    [bookmarks, checkpoints],
  );
  const checkpointNav = useMemo(
    () => checkpointNavigation(checkpoints, session.step),
    [checkpoints, session.step],
  );
  const jumpToCheckpoint = useCallback(
    (index: number | null) => {
      if (index !== null) jumpToStep(checkpoints[index]);
    },
    [checkpoints, jumpToStep],
  );
  // While presenting, playback pauses on arriving at a checkpoint so its
  // caption can be read; pressing Play again continues from there.
  const playbackOrigin = useRef<number | null>(null);
  useEffect(() => {
    if (!playing) {
      playbackOrigin.current = null;
      return;
    }
    if (playbackOrigin.current === null) {
      playbackOrigin.current = session.step;
      return;
    }
    if (
      presenting &&
      !openCheckpoint &&
      session.step !== playbackOrigin.current &&
      checkpoints.includes(session.step)
    ) {
      togglePlay();
    }
  }, [checkpoints, openCheckpoint, playing, presenting, session.step, togglePlay]);

  const presentationShortcut = useMemo(
    () => (embedMode ? undefined : { active: presenting, toggle: togglePresentation }),
    [embedMode, presenting, togglePresentation],
  );
  useTransportShortcuts({
    jumpToStep,
    run: session.run,
    stepBack: session.stepBack,
    stepForward: session.stepForward,
    togglePlay: session.togglePlay,
    totalSteps: session.totalSteps,
    toggleBookmark: () => toggleBookmark(session.step),
    openSearch: () => setFinderRequest((request) => request + 1),
    presentation: presentationShortcut,
    previousCheckpoint: () => jumpToCheckpoint(checkpointNav.previous),
    nextCheckpoint: () => jumpToCheckpoint(checkpointNav.next),
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
      if (!session.workspaceManaged) {
        setWatchedVariables([]);
        resetTraceNavigation();
      }
      setCode(code);
    },
    [
      clearHistoryItemId,
      queueDraft,
      resetTraceNavigation,
      session.language,
      session.workspaceManaged,
      setCode,
    ],
  );

  const handleExampleChange = useCallback(
    (id: string) => {
      flushDraft();
      if (id === CUSTOM_CODE_ID) {
        const draft = loadStoredCodeDraft();
        if (!draft || !replaceWorkspace()) {
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
      if (!example || !replaceWorkspace()) {
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
    [
      clearHistoryItemId,
      flushDraft,
      replaceWorkspace,
      resetTraceNavigation,
      session,
      setCode,
      setLanguage,
    ],
  );

  const handleLanguageChange = useCallback(
    (nextLanguage: Language) => {
      if (!replaceWorkspace()) return;
      flushDraft();
      if (userEditedRef.current) queueDraft(session.code, nextLanguage);
      clearHistoryItemId();
      setExampleId(null);
      setWatchedVariables([]);
      resetTraceNavigation();
      setLanguage(nextLanguage);
    },
    [
      clearHistoryItemId,
      flushDraft,
      queueDraft,
      resetTraceNavigation,
      replaceWorkspace,
      session.code,
      setLanguage,
    ],
  );

  const handleOpenHistoryItem = useCallback(
    (item: CodeHistoryItem) => {
      if (!replaceWorkspace()) return;
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
    [flushDraft, replaceWorkspace, resetTraceNavigation, session, setHistoryItemId],
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
  const stepChange = useMemo(
    () => describeStepChange(session.steps, session.step, run?.stdout ?? ''),
    [session.steps, session.step, run],
  );
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

  // Phones show every panel behind tabs, except while presenting.
  const visiblePanels =
    mobile && !presenting
      ? Object.fromEntries(Object.keys(panelVisibility).map((key) => [key, true]))
      : panelVisibility;
  const readOnlyCode = embedMode || presenting;

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
              onChange={readOnlyCode ? () => {} : handleCodeChange}
              onCursorLineChange={setCursorLine}
              onRunToLine={readOnlyCode ? undefined : runToLine}
              onToggleBreakpoint={readOnlyCode ? undefined : toggleBreakpoint}
              focusRequest={editorFocus}
              ranLine={stepChange?.line ?? null}
              readOnly={readOnlyCode}
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
              sourceLine={
                stepChange?.line ? (session.code.split('\n')[stepChange.line - 1] ?? null) : null
              }
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
              change={stepChange}
              code={session.code}
              currentStep={session.currentStep}
              frameIndex={session.selectedFrameIndex}
              lessonCard={
                // Lesson predictions take typed answers, so they stay off stage.
                lesson && !presenting ? (
                  <LessonCard
                    answers={lessonAnswers}
                    checkpoints={lessonCheckpoints}
                    lesson={lesson}
                    onAnswer={answerCheckpoint}
                    onJump={session.jumpToStep}
                    step={session.step}
                  />
                ) : null
              }
              onFocusLine={focusEditorLine}
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
              change={stepChange}
              available={capabilities.ai}
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
              language={session.language}
              atLastStep={atLastStep}
              canMeasureComplexity={
                session.language === 'python' && showInputs && !session.isBusy && !presenting
              }
              complexity={session.complexity}
              complexityBusy={session.complexityBusy}
              currentStep={session.currentStep}
              onMeasureComplexity={() => void session.measureComplexity()}
              result={session.result}
              headerAction={
                // Phones always show Compare runs under Inspect, which has its own button.
                embedMode || mobile ? undefined : (
                  <button
                    className="panel-header-action"
                    disabled={!canKeepBaseline || session.isBusy}
                    onClick={keepRunAsBaseline}
                    title="Keep this run to compare with the next one"
                    type="button"
                  >
                    <GitCompare size={12} />
                    {baseline && baseline.result === session.result
                      ? 'Kept as baseline'
                      : 'Keep as baseline'}
                  </button>
                )
              }
            />
          </ErrorBoundary>,
        )
      : null,
    visiblePanels.compare && !embedMode
      ? panelSlot(
          'compare',
          <ErrorBoundary
            className="compare-panel"
            resetKeys={[session.result, baseline]}
            title="Compare runs"
          >
            {mobile && mobileTab !== 'Inspect' ? null : (
              <Suspense
                fallback={
                  <section className="panel compare-panel" aria-label="Compare runs">
                    <p className="panel-empty">Loading the comparison…</p>
                  </section>
                }
              >
                <RunComparisonPanel
                  baseline={baseline}
                  code={session.code}
                  isBusy={session.isBusy}
                  language={session.language}
                  onClearBaseline={clearBaseline}
                  onJump={session.jumpToStep}
                  onKeepBaseline={keepRunAsBaseline}
                  result={session.result}
                  step={session.step}
                />
              </Suspense>
            )}
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
          {!mobile && !presenting && index < slots.length - 1 ? (
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
      className={`app-shell dashboard-instrument${embedMode ? ' app-shell-embed' : ''}${mobile ? ' mobile-workspace' : ''}${presenting ? ' presentation-mode' : ''}`}
    >
      <section className="dashboard-stage" aria-label="Code Visualizer dashboard">
        {presenting ? (
          <PresentationBar
            checkpoints={orderedCheckpoints}
            navigation={checkpointNav}
            onExit={togglePresentation}
            onJump={jumpToStep}
            onToggleTheme={toggleTheme}
            theme={theme}
          />
        ) : embedMode ? (
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
            workspaceLibrary={<WorkspaceLibrary library={library} disabled={session.isBusy} />}
            showAccount={capabilities.accounts}
            showHistory={capabilities.history}
            storageControls={
              <>
                <strong className="workspace-menu-heading">Saving and privacy</strong>
                {capabilities.history ? (
                  <>
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
                ) : (
                  <p className="account-note">
                    This deployment has no accounts or AI service. Code, cases and workspaces stay
                    in this browser.
                  </p>
                )}
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
            onExportReplay={() => void handleExportReplay()}
            onExportSvg={handleExportSvg}
            onImport={handleImport}
            onPresent={togglePresentation}
            canPresent={canPresent}
            presentButtonRef={presentButtonRef}
            onOpenHistoryItem={handleOpenHistoryItem}
            onLanguageChange={handleLanguageChange}
            onOpenLanding={() => {
              if (!activeWorkspace || confirmWorkspaceReplace()) onOpenLanding();
            }}
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
          !presenting &&
          (draftStatus !== 'idle' ||
            library.autosave ||
            (historySyncEnabled && historySaveStatus !== 'idle')) && (
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
              {library.autosave && (
                <div className="save-status" role={library.autosave.alert ? 'alert' : 'status'}>
                  <span>{library.autosave.text}</span>
                  {library.autosave.retry && (
                    <button type="button" onClick={() => void library.retryAutosave()}>
                      Retry autosave
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
        {importError && !presenting ? (
          <div className="dashboard-onboarding" role="alert">
            <span>Import failed: {importError}</span>
            <button type="button" onClick={dismissImportError}>
              Dismiss
            </button>
          </div>
        ) : null}
        {replayNotice && !presenting ? (
          <div className="dashboard-onboarding" role={replayNotice.error ? 'alert' : 'status'}>
            <span>{replayNotice.text}</span>
            <button type="button" onClick={dismissReplayNotice}>
              Dismiss
            </button>
          </div>
        ) : null}

        {!embedMode && !mobile && !presenting && showDashboardOnboarding ? (
          <DashboardOnboardingBar onDismiss={dismissDashboardOnboarding} />
        ) : null}

        {mobile && (
          <MobileWorkspaceTabs
            active={mobileTab}
            onChange={setMobileTab}
            tabs={presenting ? PRESENTATION_MOBILE_TABS : undefined}
          />
        )}
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
        {mobile && openCheckpoint && !presenting && mobileTab !== 'Inspect' ? (
          <button
            className="mobile-lesson-prompt"
            onClick={() => setMobileTab('Inspect')}
            type="button"
          >
            Lesson checkpoint: make your prediction in Inspect
          </button>
        ) : null}

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
                {!mobile && !presenting && index < visibleColumns.length - 1 ? (
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
          bookmarkSteps={presenting ? checkpoints : bookmarks.map((bookmark) => bookmark.step)}
          presenting={presenting}
          traceTools={
            presenting ? undefined : (
              <TraceFinder
                bookmarks={bookmarks}
                checkpoints={checkpoints}
                onBookmarkNote={setBookmarkNote}
                onJump={session.jumpToStep}
                onMoveCheckpoint={moveCheckpointStep}
                onToggleBookmark={toggleBookmark}
                onToggleCheckpoint={toggleCheckpointStep}
                openRequest={finderRequest}
                step={session.step}
                steps={session.steps}
                stdout={run?.stdout ?? ''}
              />
            )
          }
        />
      </section>
    </div>
  );
}
