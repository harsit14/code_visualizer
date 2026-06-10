/**
 * Main-thread client for the Pyodide worker.
 *
 * Serializes requests (one in flight at a time), applies a wall-clock
 * timeout with SharedArrayBuffer interrupt support when cross-origin
 * isolated, and falls back to restarting the worker otherwise.
 */
import type {
  EngineRequest,
  RuntimeStatus,
  WorkerInbound,
  WorkerOutbound,
} from './types';

export type InterruptMode = 'shared-array-buffer' | 'worker-terminate' | 'none';

type PendingRequest = {
  requestId: string;
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  startedAt: number;
  timeoutMs: number;
  timeoutId?: number;
  fallbackTimeoutId?: number;
  didTimeout: boolean;
};

type RuntimeClientOptions = {
  onStatus?: (status: RuntimeStatus) => void;
};

const DEFAULT_TIMEOUT_MS = 15000;
const INTERRUPT_GRACE_MS = 1500;

let requestCounter = 0;

export function canUseSharedInterruptBuffer(): boolean {
  return typeof SharedArrayBuffer !== 'undefined' && globalThis.crossOriginIsolated === true;
}

export class TimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Python execution exceeded ${timeoutMs}ms and was stopped.`);
    this.name = 'TimeoutError';
  }
}

export class RuntimeClient {
  private worker: Worker | null = null;
  private interruptBuffer: Uint8Array | null = null;
  private pending: PendingRequest | null = null;

  constructor(private readonly options: RuntimeClientOptions = {}) {}

  get interruptMode(): InterruptMode {
    return this.interruptBuffer ? 'shared-array-buffer' : 'worker-terminate';
  }

  request(request: EngineRequest, options: { timeoutMs?: number } = {}): Promise<unknown> {
    if (this.pending) {
      return Promise.reject(new Error('The Python runtime is already busy.'));
    }

    const worker = this.ensureWorker();
    const requestId = `req-${Date.now()}-${++requestCounter}`;

    if (this.interruptBuffer) {
      this.interruptBuffer[0] = 0;
    }

    return new Promise<unknown>((resolve, reject) => {
      this.pending = {
        requestId,
        resolve,
        reject,
        startedAt: performance.now(),
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        didTimeout: false,
      };

      worker.postMessage({ type: 'request', requestId, request } satisfies WorkerInbound);
    });
  }

  dispose() {
    this.clearTimers();
    this.pending = null;
    this.worker?.terminate();
    this.worker = null;
    this.interruptBuffer = null;
  }

  private ensureWorker(): Worker {
    if (this.worker) {
      return this.worker;
    }

    this.worker = new Worker(new URL('./pyodideWorker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (event: MessageEvent<WorkerOutbound>) =>
      this.handleMessage(event.data);
    this.worker.onerror = (event) => {
      this.failPending(new Error(event.message || 'Python worker crashed.'));
      this.restartWorker();
    };
    this.configureInterruptBuffer();

    return this.worker;
  }

  private configureInterruptBuffer() {
    if (!this.worker || !canUseSharedInterruptBuffer()) {
      this.interruptBuffer = null;
      return;
    }

    this.interruptBuffer = new Uint8Array(new SharedArrayBuffer(1));
    this.worker.postMessage({
      type: 'setInterruptBuffer',
      interruptBuffer: this.interruptBuffer,
    } satisfies WorkerInbound);
  }

  private handleMessage(message: WorkerOutbound) {
    if (message.type === 'status') {
      this.options.onStatus?.(message.status);
      if (message.status.phase === 'running') {
        this.armTimeout();
      }
      return;
    }

    const pending = this.pending;
    if (!pending || pending.requestId !== message.requestId) {
      return;
    }

    this.clearTimers();
    this.pending = null;
    pending.resolve(message.data);
  }

  private armTimeout() {
    const pending = this.pending;
    if (!pending || pending.timeoutId) {
      return;
    }

    pending.timeoutId = window.setTimeout(() => {
      this.handleTimeout(pending.requestId);
    }, pending.timeoutMs);
  }

  private handleTimeout(requestId: string) {
    const pending = this.pending;
    if (!pending || pending.requestId !== requestId) {
      return;
    }

    pending.didTimeout = true;

    if (this.interruptBuffer) {
      // 2 == SIGINT; Pyodide raises KeyboardInterrupt inside Python, which
      // the engine reports as a normal error payload.
      this.interruptBuffer[0] = 2;
      this.options.onStatus?.({
        phase: 'interrupting',
        message: 'Execution timed out; interrupting',
        interruptSupported: true,
      });

      pending.fallbackTimeoutId = window.setTimeout(() => {
        if (this.pending?.requestId === requestId) {
          this.abortWithTimeout();
        }
      }, INTERRUPT_GRACE_MS);
      return;
    }

    this.abortWithTimeout();
  }

  private abortWithTimeout() {
    const pending = this.pending;
    if (!pending) {
      return;
    }

    this.options.onStatus?.({
      phase: 'restarting',
      message: 'Execution timed out; restarting Python worker',
      interruptSupported: Boolean(this.interruptBuffer),
    });
    this.clearTimers();
    this.pending = null;
    this.restartWorker();
    pending.reject(new TimeoutError(pending.timeoutMs));
  }

  private failPending(error: Error) {
    const pending = this.pending;
    if (!pending) {
      return;
    }

    this.clearTimers();
    this.pending = null;
    pending.reject(error);
  }

  private clearTimers() {
    if (!this.pending) {
      return;
    }
    if (this.pending.timeoutId) {
      window.clearTimeout(this.pending.timeoutId);
    }
    if (this.pending.fallbackTimeoutId) {
      window.clearTimeout(this.pending.fallbackTimeoutId);
    }
  }

  private restartWorker() {
    this.worker?.terminate();
    this.worker = null;
    this.interruptBuffer = null;
  }
}
