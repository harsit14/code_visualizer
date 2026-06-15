import { Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_DEEPSEEK_MODEL,
  type DeepSeekStepExplanation,
  explainStepWithDeepSeek,
} from '../engine/deepseekClient';
import type { Language, SessionResult, TraceStep } from '../engine/types';

type ExplainerPanelProps = {
  code: string;
  language: Language;
  currentStep: TraceStep | undefined;
  previousStep: TraceStep | undefined;
  frameIndex: number | null;
  result: SessionResult | null;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError') {
      return 'Explanation request was cancelled.';
    }
    if (error.message === 'Failed to fetch') {
      return 'Could not reach the AI explainer service.';
    }
    return error.message;
  }
  return 'Could not generate an explanation.';
}

export function ExplainerPanel({
  code,
  currentStep,
  frameIndex,
  language,
  previousStep,
  result,
}: ExplainerPanelProps) {
  const [explanation, setExplanation] = useState<DeepSeekStepExplanation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const canExplain = Boolean(currentStep && result?.run);
  const stepLabel = currentStep ? `step ${currentStep.i + 1}` : DEFAULT_DEEPSEEK_MODEL;
  const contextKey = useMemo(
    () =>
      [
        language,
        code,
        currentStep?.i ?? 'none',
        currentStep?.line ?? 'none',
        frameIndex ?? 'active',
        result?.durationMs ?? 'none',
      ].join(':'),
    [code, currentStep, frameIndex, language, result],
  );

  useEffect(() => {
    setExplanation(null);
    setError(null);
  }, [contextKey]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const handleExplain = useCallback(async () => {
    if (!canExplain) {
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    setExplanation(null);

    try {
      const nextExplanation = await explainStepWithDeepSeek({
        code,
        currentStep,
        frameIndex,
        language,
        previousStep,
        result,
        signal: controller.signal,
      });
      setExplanation(nextExplanation);
    } catch (requestError) {
      if (!controller.signal.aborted) {
        setError(errorMessage(requestError));
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  }, [canExplain, code, currentStep, frameIndex, language, previousStep, result]);

  return (
    <section className="panel explainer-panel" aria-label="AI step explainer">
      <header className="panel-header">
        <h2>
          <Sparkles size={14} /> Explainer
        </h2>
        <span className="panel-hint">{stepLabel}</span>
      </header>

      <div className="panel-scroll explainer-body">
        {!canExplain ? <p className="panel-empty">Run code to explain a step.</p> : null}

        <p className="explainer-privacy">
          Uses the hosted DeepSeek explainer service. No API key is stored in this browser.
        </p>

        <button
          className="explainer-action"
          disabled={!canExplain || busy}
          onClick={() => void handleExplain()}
          title="Ask the hosted AI service to explain the selected trace step"
          type="button"
        >
          <Sparkles size={13} />
          {busy ? 'Explaining...' : 'Explain step'}
        </button>

        {error ? (
          <p className="explainer-error" role="alert">
            {error}
          </p>
        ) : null}

        {explanation ? (
          <article className="explainer-answer">
            <p>{explanation.text}</p>
            <footer>
              <span>{explanation.model}</span>
              {explanation.usage?.totalTokens ? (
                <span>{explanation.usage.totalTokens} tokens</span>
              ) : null}
            </footer>
          </article>
        ) : null}
      </div>
    </section>
  );
}
