/**
 * Session state and runtime orchestration for the dashboard.
 *
 * Owns: code, analysis, the latest run result, playback position, input
 * overrides, complexity samples, and all calls into the Pyodide worker.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RuntimeClient, TimeoutError } from '../engine/runtimeClient';
import { firstExceptionStep } from '../engine/trace';
import type { AnalysisInfo, ComplexityResult, RuntimeStatus, SessionResult } from '../engine/types';

const RUN_TIMEOUT_MS = 15000;
const ANALYZE_DEBOUNCE_MS = 700;

export type PlaybackSpeed = number; // steps per second

export type Session = ReturnType<typeof useSession>;

type InitialSessionOptions = {
  functionName?: string;
  inputs?: string[];
  seed?: number;
};

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

export function useSession(initialCode: string, initialOptions: InitialSessionOptions = {}) {
  const [code, setCodeState] = useState(initialCode);
  const [status, setStatus] = useState<RuntimeStatus>({
    phase: 'idle',
    message: 'Python loads on first run',
    interruptSupported: false,
  });
  const [analysis, setAnalysis] = useState<AnalysisInfo | null>(null);
  const [result, setResult] = useState<SessionResult | null>(null);
  const [complexity, setComplexity] = useState<ComplexityResult | null>(null);
  const [complexityBusy, setComplexityBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(2);
  const [selectedFrameIndex, setSelectedFrameIndex] = useState<number | null>(null);
  const [functionOverride, setFunctionOverrideState] = useState<string | null>(
    initialOptions.functionName ?? null,
  );
  const [inputDrafts, setInputDrafts] = useState<Record<string, string> | null>(null);
  const [pendingInitialInputs, setPendingInitialInputs] = useState<string[] | null>(
    initialOptions.inputs ?? null,
  );
  const [seed, setSeed] = useState<number | null>(
    Number.isFinite(initialOptions.seed) ? (initialOptions.seed ?? null) : null,
  );

  const clientRef = useRef<RuntimeClient | null>(null);
  const analyzeTimer = useRef<number | null>(null);
  const analyzeSerial = useRef(0);
  const codeRef = useRef(initialCode);

  const getClient = useCallback(() => {
    if (!clientRef.current) {
      clientRef.current = new RuntimeClient({ onStatus: setStatus });
    }
    return clientRef.current;
  }, []);

  useEffect(() => () => clientRef.current?.dispose(), []);

  const isBusy =
    status.phase === 'loading' || status.phase === 'running' || status.phase === 'interrupting';

  const steps = result?.run?.steps ?? [];
  const totalSteps = steps.length;
  const currentStep = steps[step];

  /** Re-analyze (debounced) so the inputs panel reflects edits before a run. */
  const scheduleAnalyze = useCallback(
    (source: string) => {
      if (analyzeTimer.current) {
        window.clearTimeout(analyzeTimer.current);
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
              payload.analysis &&
              serial === analyzeSerial.current &&
              source === codeRef.current
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
      codeRef.current = nextCode;
      setCodeState(nextCode);
      setResult(null);
      setComplexity(null);
      setStep(0);
      setPlaying(false);
      setSelectedFrameIndex(null);
      setFunctionOverrideState(null);
      setInputDrafts(null);
      setPendingInitialInputs(null);
      scheduleAnalyze(nextCode);
    },
    [scheduleAnalyze],
  );

  const activeFunction = useMemo(() => {
    const name = functionOverride ?? analysis?.defaultFunction ?? null;
    return analysis?.functions.find((fn) => fn.qualname === name) ?? null;
  }, [analysis, functionOverride]);

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

  const setFunctionOverride = useCallback((nextFunction: string | null) => {
    setFunctionOverrideState(nextFunction);
    setResult(null);
    setComplexity(null);
    setStep(0);
    setPlaying(false);
    setSelectedFrameIndex(null);
    setInputDrafts(null);
    setPendingInitialInputs(null);
  }, []);

  const run = useCallback(
    async (overrides?: { freshInputs?: boolean; seed?: number }) => {
      if (isBusy) {
        return;
      }
      if (analyzeTimer.current) {
        window.clearTimeout(analyzeTimer.current);
        analyzeTimer.current = null;
      }
      setPlaying(false);
      setResult(null);
      setComplexity(null);
      setStep(0);
      setSelectedFrameIndex(null);

      const useSeed = overrides?.seed ?? seed ?? undefined;
      const useInputs = overrides?.freshInputs ? undefined : inputLiterals;

      try {
        const data = (await getClient().request(
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

        setResult(data);
        if (data.analysis) {
          setAnalysis(data.analysis);
        }
        if (data.run?.seed != null) {
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
      }
    },
    [code, functionOverride, getClient, inputLiterals, isBusy, seed],
  );

  const regenerateInputs = useCallback(() => {
    const freshSeed = Math.floor(Math.random() * 1_000_000);
    setSeed(freshSeed);
    setInputDrafts(null);
    void run({ freshInputs: true, seed: freshSeed });
  }, [run]);

  const measureComplexity = useCallback(async () => {
    if (isBusy || complexityBusy) {
      return;
    }
    setComplexityBusy(true);
    try {
      const data = (await getClient().request(
        {
          op: 'complexity',
          source: code,
          function: functionOverride ?? undefined,
          seed: seed ?? undefined,
        },
        { timeoutMs: RUN_TIMEOUT_MS * 2 },
      )) as ComplexityResult;
      setComplexity(data);
    } catch (error) {
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
      setComplexityBusy(false);
    }
  }, [code, complexityBusy, functionOverride, getClient, isBusy, seed]);

  // Playback timer.
  useEffect(() => {
    if (!playing || totalSteps <= 1) {
      return;
    }
    const timer = window.setInterval(
      () => {
        setStep((current) => {
          if (current >= totalSteps - 1) {
            setPlaying(false);
            return current;
          }
          return current + 1;
        });
      },
      Math.max(40, Math.round(1000 / speed)),
    );
    return () => window.clearInterval(timer);
  }, [playing, speed, totalSteps]);

  const jumpToStep = useCallback(
    (nextStep: number) => {
      setPlaying(false);
      setStep(Math.max(0, Math.min(nextStep, Math.max(totalSteps - 1, 0))));
    },
    [totalSteps],
  );

  const stepForward = useCallback(() => jumpToStep(step + 1), [jumpToStep, step]);
  const stepBack = useCallback(() => jumpToStep(step - 1), [jumpToStep, step]);
  const togglePlay = useCallback(() => {
    if (totalSteps <= 1) {
      return;
    }
    setPlaying((current) => {
      if (!current && step >= totalSteps - 1) {
        setStep(0);
      }
      return !current;
    });
  }, [step, totalSteps]);

  /** Restore an exported session (replay without re-running). */
  const importSession = useCallback(
    (importedCode: string, imported: SessionResult, importedStep = 0) => {
      if (analyzeTimer.current) {
        // A debounced analyze from a recent edit would overwrite the
        // imported analysis (and e.g. hide the inputs panel) — drop it.
        window.clearTimeout(analyzeTimer.current);
        analyzeTimer.current = null;
      }
      codeRef.current = importedCode;
      analyzeSerial.current += 1;
      setCodeState(importedCode);
      setResult(imported);
      setAnalysis(imported.analysis ?? null);
      setComplexity(null);
      const steps = imported.run?.steps.length ?? 0;
      setStep(Math.max(0, Math.min(importedStep, Math.max(steps - 1, 0))));
      setPlaying(false);
      setInputDrafts(null);
      setPendingInitialInputs(null);
      setFunctionOverrideState(imported.run?.functionName ?? null);
      setSeed(imported.run?.seed ?? null);
    },
    [],
  );

  return {
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
    complexity,
    complexityBusy,
    measureComplexity,
    importSession,
    scheduleAnalyze,
  };
}
