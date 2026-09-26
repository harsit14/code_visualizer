/**
 * Session state and runtime orchestration for the dashboard.
 *
 * Owns: code, analysis, the latest run result, playback position, input
 * overrides, complexity samples, and all calls into the Pyodide worker.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { runJavaScriptInWorker } from '../engine/jsRuntimeClient';
import { clearPythonRuntimeStatusHandler, getPythonRuntimeClient } from '../engine/pythonRuntime';
import { TimeoutError, type RuntimeClient } from '../engine/runtimeClient';
import { firstExceptionStep } from '../engine/trace';
import {
  buildPracticeCaseStorageKey,
  loadStoredPracticeCases,
  saveStoredPracticeCases,
} from './practiceCaseStorage';
import {
  EMPTY_PRACTICE_NOTEBOOK,
  buildPracticeNotebookStorageKey,
  loadStoredPracticeNotebook,
  saveStoredPracticeNotebook,
  type PracticeNotebook,
  type PracticeNotebookUpdate,
} from './practiceNotebook';
import {
  createEdgePracticeCases,
  createPracticeTestCase,
  summarizePracticeRun,
  type PracticeTestCase,
  type PracticeTestCaseUpdate,
} from './practiceCases';
import { useSessionPlayback, type PlaybackSpeed } from './useSessionPlayback';
import type { WorkspaceContent } from './workspaceFormat';
import type {
  AnalysisInfo,
  ComplexityOptions,
  ComplexityResult,
  FunctionInfo,
  Language,
  RuntimeStatus,
  SessionResult,
} from '../engine/types';

const RUN_TIMEOUT_MS = 15000;
const ANALYZE_DEBOUNCE_MS = 700;

export type { PlaybackSpeed };

export type Session = ReturnType<typeof useSession>;

type InitialSessionOptions = {
  language?: Language;
  functionName?: string;
  inputs?: string[];
  seed?: number;
};

type LoadSourceOptions = {
  functionName?: string | null;
  inputs?: string[] | null;
  language: Language;
  seed?: number | null;
};

function scriptAnalysis(): AnalysisInfo {
  return {
    mode: 'script',
    functions: [],
    defaultFunction: null,
    definesTreeNode: false,
    definesListNode: false,
    referencesTreeNode: false,
    referencesListNode: false,
    diagnostics: [],
  };
}

function idleStatus(language: Language): RuntimeStatus {
  return {
    phase: 'idle',
    message:
      language === 'python'
        ? 'Preparing Python in the background'
        : `${language === 'typescript' ? 'TypeScript' : 'JavaScript'} runs in a browser worker`,
    interruptSupported: false,
    progress: 0,
    stage: 'idle',
  };
}

function timeoutResult(message: string): SessionResult {
  return {
    status: 'timeout',
    mode: 'empty',
    analysis: null,
    run: null,
    error: { type: 'ExecutionTimeout', msg: message },
    durationMs: 0,
  };
}

function hasPracticeNotebookContent(notebook: PracticeNotebook): boolean {
  return (
    notebook.notes.trim().length > 0 ||
    notebook.patterns.trim().length > 0 ||
    notebook.status !== 'new'
  );
}

export function useSession(initialCode: string, initialOptions: InitialSessionOptions = {}) {
  const [workspaceManaged, setWorkspaceManaged] = useState(false);
  const enableWorkspacePersistence = useCallback(() => setWorkspaceManaged(true), []);
  const [code, setCodeState] = useState(initialCode);
  const [language, setLanguageState] = useState<Language>(initialOptions.language ?? 'python');
  const [status, setStatus] = useState<RuntimeStatus>(
    idleStatus(initialOptions.language ?? 'python'),
  );
  const [analysis, setAnalysis] = useState<AnalysisInfo | null>(
    initialOptions.language && initialOptions.language !== 'python' ? scriptAnalysis() : null,
  );
  const [result, setResult] = useState<SessionResult | null>(null);
  const [complexity, setComplexity] = useState<ComplexityResult | null>(null);
  const [complexityBusy, setComplexityBusy] = useState(false);
  const [functionOverride, setFunctionOverrideState] = useState<string | null>(
    initialOptions.functionName ?? null,
  );
  const [inputDrafts, setInputDrafts] = useState<Record<string, string> | null>(null);
  const [practiceNotebook, setPracticeNotebook] =
    useState<PracticeNotebook>(EMPTY_PRACTICE_NOTEBOOK);
  const [testCases, setTestCases] = useState<PracticeTestCase[]>([]);
  const [testCasesBusy, setTestCasesBusy] = useState(false);
  const [pendingInitialInputs, setPendingInitialInputs] = useState<string[] | null>(
    initialOptions.inputs ?? null,
  );
  const [seed, setSeed] = useState<number | null>(
    Number.isFinite(initialOptions.seed) ? (initialOptions.seed ?? null) : null,
  );

  const revisionRef = useRef(0);
  const stoppedRevisionRef = useRef(-1);
  const jsAbortRef = useRef<AbortController | null>(null);
  const operationPendingRef = useRef(false);
  const mountedRef = useRef(true);
  const [operationBusy, setOperationBusy] = useState(false);
  const clientRef = useRef<RuntimeClient | null>(null);
  const analyzeTimer = useRef<number | null>(null);
  const analyzeSerial = useRef(0);
  const codeRef = useRef(initialCode);
  const languageRef = useRef<Language>(initialOptions.language ?? 'python');
  const activeFunctionRef = useRef<FunctionInfo | null>(null);
  const inputLiteralsRef = useRef<string[] | undefined>(undefined);
  // `undefined` means the source-keyed storage has not been synced for any key yet.
  const practiceCasesStorageKeyRef = useRef<string | null | undefined>(null);
  const skipPracticeCaseSaveRef = useRef(false);
  const preservePracticeCasesOnNextKeyRef = useRef(false);
  const practiceNotebookStorageKeyRef = useRef<string | null | undefined>(null);
  const skipPracticeNotebookSaveRef = useRef(false);
  const preservePracticeNotebookOnNextKeyRef = useRef(false);

  const getClient = useCallback(() => {
    const handleStatus = (next: RuntimeStatus) => {
      if (mountedRef.current && languageRef.current === 'python') setStatus(next);
    };
    if (!clientRef.current) {
      clientRef.current = getPythonRuntimeClient(handleStatus);
    } else {
      clientRef.current.setStatusHandler(handleStatus, true);
    }
    return clientRef.current;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      revisionRef.current += 1;
      if (analyzeTimer.current) window.clearTimeout(analyzeTimer.current);
      clientRef.current?.cancel();
      jsAbortRef.current?.abort();
      clearPythonRuntimeStatusHandler(clientRef.current);
    };
  }, []);

  useEffect(() => {
    if (language === 'python') {
      getClient().prewarm();
    }
  }, [getClient, language]);

  const isBusy =
    status.phase === 'loading' ||
    status.phase === 'running' ||
    status.phase === 'interrupting' ||
    status.phase === 'restarting' ||
    testCasesBusy ||
    operationBusy ||
    complexityBusy;

  const steps = result?.run?.steps ?? [];
  const totalSteps = steps.length;
  const {
    jumpToStep,
    playing,
    resetPlayback,
    selectedFrameIndex,
    setPlaying,
    setSelectedFrameIndex,
    setSpeed,
    setStep,
    speed,
    step,
    stepBack,
    stepForward,
    togglePlay,
  } = useSessionPlayback(totalSteps);
  const currentStep = steps[step];

  /** Re-analyze (debounced) so the inputs panel reflects edits before a run. */
  const scheduleAnalyze = useCallback(
    (source: string, nextLanguage = languageRef.current) => {
      if (analyzeTimer.current) {
        window.clearTimeout(analyzeTimer.current);
      }
      if (nextLanguage !== 'python') {
        analyzeSerial.current += 1;
        setAnalysis(scriptAnalysis());
        return;
      }
      const serial = ++analyzeSerial.current;
      analyzeTimer.current = window.setTimeout(() => {
        analyzeTimer.current = null;
        const client = getClient();
        client
          .request({ op: 'analyze', source })
          .then((data) => {
            const payload = data as { analysis?: AnalysisInfo };
            if (
              mountedRef.current &&
              payload.analysis &&
              serial === analyzeSerial.current &&
              source === codeRef.current &&
              languageRef.current === 'python'
            ) {
              setAnalysis(payload.analysis);
            }
          })
          .catch(() => {
            /* busy or worker booting — the next edit or run will refresh it */
          });
      }, ANALYZE_DEBOUNCE_MS);
    },
    [getClient],
  );

  const setCode = useCallback(
    (nextCode: string) => {
      revisionRef.current += 1;
      codeRef.current = nextCode;
      setCodeState(nextCode);
      setTestCases((current) =>
        current.map((testCase) => ({
          ...testCase,
          status: 'idle',
          actual: null,
          actualLiteral: null,
          error: null,
          runtimeMs: null,
          memoryMb: null,
        })),
      );
      setResult(null);
      setComplexity(null);
      resetPlayback();
      const currentFunction = activeFunctionRef.current;
      const currentLiterals = inputLiteralsRef.current;
      if (currentFunction && currentLiterals) {
        setInputDrafts(
          Object.fromEntries(
            currentFunction.params.map((param, index) => [
              param.name,
              currentLiterals[index] ?? '',
            ]),
          ),
        );
      }
      preservePracticeCasesOnNextKeyRef.current = true;
      preservePracticeNotebookOnNextKeyRef.current = true;
      setPendingInitialInputs(null);
      scheduleAnalyze(nextCode);
    },
    [resetPlayback, scheduleAnalyze],
  );

  const setLanguage = useCallback(
    (nextLanguage: Language) => {
      revisionRef.current += 1;
      languageRef.current = nextLanguage;
      setLanguageState(nextLanguage);
      setStatus(idleStatus(nextLanguage));
      setResult(null);
      setComplexity(null);
      resetPlayback();
      setFunctionOverrideState(null);
      setInputDrafts(null);
      setPracticeNotebook(EMPTY_PRACTICE_NOTEBOOK);
      setTestCases([]);
      setPendingInitialInputs(null);
      scheduleAnalyze(codeRef.current, nextLanguage);
    },
    [resetPlayback, scheduleAnalyze],
  );

  const loadSource = useCallback(
    (nextCode: string, options: LoadSourceOptions) => {
      if (analyzeTimer.current) {
        window.clearTimeout(analyzeTimer.current);
        analyzeTimer.current = null;
      }
      revisionRef.current += 1;
      codeRef.current = nextCode;
      languageRef.current = options.language;
      analyzeSerial.current += 1;
      setCodeState(nextCode);
      setLanguageState(options.language);
      setStatus(idleStatus(options.language));
      setResult(null);
      setComplexity(null);
      resetPlayback();
      setFunctionOverrideState(
        options.language === 'python' ? (options.functionName ?? null) : null,
      );
      setInputDrafts(null);
      setPracticeNotebook(EMPTY_PRACTICE_NOTEBOOK);
      setTestCases([]);
      setPendingInitialInputs(options.language === 'python' ? (options.inputs ?? null) : null);
      setSeed(options.language === 'python' ? (options.seed ?? null) : null);
      scheduleAnalyze(nextCode, options.language);
    },
    [resetPlayback, scheduleAnalyze],
  );

  const activeFunction = useMemo(() => {
    const name = functionOverride ?? analysis?.defaultFunction ?? null;
    return analysis?.functions.find((fn) => fn.qualname === name) ?? null;
  }, [analysis, functionOverride]);
  activeFunctionRef.current = activeFunction;

  const practiceCasesStorageKey = useMemo(() => {
    if (language !== 'python' || !activeFunction) {
      return null;
    }
    return buildPracticeCaseStorageKey(code, activeFunction.qualname);
  }, [activeFunction, code, language]);

  const practiceNotebookStorageKey = useMemo(() => {
    if (language !== 'python' || !activeFunction) {
      return null;
    }
    return buildPracticeNotebookStorageKey(code, activeFunction.qualname);
  }, [activeFunction, code, language]);

  useEffect(() => {
    if (workspaceManaged) return;
    if (practiceCasesStorageKey === practiceCasesStorageKeyRef.current) {
      return;
    }
    const shouldPreserveCases =
      preservePracticeCasesOnNextKeyRef.current &&
      !!activeFunction &&
      testCases.length > 0 &&
      testCases.every((testCase) => testCase.inputs.length === activeFunction.params.length);
    preservePracticeCasesOnNextKeyRef.current = false;
    practiceCasesStorageKeyRef.current = practiceCasesStorageKey;
    skipPracticeCaseSaveRef.current = !shouldPreserveCases;
    if (!practiceCasesStorageKey || !activeFunction) {
      if (!shouldPreserveCases) {
        setTestCases([]);
      }
      return;
    }
    if (shouldPreserveCases) {
      return;
    }
    setTestCases(loadStoredPracticeCases(practiceCasesStorageKey, activeFunction.params.length));
  }, [activeFunction, practiceCasesStorageKey, testCases, workspaceManaged]);

  useEffect(() => {
    if (workspaceManaged) return;
    if (!practiceCasesStorageKey) {
      return;
    }
    if (skipPracticeCaseSaveRef.current) {
      skipPracticeCaseSaveRef.current = false;
      return;
    }
    saveStoredPracticeCases(practiceCasesStorageKey, testCases);
  }, [practiceCasesStorageKey, testCases, workspaceManaged]);

  useEffect(() => {
    if (workspaceManaged) return;
    if (practiceNotebookStorageKey === practiceNotebookStorageKeyRef.current) {
      return;
    }
    const shouldPreserveNotebook =
      preservePracticeNotebookOnNextKeyRef.current && hasPracticeNotebookContent(practiceNotebook);
    preservePracticeNotebookOnNextKeyRef.current = false;
    practiceNotebookStorageKeyRef.current = practiceNotebookStorageKey;
    skipPracticeNotebookSaveRef.current = !shouldPreserveNotebook;
    if (!practiceNotebookStorageKey) {
      if (!shouldPreserveNotebook) {
        setPracticeNotebook(EMPTY_PRACTICE_NOTEBOOK);
      }
      return;
    }
    if (shouldPreserveNotebook) {
      return;
    }
    setPracticeNotebook(loadStoredPracticeNotebook(practiceNotebookStorageKey));
  }, [practiceNotebook, practiceNotebookStorageKey, workspaceManaged]);

  useEffect(() => {
    if (workspaceManaged) return;
    if (!practiceNotebookStorageKey) {
      return;
    }
    if (skipPracticeNotebookSaveRef.current) {
      skipPracticeNotebookSaveRef.current = false;
      return;
    }
    saveStoredPracticeNotebook(practiceNotebookStorageKey, practiceNotebook);
  }, [practiceNotebook, practiceNotebookStorageKey, workspaceManaged]);

  useEffect(() => {
    if (!activeFunction || !pendingInitialInputs) {
      return;
    }
    if (pendingInitialInputs.length === activeFunction.params.length) {
      setInputDrafts(
        Object.fromEntries(
          activeFunction.params.map((param, index) => [param.name, pendingInitialInputs[index]]),
        ),
      );
    }
    setPendingInitialInputs(null);
  }, [activeFunction, pendingInitialInputs]);

  /** Literals to send: drafts override the last run's generated inputs. */
  const inputLiterals = useMemo(() => {
    if (!activeFunction) {
      return undefined;
    }
    const lastInputs = result?.run?.inputs;
    const literals = activeFunction.params.map((param, index) => {
      const draft = inputDrafts?.[param.name];
      if (draft !== undefined) {
        return draft;
      }
      const last = lastInputs?.[index];
      return last && lastInputs?.length === activeFunction.params.length && last.name === param.name
        ? last.literal
        : null;
    });
    return literals.every((literal) => literal !== null) ? (literals as string[]) : undefined;
  }, [activeFunction, inputDrafts, result]);
  inputLiteralsRef.current = inputLiterals;

  const setFunctionOverride = useCallback(
    (nextFunction: string | null) => {
      revisionRef.current += 1;
      setFunctionOverrideState(nextFunction);
      setResult(null);
      setComplexity(null);
      resetPlayback();
      setInputDrafts(null);
      setPracticeNotebook(EMPTY_PRACTICE_NOTEBOOK);
      setTestCases([]);
      setPendingInitialInputs(null);
    },
    [resetPlayback],
  );

  const run = useCallback(
    async (overrides?: { freshInputs?: boolean; inputs?: string[]; seed?: number }) => {
      if (isBusy || testCasesBusy || operationPendingRef.current) {
        return;
      }
      if (analyzeTimer.current) {
        window.clearTimeout(analyzeTimer.current);
        analyzeTimer.current = null;
      }
      const revision = revisionRef.current;
      const runLanguage = languageRef.current;
      const isCurrent = () => mountedRef.current && revisionRef.current === revision;
      operationPendingRef.current = true;
      setOperationBusy(true);
      analyzeSerial.current += 1;
      setResult(null);
      setComplexity(null);
      resetPlayback();

      const useSeed = overrides?.seed ?? seed ?? undefined;
      const useInputs = overrides?.inputs ?? (overrides?.freshInputs ? undefined : inputLiterals);

      try {
        let data: SessionResult;
        if (runLanguage === 'python') {
          data = (await getClient().request(
            {
              op: 'run',
              source: code,
              options: {
                function: functionOverride ?? undefined,
                inputs: useInputs,
                seed: useSeed,
              },
            },
            { timeoutMs: RUN_TIMEOUT_MS },
          )) as SessionResult;
        } else {
          setStatus({
            phase: 'running',
            message: `Generating ${languageRef.current === 'typescript' ? 'TypeScript' : 'JavaScript'} trace...`,
            interruptSupported: false,
            progress: 0.74,
            stage: 'trace-generating',
          });
          const controller = new AbortController();
          jsAbortRef.current = controller;
          data = await runJavaScriptInWorker(code, runLanguage, RUN_TIMEOUT_MS, controller.signal);
          if (!isCurrent()) return;
          setStatus({
            phase: 'ready',
            message: 'Ready',
            interruptSupported: false,
            progress: 1,
            stage: 'ready',
          });
        }

        if (!isCurrent()) return;
        setResult(data);
        if (data.analysis) {
          setAnalysis(data.analysis);
        }
        if (languageRef.current === 'python' && data.run?.seed != null) {
          setSeed(data.run.seed);
        }
        if (overrides?.freshInputs) {
          setInputDrafts(null);
          setPendingInitialInputs(null);
        }

        const runSteps = data.run?.steps ?? [];
        const failure = firstExceptionStep(runSteps);
        if (failure >= 0) {
          setStep(failure);
        } else {
          setStep(0);
          setPlaying(runSteps.length > 1);
        }
      } catch (error) {
        if (!isCurrent()) return;
        if (languageRef.current !== 'python') {
          setStatus(idleStatus(languageRef.current));
        }
        if (error instanceof TimeoutError) {
          setResult(timeoutResult(error.message));
        } else {
          setResult({
            status: 'error',
            mode: 'empty',
            analysis: null,
            run: null,
            error: {
              type: error instanceof Error ? error.name : 'ClientError',
              msg: error instanceof Error ? error.message : String(error),
            },
            durationMs: 0,
          });
        }
      } finally {
        operationPendingRef.current = false;
        if (mountedRef.current) {
          jsAbortRef.current = null;
          setOperationBusy(false);
          if (!isCurrent() && stoppedRevisionRef.current !== revisionRef.current) {
            setStatus(idleStatus(languageRef.current));
            scheduleAnalyze(codeRef.current, languageRef.current);
          }
        }
      }
    },
    [
      code,
      functionOverride,
      getClient,
      inputLiterals,
      isBusy,
      resetPlayback,
      scheduleAnalyze,
      seed,
      setPlaying,
      setStep,
      testCasesBusy,
    ],
  );

  const stopExecution = useCallback(() => {
    revisionRef.current += 1;
    stoppedRevisionRef.current = revisionRef.current;
    analyzeSerial.current += 1;
    if (analyzeTimer.current) window.clearTimeout(analyzeTimer.current);
    analyzeTimer.current = null;
    setPlaying(false);
    clientRef.current?.cancel();
    jsAbortRef.current?.abort();
    setStatus({
      phase: 'idle',
      stage: 'idle',
      interruptSupported: false,
      message: 'Stopped. Run when you’re ready.',
    });
  }, [setPlaying]);

  const retryRuntime = useCallback(() => {
    if (operationPendingRef.current || languageRef.current !== 'python') return;
    getClient().retry();
    scheduleAnalyze(codeRef.current, languageRef.current);
  }, [getClient, scheduleAnalyze]);

  const regenerateInputs = useCallback(() => {
    const freshSeed = Math.floor(Math.random() * 1_000_000);
    setSeed(freshSeed);
    setInputDrafts(null);
    void run({ freshInputs: true, seed: freshSeed });
  }, [run]);

  const addTestCase = useCallback(() => {
    if (!activeFunction) {
      return;
    }
    setTestCases((current) => [
      ...current,
      createPracticeTestCase(activeFunction, inputLiterals, current.length),
    ]);
  }, [activeFunction, inputLiterals]);

  const addEdgeTestCases = useCallback(() => {
    if (!activeFunction) {
      return;
    }
    setTestCases((current) => [
      ...current,
      ...createEdgePracticeCases(activeFunction, current.length),
    ]);
  }, [activeFunction]);

  const updateTestCase = useCallback((id: string, patch: PracticeTestCaseUpdate) => {
    const shouldResetResult = patch.inputs !== undefined || patch.expected !== undefined;
    setTestCases((current) =>
      current.map((testCase) =>
        testCase.id === id
          ? {
              ...testCase,
              ...patch,
              ...(shouldResetResult
                ? {
                    actual: null,
                    actualLiteral: null,
                    error: null,
                    memoryMb: null,
                    runtimeMs: null,
                    status: 'idle' as const,
                  }
                : null),
            }
          : testCase,
      ),
    );
  }, []);

  const removeTestCase = useCallback((id: string) => {
    setTestCases((current) => current.filter((testCase) => testCase.id !== id));
  }, []);

  const acceptTestCaseActual = useCallback((id: string) => {
    setTestCases((current) =>
      current.map((testCase) =>
        testCase.id === id && typeof testCase.actualLiteral === 'string' && !testCase.error
          ? {
              ...testCase,
              expected: testCase.actualLiteral!,
              status: 'idle' as const,
            }
          : testCase,
      ),
    );
  }, []);

  const updatePracticeNotebook = useCallback((patch: PracticeNotebookUpdate) => {
    setPracticeNotebook((current) => ({
      ...current,
      ...patch,
      updatedAt: Date.now(),
    }));
  }, []);

  const traceTestCase = useCallback(
    (id: string) => {
      const testCase = testCases.find((candidate) => candidate.id === id);
      if (!testCase || !activeFunction) {
        return;
      }
      setInputDrafts(
        Object.fromEntries(
          activeFunction.params.map((param, index) => [param.name, testCase.inputs[index] ?? '']),
        ),
      );
      void run({ inputs: testCase.inputs });
    },
    [activeFunction, run, testCases],
  );

  const runPracticeCaseBatch = useCallback(
    async (casesToRun: readonly PracticeTestCase[]) => {
      if (
        languageRef.current !== 'python' ||
        isBusy ||
        operationPendingRef.current ||
        testCasesBusy ||
        !activeFunction ||
        casesToRun.length === 0
      ) {
        return;
      }
      if (analyzeTimer.current) {
        window.clearTimeout(analyzeTimer.current);
        analyzeTimer.current = null;
      }

      const revision = revisionRef.current;
      const isCurrent = () => mountedRef.current && revisionRef.current === revision;
      operationPendingRef.current = true;
      setTestCasesBusy(true);
      try {
        for (const testCase of casesToRun) {
          if (!isCurrent()) break;
          setTestCases((current) =>
            current.map((candidate) =>
              candidate.id === testCase.id
                ? { ...candidate, error: null, status: 'running' }
                : candidate,
            ),
          );

          try {
            const data = (await getClient().request(
              {
                op: 'run',
                source: code,
                options: {
                  function: functionOverride ?? undefined,
                  inputs: testCase.inputs,
                  expected: testCase.expected,
                  seed: seed ?? undefined,
                },
              },
              { timeoutMs: RUN_TIMEOUT_MS },
            )) as SessionResult;
            if (!isCurrent()) break;
            const summary = summarizePracticeRun(data, testCase.expected);
            setTestCases((current) =>
              current.map((candidate) =>
                candidate.id === testCase.id &&
                candidate.expected === testCase.expected &&
                JSON.stringify(candidate.inputs) === JSON.stringify(testCase.inputs)
                  ? { ...candidate, ...summary }
                  : candidate,
              ),
            );
          } catch (error) {
            if (!isCurrent()) break;
            const message =
              error instanceof Error ? error.message : 'Could not run this test case.';
            setTestCases((current) =>
              current.map((candidate) =>
                candidate.id === testCase.id &&
                candidate.expected === testCase.expected &&
                JSON.stringify(candidate.inputs) === JSON.stringify(testCase.inputs)
                  ? {
                      ...candidate,
                      actual: null,
                      actualLiteral: null,
                      error: message,
                      memoryMb: null,
                      runtimeMs: null,
                      status: 'error',
                    }
                  : candidate,
              ),
            );
          }
        }
      } finally {
        operationPendingRef.current = false;
        if (mountedRef.current) {
          setTestCasesBusy(false);
          setTestCases((current) =>
            current.map((item) => (item.status === 'running' ? { ...item, status: 'idle' } : item)),
          );
          if (!isCurrent() && stoppedRevisionRef.current !== revisionRef.current)
            scheduleAnalyze(codeRef.current, languageRef.current);
        }
      }
    },
    [
      activeFunction,
      code,
      functionOverride,
      getClient,
      isBusy,
      seed,
      scheduleAnalyze,
      testCasesBusy,
    ],
  );

  const runTestCases = useCallback(async () => {
    await runPracticeCaseBatch(testCases);
  }, [runPracticeCaseBatch, testCases]);

  const runFailedTestCases = useCallback(async () => {
    await runPracticeCaseBatch(
      testCases.filter(
        (testCase) =>
          testCase.status === 'fail' ||
          testCase.status === 'error' ||
          testCase.status === 'inconclusive',
      ),
    );
  }, [runPracticeCaseBatch, testCases]);

  const measureComplexity = useCallback(
    async (options: ComplexityOptions = {}) => {
      if (
        languageRef.current !== 'python' ||
        isBusy ||
        complexityBusy ||
        operationPendingRef.current
      ) {
        return;
      }
      const revision = revisionRef.current;
      const isCurrent = () => mountedRef.current && revisionRef.current === revision;
      operationPendingRef.current = true;
      setComplexityBusy(true);
      try {
        const data = (await getClient().request(
          {
            op: 'complexity',
            source: code,
            function: functionOverride ?? undefined,
            seed: seed ?? undefined,
            ...options,
          },
          { timeoutMs: RUN_TIMEOUT_MS * 2 },
        )) as ComplexityResult;
        if (isCurrent()) setComplexity(data);
      } catch (error) {
        if (!isCurrent()) return;
        setComplexity({
          functionName: null,
          seed: null,
          samples: [],
          error: {
            type: error instanceof Error ? error.name : 'ClientError',
            msg: error instanceof Error ? error.message : String(error),
          },
        });
      } finally {
        operationPendingRef.current = false;
        if (mountedRef.current) {
          setComplexityBusy(false);
          if (!isCurrent() && stoppedRevisionRef.current !== revisionRef.current)
            scheduleAnalyze(codeRef.current, languageRef.current);
        }
      }
    },
    [code, complexityBusy, functionOverride, getClient, isBusy, scheduleAnalyze, seed],
  );

  /** Restore an exported session (replay without re-running). */
  const importSession = useCallback(
    (
      importedCode: string,
      imported: SessionResult,
      importedStep = 0,
      importedLanguage: Language = 'python',
    ) => {
      if (analyzeTimer.current) {
        // A debounced analyze from a recent edit would overwrite the
        // imported analysis (and e.g. hide the inputs panel) — drop it.
        window.clearTimeout(analyzeTimer.current);
        analyzeTimer.current = null;
      }
      revisionRef.current += 1;
      codeRef.current = importedCode;
      languageRef.current = importedLanguage;
      analyzeSerial.current += 1;
      setCodeState(importedCode);
      setLanguageState(importedLanguage);
      setStatus(idleStatus(importedLanguage));
      setResult(imported);
      setAnalysis(imported.analysis ?? null);
      setComplexity(null);
      const steps = imported.run?.steps.length ?? 0;
      setStep(Math.max(0, Math.min(importedStep, Math.max(steps - 1, 0))));
      setPlaying(false);
      setInputDrafts(null);
      setPendingInitialInputs(null);
      setFunctionOverrideState(
        importedLanguage === 'python' ? (imported.run?.functionName ?? null) : null,
      );
      setSeed(importedLanguage === 'python' ? (imported.run?.seed ?? null) : null);
    },
    [setPlaying, setStep],
  );

  const restoreWorkspace = useCallback(
    (content: WorkspaceContent) => {
      stopExecution();
      setWorkspaceManaged(true);
      if (content.result)
        importSession(content.code, content.result, content.step, content.language);
      else
        loadSource(content.code, {
          language: content.language,
          functionName: content.functionName,
          seed: content.seed,
        });
      setSelectedFrameIndex(null);
      setFunctionOverrideState(content.functionName);
      setInputDrafts(content.inputDrafts);
      setPendingInitialInputs(null);
      setSeed(content.seed);
      setTestCases(content.cases);
      setPracticeNotebook(content.notebook);
    },
    [importSession, loadSource, setSelectedFrameIndex, stopExecution],
  );

  /** Hand practice state back to source-keyed storage after replacing a workspace. */
  const leaveWorkspace = useCallback(() => {
    // Storage keys were not tracked while the workspace owned cases and notes, so
    // resync on the next key instead of saving workspace state over legacy records.
    practiceCasesStorageKeyRef.current = undefined;
    practiceNotebookStorageKeyRef.current = undefined;
    preservePracticeCasesOnNextKeyRef.current = false;
    preservePracticeNotebookOnNextKeyRef.current = false;
    setWorkspaceManaged(false);
  }, []);

  return {
    workspaceManaged,
    enableWorkspacePersistence,
    leaveWorkspace,
    restoreWorkspace,
    stopExecution,
    retryRuntime,
    language,
    setLanguage,
    code,
    setCode,
    status,
    isBusy,
    analysis,
    result,
    steps,
    totalSteps,
    step,
    currentStep,
    jumpToStep,
    stepForward,
    stepBack,
    playing,
    togglePlay,
    speed,
    setSpeed,
    selectedFrameIndex,
    setSelectedFrameIndex,
    activeFunction,
    functionOverride,
    setFunctionOverride,
    inputDrafts,
    inputLiterals,
    setInputDrafts,
    seed,
    setSeed,
    run,
    regenerateInputs,
    testCases,
    testCasesBusy,
    addTestCase,
    addEdgeTestCases,
    updateTestCase,
    removeTestCase,
    acceptTestCaseActual,
    practiceNotebook,
    updatePracticeNotebook,
    runTestCases,
    runFailedTestCases,
    traceTestCase,
    complexity,
    complexityBusy,
    measureComplexity,
    importSession,
    loadSource,
    scheduleAnalyze,
  };
}
