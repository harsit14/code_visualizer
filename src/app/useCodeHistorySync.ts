import { useCallback, useEffect, useRef, useState } from 'react';
import type { Language, SessionResult } from '../engine/types';
import { getExample } from '../examples/examples';
import { saveCodeHistory } from './historyClient';

type UseCodeHistorySyncOptions = {
  code: string;
  embedMode: boolean;
  exampleId: string | null;
  functionOverride: string | null;
  language: Language;
  result: SessionResult | null;
};

function historyTitle(exampleId: string | null, functionName: string | null, code: string): string {
  const exampleTitle = exampleId ? getExample(exampleId)?.title : null;
  if (exampleTitle) {
    return exampleTitle;
  }
  if (functionName) {
    return functionName;
  }
  return (
    code
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean)
      ?.slice(0, 80) ?? 'Untitled code'
  );
}

export function useCodeHistorySync({
  code,
  embedMode,
  exampleId,
  functionOverride,
  language,
  result,
}: UseCodeHistorySyncOptions) {
  const currentHistoryIdRef = useRef<string | null>(null);
  const [historyRefreshToken, setHistoryRefreshToken] = useState(0);

  const clearHistoryItemId = useCallback(() => {
    currentHistoryIdRef.current = null;
  }, []);

  const setHistoryItemId = useCallback((id: string | null) => {
    currentHistoryIdRef.current = id;
  }, []);

  useEffect(() => {
    if (embedMode || result?.status !== 'ok' || !result.run) {
      return;
    }

    let cancelled = false;
    const run = result.run;
    void saveCodeHistory({
      code,
      exampleId,
      functionName: run.functionName ?? functionOverride,
      id: currentHistoryIdRef.current,
      inputs: run.inputs.map((input) => input.literal),
      language,
      seed: run.seed,
      title: historyTitle(exampleId, run.functionName ?? functionOverride, code),
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
  }, [code, embedMode, exampleId, functionOverride, language, result]);

  return {
    clearHistoryItemId,
    historyRefreshToken,
    setHistoryItemId,
  };
}
