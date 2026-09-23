import {
  configuredRunnerUrl,
  createExecutionTransport,
  type ExecutionTransport,
} from '../runner/iframeTransport';
/** Python worker lifecycle with bounded startup, execution and explicit recovery. */
import type { EngineRequest, RuntimeStatus, WorkerInbound, WorkerOutbound } from './types';

export type InterruptMode = 'shared-array-buffer' | 'worker-terminate' | 'none';
type PendingRequest = {
  requestId: string;
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  timeoutMs: number;
  timeoutId?: number;
  fallbackTimeoutId?: number;
  didTimeout: boolean;
};
type RuntimeClientOptions = {
  onStatus?: (status: RuntimeStatus) => void;
  startupTimeoutMs?: number;
};
const DEFAULT_TIMEOUT_MS = 15_000;
const STARTUP_TIMEOUT_MS = 45_000;
const INTERRUPT_GRACE_MS = 1_500;
let requestCounter = 0;

export function canUseSharedInterruptBuffer(): boolean {
  return typeof SharedArrayBuffer !== 'undefined' && globalThis.crossOriginIsolated === true;
}
export class TimeoutError extends Error {
  constructor(timeoutMs: number, language = 'Python') {
    super(`${language} execution exceeded ${timeoutMs}ms and was stopped.`);
    this.name = 'TimeoutError';
  }
}
export class ExecutionCancelledError extends Error {
  constructor() {
    super('Execution stopped.');
    this.name = 'ExecutionCancelledError';
  }
}
export class RuntimeStartupError extends Error {
  constructor(message = 'Python runtime did not finish loading. Retry runtime to try again.') {
    super(message);
    this.name = 'RuntimeStartupError';
  }
}

export class RuntimeClient {
  private worker: ExecutionTransport | null = null;
  private ready = false;
  private startupTimer?: number;
  private interruptBuffer: Uint8Array | null = null;
  private pending: PendingRequest | null = null;
  private currentStatus: RuntimeStatus | null = null;
  private onStatus: RuntimeClientOptions['onStatus'];
  private startupTimeoutMs: number;

  constructor(options: RuntimeClientOptions = {}) {
    this.onStatus = options.onStatus;
    this.startupTimeoutMs = options.startupTimeoutMs ?? STARTUP_TIMEOUT_MS;
  }
  get interruptMode(): InterruptMode {
    return this.interruptBuffer ? 'shared-array-buffer' : 'worker-terminate';
  }

  request(request: EngineRequest, options: { timeoutMs?: number } = {}): Promise<unknown> {
    if (this.pending) return Promise.reject(new Error('The Python runtime is already busy.'));
    let worker: ExecutionTransport;
    try {
      worker = this.ensureWorker();
    } catch (error) {
      this.failRuntime(asError(error));
      return Promise.reject(error);
    }
    const requestId = `req-${Date.now()}-${++requestCounter}`;
    if (this.interruptBuffer) this.interruptBuffer[0] = 0;
    return new Promise<unknown>((resolve, reject) => {
      this.pending = {
        requestId,
        resolve,
        reject,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        didTimeout: false,
      };
      // A warm worker that goes silent is bounded even if it never emits "running".
      if (this.ready) this.armTimeout();
      try {
        worker.postMessage({ type: 'request', requestId, request } satisfies WorkerInbound);
      } catch (error) {
        this.failRuntime(asError(error));
      }
    });
  }

  prewarm() {
    try {
      this.ensureWorker().postMessage({ type: 'prewarm' } satisfies WorkerInbound);
    } catch (error) {
      this.failRuntime(asError(error));
    }
  }
  setStatusHandler(onStatus: RuntimeClientOptions['onStatus'], emitCurrent = false) {
    this.onStatus = onStatus;
    if (emitCurrent && this.currentStatus) onStatus?.(this.currentStatus);
  }
  cancel() {
    this.rejectPending(new ExecutionCancelledError());
    this.terminateWorker();
    this.setStatus({
      phase: 'idle',
      stage: 'idle',
      message: 'Stopped. Run when you’re ready.',
      interruptSupported: false,
    });
  }
  retry() {
    this.rejectPending(new ExecutionCancelledError());
    this.terminateWorker();
    this.prewarm();
  }
  dispose() {
    this.rejectPending(new ExecutionCancelledError());
    this.terminateWorker();
    this.currentStatus = null;
  }
  private setStatus(status: RuntimeStatus) {
    this.currentStatus = status;
    this.onStatus?.(status);
  }
  private ensureWorker(): ExecutionTransport {
    if (this.worker) return this.worker;
    const worker = createExecutionTransport('python');
    this.worker = worker;
    this.ready = false;
    this.setStatus({
      phase: 'loading',
      stage: 'runtime-loading',
      message: 'Loading Python runtime...',
      interruptSupported: false,
      progress: 0.05,
    });
    // Ignore queued messages/errors from a worker replaced by Stop, timeout or Retry.
    worker.onmessage = (event) => {
      if (this.worker === worker) this.handleMessage(event.data);
    };
    worker.onerror = (event) => {
      if (this.worker === worker)
        this.failRuntime(new Error(event.message || 'Python worker crashed.'));
    };
    worker.onmessageerror = () => {
      if (this.worker === worker)
        this.failRuntime(new Error('Python worker returned an unreadable message.'));
    };
    this.startupTimer = window.setTimeout(() => {
      if (this.worker === worker && !this.ready) this.failRuntime(new RuntimeStartupError());
    }, this.startupTimeoutMs);
    if (!configuredRunnerUrl() && canUseSharedInterruptBuffer()) {
      this.interruptBuffer = new Uint8Array(new SharedArrayBuffer(1));
      worker.postMessage({
        type: 'setInterruptBuffer',
        interruptBuffer: this.interruptBuffer,
      } satisfies WorkerInbound);
    }
    return worker;
  }

  private handleMessage(message: WorkerOutbound) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'runtime-error') {
      this.failRuntime(new RuntimeStartupError(message.message));
      return;
    }
    if (message.type === 'status') {
      if (!message.status || typeof message.status.message !== 'string') return;
      if (message.status.phase === 'ready' || message.status.phase === 'running') {
        this.ready = true;
        window.clearTimeout(this.startupTimer);
        this.startupTimer = undefined;
        this.armTimeout();
      }
      this.setStatus(message.status);
      return;
    }
    const pending = this.pending;
    if (message.type !== 'response' || !pending || pending.requestId !== message.requestId) return;
    this.clearRequestTimers();
    this.pending = null;
    if (pending.didTimeout) {
      this.terminateWorker();
      this.setStatus({
        phase: 'idle',
        stage: 'idle',
        message: 'Execution timed out. Run again to restart Python.',
        interruptSupported: false,
      });
      pending.reject(new TimeoutError(pending.timeoutMs));
    } else pending.resolve(message.data);
  }
  private armTimeout() {
    const pending = this.pending;
    if (!pending || pending.timeoutId !== undefined) return;
    pending.timeoutId = window.setTimeout(
      () => this.handleTimeout(pending.requestId),
      pending.timeoutMs,
    );
  }
  private handleTimeout(requestId: string) {
    const pending = this.pending;
    if (!pending || pending.requestId !== requestId) return;
    pending.didTimeout = true;
    if (this.interruptBuffer) {
      Atomics.store(this.interruptBuffer, 0, 2);
      this.setStatus({
        phase: 'interrupting',
        stage: 'interrupting',
        message: 'Execution timed out; interrupting',
        interruptSupported: true,
        progress: 0.96,
      });
      pending.fallbackTimeoutId = window.setTimeout(() => {
        if (this.pending === pending) this.abortWithTimeout();
      }, INTERRUPT_GRACE_MS);
    } else this.abortWithTimeout();
  }
  private abortWithTimeout() {
    const pending = this.pending;
    if (!pending) return;
    this.rejectPending(new TimeoutError(pending.timeoutMs));
    this.terminateWorker();
    this.setStatus({
      phase: 'idle',
      stage: 'idle',
      message: 'Execution timed out. Run again to restart Python.',
      interruptSupported: false,
    });
  }
  private failRuntime(error: Error) {
    this.rejectPending(error);
    this.terminateWorker();
    this.setStatus({
      phase: 'error',
      stage: 'error',
      message: error.message,
      interruptSupported: false,
    });
  }
  private rejectPending(error: Error) {
    const pending = this.pending;
    this.clearRequestTimers();
    this.pending = null;
    pending?.reject(error);
  }
  private clearRequestTimers() {
    window.clearTimeout(this.pending?.timeoutId);
    window.clearTimeout(this.pending?.fallbackTimeoutId);
  }
  private terminateWorker() {
    window.clearTimeout(this.startupTimer);
    this.startupTimer = undefined;
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    this.interruptBuffer = null;
  }
}
function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
