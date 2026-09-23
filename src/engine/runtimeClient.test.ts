// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ExecutionCancelledError,
  RuntimeClient,
  RuntimeStartupError,
  TimeoutError,
} from './runtimeClient';
import type { RuntimeStatus, WorkerOutbound } from './types';

class TestWorker {
  static instances: TestWorker[] = [];
  onmessage: ((event: { data: WorkerOutbound }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    TestWorker.instances.push(this);
  }
  emit(message: WorkerOutbound) {
    this.onmessage?.({ data: message });
  }
  ready() {
    this.emit({
      type: 'status',
      status: { phase: 'ready', message: 'Python ready', interruptSupported: false },
    });
  }
  get requestId(): string {
    return this.postMessage.mock.calls.find(([m]) => m.type === 'request')![0].requestId;
  }
}
const latest = () => TestWorker.instances.at(-1)!;
beforeEach(() => {
  vi.useFakeTimers();
  TestWorker.instances = [];
  vi.stubGlobal('Worker', TestWorker);
  vi.stubGlobal('crossOriginIsolated', false);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Python runtime recovery', () => {
  it('bounds silent prewarming and permits an explicit retry', () => {
    const statuses: RuntimeStatus[] = [];
    const client = new RuntimeClient({ startupTimeoutMs: 100, onStatus: (s) => statuses.push(s) });
    client.prewarm();
    const old = latest();
    vi.advanceTimersByTime(100);
    expect(old.terminate).toHaveBeenCalledOnce();
    expect(statuses.at(-1)?.phase).toBe('error');
    client.retry();
    expect(latest()).not.toBe(old);
    expect(latest().postMessage.mock.calls.map(([m]) => m.type)).toEqual(['prewarm']);
    latest().ready();
    vi.advanceTimersByTime(100);
    expect(statuses.at(-1)?.phase).toBe('ready');
    client.dispose();
  });

  it('rejects a request whose runtime never finishes loading', async () => {
    const client = new RuntimeClient({ startupTimeoutMs: 100 });
    const assertion = expect(client.request({ op: 'run', source: 'pass' })).rejects.toBeInstanceOf(
      RuntimeStartupError,
    );
    vi.advanceTimersByTime(100);
    await assertion;
    expect(latest().terminate).toHaveBeenCalledOnce();
  });

  it('bounds a warm request even without a running status', async () => {
    const client = new RuntimeClient();
    client.prewarm();
    latest().ready();
    const assertion = expect(
      client.request({ op: 'run', source: 'pass' }, { timeoutMs: 10 }),
    ).rejects.toBeInstanceOf(TimeoutError);
    vi.advanceTimersByTime(10);
    await assertion;
    expect(latest().terminate).toHaveBeenCalledOnce();
  });

  it('cancels immediately, rejects disposal, and ignores stale worker messages', async () => {
    const statuses: RuntimeStatus[] = [];
    const client = new RuntimeClient({ onStatus: (s) => statuses.push(s) });
    const cancelled = expect(client.request({ op: 'run', source: 'pass' })).rejects.toBeInstanceOf(
      ExecutionCancelledError,
    );
    const old = latest();
    client.cancel();
    await cancelled;
    const next = client.request({ op: 'run', source: 'print(2)' });
    const worker = latest();
    old.emit({ type: 'response', requestId: worker.requestId, data: 'stale', durationMs: 1 });
    old.emit({ type: 'runtime-error', message: 'late crash' });
    expect(statuses.at(-1)?.phase).toBe('loading');
    worker.ready();
    worker.emit({ type: 'response', requestId: worker.requestId, data: 'current', durationMs: 1 });
    await expect(next).resolves.toBe('current');
    const disposed = expect(
      client.request({ op: 'analyze', source: 'pass' }),
    ).rejects.toBeInstanceOf(ExecutionCancelledError);
    client.dispose();
    await disposed;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('handles boot failure without retaining a rejected runtime', async () => {
    const client = new RuntimeClient();
    const assertion = expect(client.request({ op: 'run', source: 'pass' })).rejects.toThrow(
      'download failed',
    );
    latest().emit({ type: 'runtime-error', message: 'download failed' });
    await assertion;
    client.retry();
    expect(TestWorker.instances).toHaveLength(2);
    latest().ready();
    client.dispose();
  });

  it('settles requests after worker messaging or dispatch failures', async () => {
    const client = new RuntimeClient();
    client.prewarm();
    latest().ready();
    latest().postMessage.mockImplementationOnce(() => {
      throw new Error('dispatch failed');
    });
    await expect(client.request({ op: 'run', source: 'pass' })).rejects.toThrow('dispatch failed');
    const assertion = expect(client.request({ op: 'analyze', source: 'pass' })).rejects.toThrow(
      'unreadable',
    );
    latest().onmessageerror?.();
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('recovers from a worker constructor failure', async () => {
    const statuses: RuntimeStatus[] = [];
    const client = new RuntimeClient({ onStatus: (s) => statuses.push(s) });
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new Error('worker blocked');
        }
      },
    );
    await expect(client.request({ op: 'run', source: 'pass' })).rejects.toThrow('worker blocked');
    expect(statuses.at(-1)?.phase).toBe('error');
    vi.stubGlobal('Worker', TestWorker);
    client.retry();
    latest().ready();
    expect(statuses.at(-1)?.phase).toBe('ready');
    client.dispose();
  });

  it('terminates after the shared-buffer interrupt grace period', async () => {
    vi.stubGlobal('crossOriginIsolated', true);
    const client = new RuntimeClient();
    client.prewarm();
    latest().ready();
    const worker = latest();
    const buffer = worker.postMessage.mock.calls.find(([m]) => m.type === 'setInterruptBuffer')![0]
      .interruptBuffer as Uint8Array;
    const assertion = expect(
      client.request({ op: 'run', source: 'while True: pass' }, { timeoutMs: 10 }),
    ).rejects.toBeInstanceOf(TimeoutError);
    vi.advanceTimersByTime(10);
    expect(Atomics.load(buffer, 0)).toBe(2);
    expect(worker.terminate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1500);
    await assertion;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('reports a timeout even if an interrupted worker returns during the grace period', async () => {
    vi.stubGlobal('crossOriginIsolated', true);
    const client = new RuntimeClient();
    client.prewarm();
    latest().ready();
    const assertion = expect(
      client.request({ op: 'run', source: 'pass' }, { timeoutMs: 10 }),
    ).rejects.toBeInstanceOf(TimeoutError);
    vi.advanceTimersByTime(10);
    latest().emit({
      type: 'response',
      requestId: latest().requestId,
      data: { error: { type: 'KeyboardInterrupt' } },
      durationMs: 10,
    });
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
});
