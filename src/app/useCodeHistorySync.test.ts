// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCodeHistorySync } from './useCodeHistorySync';
import { saveCodeHistory, type CodeHistoryItem } from './historyClient';
import { runJavaScriptTrace } from '../engine/jsTraceEngine';
vi.mock('./historyClient', () => ({ saveCodeHistory: vi.fn() }));
const options = {
  code: 'let x = 1;',
  language: 'javascript' as const,
  embedMode: false,
  exampleId: null,
  functionOverride: null,
  result: runJavaScriptTrace('let x = 1;', 'javascript'),
};
const item = { id: 'owned-history' } as CodeHistoryItem;
beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });
  vi.mocked(saveCodeHistory).mockResolvedValue(item);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
describe('history saving privacy and recovery', () => {
  it('keeps code local until explicitly enabled, and reports a successful save', async () => {
    const { result } = renderHook(() => useCodeHistorySync(options));
    expect(saveCodeHistory).not.toHaveBeenCalled();
    act(() => result.current.setHistorySyncEnabled(true));
    await waitFor(() => expect(result.current.historySaveStatus).toBe('saved'));
    expect(saveCodeHistory).toHaveBeenCalledWith(
      expect.objectContaining({ code: options.code }),
      expect.any(AbortSignal),
      expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
    );
  });
  it('shows failures and retries the current run', async () => {
    vi.mocked(saveCodeHistory).mockRejectedValueOnce(new Error('Offline'));
    const { result } = renderHook(() => useCodeHistorySync(options));
    act(() => result.current.setHistorySyncEnabled(true));
    await waitFor(() => expect(result.current.historySaveStatus).toBe('failed'));
    expect(result.current.historyError).toBe('Offline');
    act(() => result.current.retryHistorySave());
    await waitFor(() => expect(result.current.historySaveStatus).toBe('saved'));
    expect(saveCodeHistory).toHaveBeenCalledTimes(2);
  });
  it('cancels pending uploads and rejects stale IDs when an account changes', async () => {
    let finish!: (item: CodeHistoryItem) => void;
    vi.mocked(saveCodeHistory).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(() => useCodeHistorySync(options));
    act(() => result.current.setHistorySyncEnabled(true));
    const signal = vi.mocked(saveCodeHistory).mock.calls[0][1]!;
    act(() => window.dispatchEvent(new Event('cv-account-changed')));
    expect(signal.aborted).toBe(true);
    await act(async () => finish(item));
    expect(result.current.historySyncEnabled).toBe(false);
    expect(result.current.historySaveStatus).toBe('idle');
    act(() => result.current.setHistorySyncEnabled(true));
    await waitFor(() => expect(result.current.historySaveStatus).toBe('saved'));
    expect(vi.mocked(saveCodeHistory).mock.calls[1][0].id).toBeNull();
  });
  it('reuses one idempotency key until the save is confirmed', async () => {
    vi.mocked(saveCodeHistory).mockRejectedValueOnce(new Error('Network lost the reply'));
    const { result, rerender } = renderHook((props) => useCodeHistorySync(props), {
      initialProps: options,
    });
    act(() => result.current.setHistorySyncEnabled(true));
    await waitFor(() => expect(result.current.historySaveStatus).toBe('failed'));
    act(() => result.current.retryHistorySave());
    await waitFor(() => expect(result.current.historySaveStatus).toBe('saved'));
    const [first, retry] = vi.mocked(saveCodeHistory).mock.calls;
    expect(retry[2]).toBe(first[2]);
    // Confirmed: the next save updates by ID with a fresh key.
    rerender({ ...options, result: runJavaScriptTrace('let x = 1;', 'javascript') });
    await waitFor(() => expect(saveCodeHistory).toHaveBeenCalledTimes(3));
    const next = vi.mocked(saveCodeHistory).mock.calls[2];
    expect(next[0].id).toBe('owned-history');
    expect(next[2]).not.toBe(first[2]);
  });
  it('uses a new key for different code and after an account change', async () => {
    vi.mocked(saveCodeHistory).mockRejectedValue(new Error('Offline'));
    const { result, rerender } = renderHook((props) => useCodeHistorySync(props), {
      initialProps: options,
    });
    act(() => result.current.setHistorySyncEnabled(true));
    await waitFor(() => expect(result.current.historySaveStatus).toBe('failed'));
    const changedCode = 'let y = 2;';
    rerender({
      ...options,
      code: changedCode,
      result: runJavaScriptTrace(changedCode, 'javascript'),
    });
    await waitFor(() => expect(saveCodeHistory).toHaveBeenCalledTimes(2));
    act(() => window.dispatchEvent(new Event('cv-account-changed')));
    act(() => result.current.setHistorySyncEnabled(true));
    await waitFor(() => expect(saveCodeHistory).toHaveBeenCalledTimes(3));
    const keys = vi.mocked(saveCodeHistory).mock.calls.map((call) => call[2]);
    expect(new Set(keys).size).toBe(3);
  });
  it('does not leave a missing confirmation spinning forever', async () => {
    vi.mocked(saveCodeHistory).mockResolvedValueOnce(null);
    const { result } = renderHook(() => useCodeHistorySync(options));
    act(() => result.current.setHistorySyncEnabled(true));
    await waitFor(() => expect(result.current.historySaveStatus).toBe('failed'));
  });
});
