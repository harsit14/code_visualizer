// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { runJavaScriptTrace } from '../engine/jsTraceEngine';
import { useTraceTransfer } from './useTraceTransfer';

const options = (onImportTrace = vi.fn()) => ({
  code: 'const a = 1;',
  exampleId: null,
  functionOverride: null,
  inputLiterals: undefined,
  language: 'javascript' as const,
  onImportTrace,
  result: null,
  seed: null,
  step: 0,
});
const valid = JSON.stringify({
  version: 2,
  code: 'const a = 1;',
  language: 'javascript',
  result: runJavaScriptTrace('const a = 1;', 'javascript'),
});

describe('trace transfer recovery', () => {
  it('keeps the current workspace and exposes a dismissible import error', async () => {
    const props = options();
    const { result, unmount } = renderHook(() => useTraceTransfer(props));
    await act(async () => {
      result.current.handleImport({ size: 8, text: async () => '{broken' } as File);
    });
    expect(props.onImportTrace).not.toHaveBeenCalled();
    expect(result.current.importError).toContain('not valid JSON');
    act(() => result.current.dismissImportError());
    expect(result.current.importError).toBeNull();
    unmount();
  });

  it('ignores an older file read completing after a newer selection', async () => {
    let resolve!: (value: string) => void;
    const props = options();
    const { result, unmount } = renderHook(() => useTraceTransfer(props));
    act(() => {
      result.current.handleImport({
        size: 10,
        text: () =>
          new Promise<string>((r) => {
            resolve = r;
          }),
      } as File);
    });
    await act(async () => {
      result.current.handleImport({ size: valid.length, text: async () => valid } as File);
    });
    await act(async () => {
      resolve('{broken');
    });
    expect(props.onImportTrace).toHaveBeenCalledTimes(1);
    expect(result.current.importError).toBeNull();
    unmount();
  });
});
