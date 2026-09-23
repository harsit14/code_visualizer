// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDraftPersistence } from './useDraftPersistence';
import { loadStoredCodeDraft, saveStoredCodeDraft } from './codeDraft';
vi.mock('./codeDraft', () => ({ loadStoredCodeDraft: vi.fn(), saveStoredCodeDraft: vi.fn() }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(loadStoredCodeDraft).mockReturnValue(null);
  vi.mocked(saveStoredCodeDraft).mockReturnValue('saved');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});
describe('draft persistence', () => {
  it('flushes the latest typing on navigation before the debounce expires', () => {
    const { result, unmount } = renderHook(useDraftPersistence);
    act(() => {
      result.current.queueDraft('first', 'python');
      result.current.queueDraft('latest', 'python');
    });
    expect(saveStoredCodeDraft).not.toHaveBeenCalled();
    unmount();
    expect(saveStoredCodeDraft).toHaveBeenCalledExactlyOnceWith('latest', 'python');
  });
  it('flushes on pagehide and reports a failed save without discarding retry data', () => {
    vi.mocked(saveStoredCodeDraft).mockReturnValueOnce('failed');
    const { result } = renderHook(useDraftPersistence);
    act(() => {
      result.current.queueDraft('keep me', 'python');
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(result.current.draftStatus).toBe('failed');
    act(() => result.current.flushDraft());
    expect(saveStoredCodeDraft).toHaveBeenLastCalledWith('keep me', 'python');
    expect(result.current.draftStatus).toBe('saved');
  });
});
