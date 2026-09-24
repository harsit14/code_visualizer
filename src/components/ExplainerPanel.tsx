/**
 * Step explainer: a local explanation that never leaves the browser, then an
 * optional AI explanation whose exact request the learner can inspect and trim.
 */
import { Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildStepExplanationContext,
  DEFAULT_EXPLANATION_PRIVACY,
  explainStepWithDeepSeek,
  type DeepSeekStepExplanation,
  type ExplanationPrivacy,
} from '../engine/deepseekClient';
import { explainException } from '../engine/exceptionExplanations';
import type { StepChange } from '../engine/stepChange';
import type { Language, SessionResult, TraceStep } from '../engine/types';

type ExplainerPanelProps = {
  code: string;
  language: Language;
  currentStep: TraceStep | undefined;
  previousStep: TraceStep | undefined;
  frameIndex: number | null;
  result: SessionResult | null;
  /** False when this deployment has no AI service. */
  available?: boolean;
  /** Deterministic explanation of this step, shown before any AI request. */
  change?: StepChange | null;
};

const PRIVACY_OPTIONS: { key: keyof ExplanationPrivacy; label: string; off: string }[] = [
  { key: 'includeCode', label: 'Code around this line', off: 'only the current line is sent' },
  { key: 'includeValues', label: 'Variable values', off: 'names and types only' },
  { key: 'includeOutput', label: 'Printed output', off: 'output is not sent' },
];

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
  available = true,
  change = null,
}: ExplainerPanelProps) {
  const [privacy, setPrivacy] = useState<ExplanationPrivacy>(DEFAULT_EXPLANATION_PRIVACY);
  const [explanation, setExplanation] = useState<DeepSeekStepExplanation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // Answers already received in this session, keyed by the exact request.
  const answers = useRef(new Map<string, DeepSeekStepExplanation>());
  const canExplain = Boolean(currentStep && result?.run);
  const request = useMemo(
    () =>
      canExplain
        ? buildStepExplanationContext(
            { code, currentStep, frameIndex, language, previousStep, result },
            privacy,
          )
        : null,
    [canExplain, code, currentStep, frameIndex, language, previousStep, privacy, result],
  );
  const requestKey = useMemo(() => (request ? JSON.stringify(request) : ''), [request]);
  const exception = currentStep?.exc ?? null;
  const exceptionNote = explainException(exception, language);

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setError(null);
    setExplanation(answers.current.get(requestKey) ?? null);
  }, [requestKey]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const handleExplain = useCallback(async () => {
    if (!canExplain || !requestKey) {
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
        privacy,
        result,
        signal: controller.signal,
      });
      if (!controller.signal.aborted && abortRef.current === controller) {
        answers.current.set(requestKey, nextExplanation);
        setExplanation(nextExplanation);
      }
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
  }, [
    canExplain,
    code,
    currentStep,
    frameIndex,
    language,
    previousStep,
    privacy,
    requestKey,
    result,
  ]);

  return (
    <section className="panel explainer-panel" aria-label="AI step explainer">
      <header className="panel-header">
        <h2>
          <Sparkles size={14} /> Explainer
        </h2>
      </header>

      <div className="panel-scroll explainer-body">
        {!canExplain ? <p className="panel-empty">Run code to explain a step.</p> : null}

        {canExplain && (change || exceptionNote) ? (
          <section aria-label="Local explanation" className="explainer-local">
            <h3>This step</h3>
            {change ? <p>{change.summary}.</p> : null}
            {change?.changes.length ? (
              <ul>
                {change.changes.map((item) => (
                  <li key={`${item.path}-${item.after}`}>
                    <code>{item.path}</code> {item.before ?? 'absent'} → {item.after ?? 'removed'}
                  </li>
                ))}
              </ul>
            ) : null}
            {exceptionNote ? (
              <p>
                <strong>{exceptionNote.title}</strong> {exceptionNote.detail}
              </p>
            ) : null}
            <p className="explainer-note">Worked out in your browser; nothing was sent.</p>
          </section>
        ) : null}

        <section aria-label="AI explanation" className="explainer-ai">
          <h3>Deeper explanation (optional)</h3>
          <p className="explainer-privacy">
            {available
              ? 'Uses the hosted AI service. Choose what the request may include; each new answer uses one of your daily AI explanations, and repeated requests are answered from a cache without using quota.'
              : 'AI explanations are not available on this deployment. The local explanation above still describes each step.'}
          </p>

          {available && canExplain ? (
            <>
              <fieldset className="explainer-privacy-options">
                <legend>Include in the request</legend>
                {PRIVACY_OPTIONS.map((option) => (
                  <label key={option.key}>
                    <input
                      checked={privacy[option.key]}
                      onChange={(event) =>
                        setPrivacy((current) => ({
                          ...current,
                          [option.key]: event.target.checked,
                        }))
                      }
                      type="checkbox"
                    />
                    {option.label}
                    {!privacy[option.key] ? (
                      <span className="explainer-note"> ({option.off})</span>
                    ) : null}
                  </label>
                ))}
              </fieldset>
              <details className="explainer-preview">
                <summary>Preview exactly what will be sent</summary>
                <pre>{request ? JSON.stringify(request, null, 2) : ''}</pre>
              </details>
            </>
          ) : null}

          <button
            className="explainer-action"
            disabled={!available || !canExplain || busy}
            onClick={() => void handleExplain()}
            title="Explain the selected trace step in plain English"
            type="button"
          >
            <Sparkles size={13} />
            {busy ? 'Explaining...' : explanation ? 'Explain again' : 'Explain step'}
          </button>

          {error ? (
            <p className="explainer-error" role="alert">
              {error}
            </p>
          ) : null}

          {explanation ? (
            <article className="explainer-answer">
              <p>{explanation.text}</p>
              {explanation.cached ? (
                <p className="explainer-note">Answered from the cache; no quota was used.</p>
              ) : null}
            </article>
          ) : null}
        </section>
      </div>
    </section>
  );
}
