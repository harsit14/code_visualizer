// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EncodedValue, SessionResult, TraceStep } from '../engine/types';

const { requestMock, runJavaScriptMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  runJavaScriptMock: vi.fn(),
}));

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

vi.mock('../engine/jsRuntimeClient', () => ({
  runJavaScriptInWorker: runJavaScriptMock,
}));

import { TimeoutError } from '../engine/runtimeClient';
import { useSession } from './useSession';

const localStorageItems = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((key: string) => localStorageItems.get(key) ?? null),
  removeItem: vi.fn((key: string) => {
    localStorageItems.delete(key);
  }),
  setItem: vi.fn((key: string, value: string) => {
    localStorageItems.set(key, value);
  }),
};

const num = (value: number): EncodedValue => ({ k: 'num', t: 'int', v: String(value) });

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
      runtimeMs: 1.2,
      memoryMb: 0.5,
      truncated: false,
      truncationReason: null,
    },
    error: null,
    durationMs: 5,
  };
}

function functionResult(returnValue: EncodedValue = num(21)): SessionResult {
  const step: TraceStep = {
    event: 'return',
    func: 'solve',
    globals: {},
    i: 0,
    line: 2,
    stack: [{ id: 'frame-0', func: 'solve', line: 2, locals: {} }],
    stdoutLen: 0,
    ret: returnValue,
  };
  return {
    status: 'ok',
    mode: 'function',
    analysis: {
      mode: 'function',
      functions: [
        {
          className: null,
          docstring: null,
          isGenerator: false,
          line: 1,
          name: 'solve',
          params: [
            {
              annotation: null,
              inferred: 'list[int]',
              name: 'nums',
              source: 'name',
            },
          ],
          qualname: 'solve',
          returns: null,
        },
      ],
      defaultFunction: 'solve',
      definesListNode: false,
      definesTreeNode: false,
      diagnostics: [],
      referencesListNode: false,
      referencesTreeNode: false,
    },
    run: {
      exception: null,
      functionName: 'solve',
      inputs: [{ literal: '[1, 2, 3]', name: 'nums', type: 'list[int]' }],
      memoryMb: 0.25,
      opCount: 1,
      returnValue,
      runtimeMs: 3,
      seed: 1,
      setupError: null,
      stderr: '',
      stdout: '',
      steps: [step],
      truncated: false,
      truncationReason: null,
    },
    error: null,
    durationMs: 5,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorageItems.clear();
  localStorageMock.getItem.mockClear();
  localStorageMock.removeItem.mockClear();
  localStorageMock.setItem.mockClear();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: localStorageMock,
  });
  requestMock.mockReset();
  runJavaScriptMock.mockReset();
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

  it('keeps current inputs, cases, and notebook notes while editing a function body', async () => {
    const code = 'def solve(nums):\n    return 21';
    const editedCode = 'def solve(nums):\n    total = 21\n    return total';
    const imported = functionResult();
    const { result, unmount } = renderHook(() => useSession(code));

    act(() => result.current.importSession(code, imported, 0));
    await act(async () => {});
    act(() => result.current.addTestCase());
    act(() => {
      result.current.updateTestCase(result.current.testCases[0].id, { expected: '21' });
      result.current.updatePracticeNotebook({
        notes: 'Keep this edge case.',
        patterns: 'loop invariant',
        status: 'practicing',
      });
    });
    await act(async () => {});

    act(() => result.current.setCode(editedCode));
    await act(async () => {});

    expect(result.current.result).toBeNull();
    expect(result.current.code).toBe(editedCode);
    expect(result.current.inputLiterals).toEqual(['[1, 2, 3]']);
    expect(result.current.testCases).toHaveLength(1);
    expect(result.current.testCases[0]).toMatchObject({
      expected: '21',
      inputs: ['[1, 2, 3]'],
      name: 'Case 1',
    });
    expect(result.current.practiceNotebook).toMatchObject({
      notes: 'Keep this edge case.',
      patterns: 'loop invariant',
      status: 'practicing',
    });

    unmount();
  });

  it('runs JavaScript sessions through the JavaScript worker path', async () => {
    runJavaScriptMock.mockResolvedValueOnce(scriptResult(2));
    const { result, unmount } = renderHook(() =>
      useSession('console.log(1)', { language: 'javascript' }),
    );
    await act(async () => {
      await result.current.run();
    });
    expect(runJavaScriptMock).toHaveBeenCalledWith('console.log(1)', 'javascript', 15000);
    expect(requestMock).not.toHaveBeenCalled();
    expect(result.current.language).toBe('javascript');
    expect(result.current.totalSteps).toBe(2);
    unmount();
  });

  it('runs saved practice cases without replacing the active trace', async () => {
    const imported = functionResult();
    const { result, unmount } = renderHook(() => useSession('def solve(nums):\n    return 21'));

    act(() => result.current.importSession('def solve(nums):\n    return 21', imported, 0));
    act(() => result.current.addTestCase());
    act(() => {
      const id = result.current.testCases[0].id;
      result.current.updateTestCase(id, { expected: '21' });
    });

    requestMock.mockResolvedValueOnce(functionResult(num(21)));
    await act(async () => {
      await result.current.runTestCases();
    });

    expect(result.current.result).toBe(imported);
    expect(result.current.testCases[0]).toMatchObject({
      actual: '21',
      error: null,
      status: 'pass',
    });
    expect(requestMock).toHaveBeenCalledWith(
      {
        op: 'run',
        source: 'def solve(nums):\n    return 21',
        options: {
          function: 'solve',
          inputs: ['[1, 2, 3]'],
          seed: 1,
        },
      },
      { timeoutMs: 15000 },
    );
    unmount();
  });

  it('restores practice cases from local storage for the same code and function', async () => {
    const code = 'def solve(nums):\n    return 21';
    const imported = functionResult();
    const first = renderHook(() => useSession(code));

    act(() => first.result.current.importSession(code, imported, 0));
    await act(async () => {});
    act(() => first.result.current.addTestCase());
    act(() => {
      first.result.current.updateTestCase(first.result.current.testCases[0].id, {
        expected: '21',
      });
    });
    await act(async () => {});
    first.unmount();

    const second = renderHook(() => useSession(code));
    act(() => second.result.current.importSession(code, imported, 0));
    await act(async () => {});

    expect(second.result.current.testCases).toHaveLength(1);
    expect(second.result.current.testCases[0]).toMatchObject({
      expected: '21',
      inputs: ['[1, 2, 3]'],
      name: 'Case 1',
    });
    second.unmount();
  });

  it('restores practice notebook notes for the same code and function', async () => {
    const code = 'def solve(nums):\n    return 21';
    const imported = functionResult();
    const first = renderHook(() => useSession(code));

    act(() => first.result.current.importSession(code, imported, 0));
    await act(async () => {});
    act(() => {
      first.result.current.updatePracticeNotebook({
        notes: 'Watch the invariant.',
        patterns: 'two pointers',
        status: 'practicing',
      });
    });
    await act(async () => {});
    first.unmount();

    const second = renderHook(() => useSession(code));
    act(() => second.result.current.importSession(code, imported, 0));
    await act(async () => {});

    expect(second.result.current.practiceNotebook).toMatchObject({
      notes: 'Watch the invariant.',
      patterns: 'two pointers',
      status: 'practicing',
    });
    second.unmount();
  });

  it('reruns only failed practice cases', async () => {
    const code = 'def solve(nums):\n    return 21';
    const imported = functionResult();
    const { result, unmount } = renderHook(() => useSession(code));

    act(() => result.current.importSession(code, imported, 0));
    act(() => result.current.addTestCase());
    act(() => result.current.addTestCase());
    act(() => {
      result.current.updateTestCase(result.current.testCases[0].id, { expected: '21' });
      result.current.updateTestCase(result.current.testCases[1].id, {
        expected: '99',
        inputs: ['[9]'],
      });
    });

    requestMock.mockResolvedValueOnce(functionResult(num(21)));
    requestMock.mockResolvedValueOnce(functionResult(num(21)));
    await act(async () => {
      await result.current.runTestCases();
    });
    expect(result.current.testCases.map((testCase) => testCase.status)).toEqual(['pass', 'fail']);

    requestMock.mockClear();
    requestMock.mockResolvedValueOnce(functionResult(num(99)));
    await act(async () => {
      await result.current.runFailedTestCases();
    });

    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(requestMock).toHaveBeenCalledWith(
      {
        op: 'run',
        source: code,
        options: {
          function: 'solve',
          inputs: ['[9]'],
          seed: 1,
        },
      },
      { timeoutMs: 15000 },
    );
    expect(result.current.testCases.map((testCase) => testCase.status)).toEqual(['pass', 'pass']);
    unmount();
  });

  it('uses a case actual value as its expected output', async () => {
    const code = 'def solve(nums):\n    return 21';
    const imported = functionResult();
    const { result, unmount } = renderHook(() => useSession(code));

    act(() => result.current.importSession(code, imported, 0));
    act(() => result.current.addTestCase());

    requestMock.mockResolvedValueOnce(functionResult(num(21)));
    await act(async () => {
      await result.current.runTestCases();
    });
    expect(result.current.testCases[0]).toMatchObject({
      actual: '21',
      expected: '',
      status: 'ran',
    });

    act(() => {
      result.current.acceptTestCaseActual(result.current.testCases[0].id);
    });

    expect(result.current.testCases[0]).toMatchObject({
      actual: '21',
      expected: '21',
      status: 'pass',
    });
    unmount();
  });
});
