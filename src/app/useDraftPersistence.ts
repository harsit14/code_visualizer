import { useCallback, useEffect, useRef, useState } from 'react';
import { loadStoredCodeDraft, saveStoredCodeDraft } from './codeDraft';
import type { Language } from '../engine/types';
export function useDraftPersistence() {
  const pending = useRef<{ code: string; language: Language } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const mounted = useRef(true);
  const [draftAvailable, setDraftAvailable] = useState(() => loadStoredCodeDraft() !== null);
  const [draftStatus, setDraftStatus] = useState<
    'idle' | 'pending' | 'saved' | 'cleared' | 'failed'
  >('idle');
  const flushDraft = useCallback(() => {
    window.clearTimeout(timer.current);
    if (!pending.current) return;
    const { code, language } = pending.current;
    const outcome = saveStoredCodeDraft(code, language);
    if (outcome !== 'failed') pending.current = null;
    if (mounted.current) {
      setDraftStatus(outcome);
      setDraftAvailable(loadStoredCodeDraft() !== null);
    }
  }, []);
  const queueDraft = useCallback(
    (code: string, language: Language) => {
      pending.current = { code, language };
      setDraftStatus('pending');
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flushDraft, 600);
    },
    [flushDraft],
  );
  useEffect(() => {
    mounted.current = true;
    const visibility = () => {
      if (document.visibilityState === 'hidden') flushDraft();
    };
    window.addEventListener('pagehide', flushDraft);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      mounted.current = false;
      flushDraft();
      window.removeEventListener('pagehide', flushDraft);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [flushDraft]);
  return { draftAvailable, draftStatus, flushDraft, queueDraft };
}
