import { Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type DeepSeekStepExplanation, explainStepWithDeepSeek } from '../engine/deepseekClient';
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
      </header>

      <div className="panel-scroll explainer-body">
        {!canExplain ? <p className="panel-empty">Run code to explain a step.</p> : null}

        <p className="explainer-privacy">
          Plain-English explanations use the hosted AI service. No API key is stored in this
          browser.
        </p>

        <button
          className="explainer-action"
          disabled={!canExplain || busy}
          onClick={() => void handleExplain()}
          title="Explain the selected trace step in plain English"
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
          </article>
        ) : null}
      </div>
    </section>
  );
}
