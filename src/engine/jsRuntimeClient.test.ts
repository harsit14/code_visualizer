// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runJavaScriptInWorker } from './jsRuntimeClient';
import { ExecutionCancelledError } from './runtimeClient';

class TestWorker {
  static instances: TestWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    TestWorker.instances.push(this);
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  TestWorker.instances = [];
  vi.stubGlobal('Worker', TestWorker);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('JavaScript worker lifecycle', () => {
  it('terminates on Stop and ignores late responses', async () => {
    const controller = new AbortController();
    const promise = runJavaScriptInWorker('while(true) {}', 'javascript', 100, controller.signal);
    const assertion = expect(promise).rejects.toBeInstanceOf(ExecutionCancelledError);
    const worker = TestWorker.instances[0];
    controller.abort();
    worker.onmessage?.({ data: { status: 'ok' } });
    await assertion;
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not launch an already cancelled request', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runJavaScriptInWorker('', 'javascript', 10, controller.signal),
    ).rejects.toBeInstanceOf(ExecutionCancelledError);
    expect(TestWorker.instances).toHaveLength(0);
  });
  it('reports the correct language on timeout', async () => {
    const assertion = expect(runJavaScriptInWorker('', 'typescript', 10)).rejects.toThrow(
      'TypeScript execution exceeded',
    );
    vi.advanceTimersByTime(10);
    await assertion;
    expect(TestWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });
  it('cleans up unreadable responses', async () => {
    const assertion = expect(runJavaScriptInWorker('', 'javascript', 10)).rejects.toThrow(
      'unreadable',
    );
    TestWorker.instances[0].onmessageerror?.();
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
});
