import { useCallback, useEffect, useRef, useState } from 'react';
import type { Language, SessionResult } from '../engine/types';
import { getExample } from '../examples/examples';
import { saveCodeHistory } from './historyClient';
const SYNC_KEY = 'cv-history-sync-enabled';
function initialSync() {
  try {
    return localStorage.getItem(SYNC_KEY) === 'true';
  } catch {
    return false;
  }
}

function newSaveKey(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

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
  const [historySyncEnabled, setEnabled] = useState(initialSync);
  const [historySaveStatus, setHistorySaveStatus] = useState<
    'idle' | 'saving' | 'saved' | 'failed'
  >('idle');
  const [historyError, setHistoryError] = useState('');
  const [retry, setRetry] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const setHistorySyncEnabled = useCallback((enabled: boolean) => {
    generationRef.current++;
    controllerRef.current?.abort();
    setEnabled(enabled);
    setHistorySaveStatus('idle');
    setHistoryError('');
    try {
      localStorage.setItem(SYNC_KEY, String(enabled));
    } catch {
      /* preference lasts this visit */
    }
  }, []);
  const retryHistorySave = useCallback(() => setRetry((value) => value + 1), []);
  const currentHistoryIdRef = useRef<string | null>(null);
  // The last unconfirmed save. Saving the same payload again (Retry, or a rerun
  // after a lost acknowledgement) reuses its key, so the server stores it once.
  const pendingSaveRef = useRef<{ key: string; signature: string } | null>(null);
  const [historyRefreshToken, setHistoryRefreshToken] = useState(0);

  const clearHistoryItemId = useCallback(() => {
    currentHistoryIdRef.current = null;
  }, []);

  const setHistoryItemId = useCallback((id: string | null) => {
    currentHistoryIdRef.current = id;
  }, []);

  useEffect(() => {
    const changed = () => {
      currentHistoryIdRef.current = null;
      pendingSaveRef.current = null;
      setHistorySyncEnabled(false);
      setHistoryRefreshToken((value) => value + 1);
    };
    const storage = (event: StorageEvent) => {
      if (event.key === 'cv-account-change') changed();
    };
    window.addEventListener('cv-account-changed', changed);
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener('cv-account-changed', changed);
      window.removeEventListener('storage', storage);
    };
  }, [setHistorySyncEnabled]);

  useEffect(() => {
    if (!historySyncEnabled || embedMode || result?.status !== 'ok' || !result.run) {
      setHistorySaveStatus('idle');
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    controllerRef.current = controller;
    const generation = ++generationRef.current;
    setHistorySaveStatus('saving');
    setHistoryError('');
    const run = result.run;
    const payload = {
      code,
      exampleId,
      functionName: run.functionName ?? functionOverride,
      id: currentHistoryIdRef.current,
      inputs: run.inputs.map((input) => input.literal),
      language,
      seed: run.seed,
      title: historyTitle(exampleId, run.functionName ?? functionOverride, code),
    };
    const signature = JSON.stringify(payload);
    const pending =
      pendingSaveRef.current?.signature === signature
        ? pendingSaveRef.current
        : { key: newSaveKey(), signature };
    pendingSaveRef.current = pending;
    void saveCodeHistory(payload, controller.signal, pending.key)
      .then((item) => {
        if (!item) throw new Error('The server did not confirm this save. Please retry.');
        if (!cancelled && generation === generationRef.current && item) {
          if (pendingSaveRef.current === pending) pendingSaveRef.current = null;
          setHistorySaveStatus('saved');
          currentHistoryIdRef.current = item.id;
          setHistoryRefreshToken((current) => current + 1);
        }
      })
      .catch((error) => {
        if (cancelled || generation !== generationRef.current || controller.signal.aborted) return;
        setHistorySaveStatus('failed');
        setHistoryError(
          error instanceof Error
            ? error.message
            : 'History save failed. Your code remains on this device.',
        );
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [code, embedMode, exampleId, functionOverride, language, result, historySyncEnabled, retry]);

  return {
    historySyncEnabled,
    setHistorySyncEnabled,
    historySaveStatus,
    historyError,
    retryHistorySave,
    clearHistoryItemId,
    historyRefreshToken,
    setHistoryItemId,
  };
}
