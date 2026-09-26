/**
 * The run kept for "Compare runs". It lives in memory only and carries its own
 * copy of the code, language and inputs, so the comparison never reads the
 * editor for the baseline side.
 */
import { useCallback, useState } from 'react';
import type { GeneratedInputInfo, Language, SessionResult } from '../engine/types';

export type RunBaseline = {
  code: string;
  language: Language;
  functionName: string | null;
  inputs: GeneratedInputInfo[];
  result: SessionResult;
};

type BaselineSource = {
  code: string;
  language: Language;
  /** The session clears this whenever the code or settings change, so it always matches `code`. */
  result: SessionResult | null;
};

export function useRunBaseline({ code, language, result }: BaselineSource) {
  const [baseline, setBaseline] = useState<RunBaseline | null>(null);
  // Only a finished run with a trace can be compared.
  const canKeepBaseline = Boolean(result?.run) && baseline?.result !== result;

  const keepBaseline = useCallback(() => {
    if (!result?.run) return;
    setBaseline({
      code,
      language,
      functionName: result.run.functionName,
      inputs: result.run.inputs,
      result,
    });
  }, [code, language, result]);

  const clearBaseline = useCallback(() => setBaseline(null), []);

  return { baseline, canKeepBaseline, keepBaseline, clearBaseline };
}
