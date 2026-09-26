// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runJavaScriptTrace } from '../engine/jsTraceEngine';
import type { SessionResult } from '../engine/types';
import { MAX_REPLAY_BYTES, MAX_REPLAY_STEPS } from './replayExport';
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

describe('trace downloads', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function captureDownloads() {
    const blobs: Blob[] = [];
    const names: string[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return 'blob:download';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });
    return { blobs, names };
  }

  // jsdom's Blob has no text(); FileReader reads it the same way.
  const readBlob = (blob: Blob) =>
    new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsText(blob);
    });

  const traced = runJavaScriptTrace('let a = 1;\na += 1;', 'javascript');
  const annotated = {
    ...options(),
    bookmarks: [{ step: 1, note: 'increment' }],
    checkpoints: [1],
    result: traced,
  };

  it('writes bookmarks and checkpoints into JSON trace exports', async () => {
    const { blobs } = captureDownloads();
    const { result, unmount } = renderHook(() => useTraceTransfer(annotated));
    act(() => result.current.handleExport());
    const payload = JSON.parse(await readBlob(blobs[0]));
    expect(payload).toMatchObject({
      version: 2,
      bookmarks: [{ step: 1, note: 'increment' }],
      checkpoints: [1],
    });
    unmount();
  });

  it('downloads a standalone replay page', async () => {
    const { blobs, names } = captureDownloads();
    const { result, unmount } = renderHook(() => useTraceTransfer(annotated));
    await act(async () => {
      await result.current.handleExportReplay();
    });
    expect(names[0]).toMatch(/^code-visualizer-replay-\d+\.html$/);
    expect(blobs[0].type).toBe('text/html;charset=utf-8');
    expect(await readBlob(blobs[0])).toContain('"note":"increment"');
    expect(result.current.replayNotice).toBeNull();
    unmount();
  });

  it('explains trimmed and refused replays', async () => {
    const { names } = captureDownloads();
    const run = traced.run!;
    const long: SessionResult = {
      ...traced,
      run: {
        ...run,
        steps: Array.from({ length: MAX_REPLAY_STEPS + 1 }, (_, i) => ({ ...run.steps[0], i })),
      },
    };
    const trimmed = renderHook(() => useTraceTransfer({ ...annotated, result: long }));
    await act(async () => {
      await trimmed.result.current.handleExportReplay();
    });
    expect(names).toHaveLength(1);
    expect(trimmed.result.current.replayNotice).toEqual({
      error: false,
      text: 'Replay exported. This replay includes the first 5,000 of 5,001 recorded steps.',
    });
    trimmed.unmount();

    const huge: SessionResult = {
      ...traced,
      run: {
        ...run,
        stdout: 'x'.repeat(MAX_REPLAY_BYTES),
        steps: run.steps.map((step) => ({ ...step, stdoutLen: MAX_REPLAY_BYTES })),
      },
    };
    const refused = renderHook(() => useTraceTransfer({ ...annotated, result: huge }));
    await act(async () => {
      await refused.result.current.handleExportReplay();
    });
    expect(names).toHaveLength(1);
    expect(refused.result.current.replayNotice?.error).toBe(true);
    expect(refused.result.current.replayNotice?.text).toMatch(/^Replay not exported\. .*8 MB/);
    act(() => refused.result.current.dismissReplayNotice());
    expect(refused.result.current.replayNotice).toBeNull();
    refused.unmount();
  });
});
