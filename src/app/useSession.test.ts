// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionResult, TraceStep } from '../engine/types';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

// Replace the Pyodide worker client with a controllable stub so the hook's
// state machine can be tested without a real Worker.
vi.mock('../engine/runtimeClient', () => {
  class TimeoutError extends Error {
    constructor(ms = 0) {
      super(`Python execution exceeded ${ms}ms and was stopped.`);
      this.name = 'TimeoutError';
    }
  }
  class RuntimeClient {
    request = requestMock;
    dispose = vi.fn();
  }
  return { RuntimeClient, TimeoutError };
});

import { TimeoutError } from '../engine/runtimeClient';
import { useSession } from './useSession';

function scriptResult(
  stepCount: number,
  options: { exceptionAt?: number; seed?: number } = {},
): SessionResult {
  const steps: TraceStep[] = Array.from({ length: stepCount }, (_, i) => ({
    i,
    event: options.exceptionAt === i ? 'exception' : 'line',
    line: i + 1,
    func: '<module>',
    stack: [{ id: 'frame-0', func: '<module>', line: i + 1, locals: {} }],
    globals: {},
    stdoutLen: 0,
    ...(options.exceptionAt === i ? { exc: { type: 'ValueError', msg: 'boom' } } : {}),
  }));
  return {
    status: 'ok',
    mode: 'script',
    analysis: {
      mode: 'script',
      functions: [],
      defaultFunction: null,
      definesTreeNode: false,
      definesListNode: false,
      referencesTreeNode: false,
      referencesListNode: false,
      diagnostics: [],
    },
    run: {
      functionName: null,
      inputs: [],
      seed: options.seed ?? null,
      steps,
      returnValue: null,
      exception: null,
      stdout: '',
      stderr: '',
      opCount: stepCount,
      truncated: false,
      truncationReason: null,
    },
    error: null,
    durationMs: 5,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  requestMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useSession', () => {
  it('starts idle with no trace', () => {
    const { result, unmount } = renderHook(() => useSession('print(1)'));
    expect(result.current.result).toBeNull();
    expect(result.current.totalSteps).toBe(0);
    expect(result.current.step).toBe(0);
    expect(result.current.isBusy).toBe(false);
    unmount();
  });

  it('populates the trace and auto-plays a multi-step run', async () => {
    requestMock.mockResolvedValueOnce(scriptResult(3, { seed: 42 }));
    const { result, unmount } = renderHook(() => useSession('print(1)'));
    await act(async () => {
      await result.current.run();
    });
    expect(result.current.totalSteps).toBe(3);
    expect(result.current.step).toBe(0);
    expect(result.current.currentStep?.i).toBe(0);
    expect(result.current.playing).toBe(true);
    expect(result.current.seed).toBe(42);
    unmount();
  });

  it('jumps to the failing step and does not auto-play on exception', async () => {
    requestMock.mockResolvedValueOnce(scriptResult(4, { exceptionAt: 2 }));
    const { result, unmount } = renderHook(() => useSession('boom()'));
    await act(async () => {
      await result.current.run();
    });
    expect(result.current.step).toBe(2);
    expect(result.current.playing).toBe(false);
    unmount();
  });

  it('reports a timeout result when the runtime times out', async () => {
    requestMock.mockRejectedValueOnce(new TimeoutError(15000));
    const { result, unmount } = renderHook(() => useSession('while True: pass'));
    await act(async () => {
      await result.current.run();
    });
    expect(result.current.result?.status).toBe('timeout');
    expect(result.current.result?.error?.type).toBe('ExecutionTimeout');
    unmount();
  });

  it('clamps jumpToStep within the trace bounds', async () => {
    requestMock.mockResolvedValueOnce(scriptResult(3));
    const { result, unmount } = renderHook(() => useSession('print(1)'));
    await act(async () => {
      await result.current.run();
    });
    act(() => result.current.jumpToStep(99));
    expect(result.current.step).toBe(2);
    act(() => result.current.jumpToStep(-5));
    expect(result.current.step).toBe(0);
    unmount();
  });

  it('restores an imported session without re-running', () => {
    const imported = scriptResult(5, { seed: 7 });
    const { result, unmount } = renderHook(() => useSession('print(1)'));
    act(() => result.current.importSession('print(2)', imported, 3));
    expect(result.current.code).toBe('print(2)');
    expect(result.current.totalSteps).toBe(5);
    expect(result.current.step).toBe(3);
    expect(result.current.seed).toBe(7);
    expect(requestMock).not.toHaveBeenCalled();
    unmount();
  });

  it('setCode clears the previous result', async () => {
    requestMock.mockResolvedValueOnce(scriptResult(3));
    const { result, unmount } = renderHook(() => useSession('print(1)'));
    await act(async () => {
      await result.current.run();
    });
    expect(result.current.totalSteps).toBe(3);
    act(() => result.current.setCode('print(2)'));
    expect(result.current.result).toBeNull();
    expect(result.current.code).toBe('print(2)');
    unmount();
  });
});
