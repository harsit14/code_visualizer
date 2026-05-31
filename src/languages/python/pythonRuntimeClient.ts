import type {
  PythonRunError,
  PythonRunOptions,
  PythonRunResult,
  PythonRuntimeStatus,
  PythonWorkerInbound,
  PythonWorkerOutbound,
} from './runtimeTypes';

type PendingRun = {
  didTimeout: boolean;
  fallbackTimeoutId?: number;
  interruptMode: PythonRunResult['interruptMode'];
  reject: (error: Error) => void;
  requestId: string;
  resolve: (result: PythonRunResult) => void;
  startedAt: number;
  timeoutId?: number;
  timeoutMs: number;
};

type PythonRuntimeClientOptions = {
  onStatus?: (status: PythonRuntimeStatus) => void;
};

const DEFAULT_TIMEOUT_MS = 5000;
const INTERRUPT_GRACE_MS = 1400;

let requestCounter = 0;

export function canUseSharedInterruptBuffer() {
  return typeof SharedArrayBuffer !== 'undefined' && globalThis.crossOriginIsolated === true;
}

export function createTimeoutResult(
  requestId: string,
  timeoutMs: number,
  interruptMode: PythonRunResult['interruptMode'],
  durationMs: number,
): PythonRunResult {
  return {
    requestId,
    status: 'timeout',
    stdout: '',
    stderr: '',
    traceEvents: [],
    diagnostics: [],
    durationMs,
    interruptMode,
    error: {
      name: 'ExecutionTimeout',
      message: `Python execution exceeded ${timeoutMs}ms and was stopped.`,
    },
  };
}

export class PythonRuntimeClient {
  private interruptBuffer: Uint8Array | null = null;
  private pendingRun: PendingRun | null = null;
  private worker: Worker | null = null;

  constructor(private readonly options: PythonRuntimeClientOptions = {}) {}

  run(source: string, options: PythonRunOptions = {}) {
    if (this.pendingRun) {
      return Promise.reject(new Error('Python runtime is already running code.'));
    }

    const worker = this.ensureWorker();
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const requestId = `python-run-${Date.now()}-${++requestCounter}`;
    const startedAt = performance.now();
    const interruptMode = this.interruptBuffer ? 'shared-array-buffer' : 'worker-terminate';

    if (this.interruptBuffer) {
      this.interruptBuffer[0] = 0;
    }

    const outbound: PythonWorkerInbound = {
      type: 'run',
      requestId,
      source,
    };

    return new Promise<PythonRunResult>((resolve, reject) => {
      this.pendingRun = {
        didTimeout: false,
        interruptMode,
        reject,
        requestId,
        resolve,
        startedAt,
        timeoutMs,
      };

      worker.postMessage(outbound);
    });
  }

  dispose() {
    this.clearPendingTimers();
    this.pendingRun = null;
    this.worker?.terminate();
    this.worker = null;
    this.interruptBuffer = null;
  }

  private ensureWorker() {
    if (this.worker) {
      return this.worker;
    }

    this.worker = new Worker(new URL('./pyodideWorker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (event: MessageEvent<PythonWorkerOutbound>) =>
      this.handleWorkerMessage(event.data);
    this.worker.onerror = (event) => {
      this.resolveWithRuntimeError({
        name: 'WorkerError',
        message: event.message,
      });
    };
    this.configureInterruptBuffer();

    return this.worker;
  }

  private configureInterruptBuffer() {
    if (!this.worker || !canUseSharedInterruptBuffer()) {
      this.interruptBuffer = null;
      this.options.onStatus?.({
        phase: 'idle',
        message: 'Python worker ready; timeout fallback will restart the worker',
        interruptSupported: false,
      });
      return;
    }

    this.interruptBuffer = new Uint8Array(new SharedArrayBuffer(1));
    this.worker.postMessage({
      type: 'setInterruptBuffer',
      interruptBuffer: this.interruptBuffer,
    } satisfies PythonWorkerInbound);
    this.options.onStatus?.({
      phase: 'idle',
      message: 'Python worker ready with interrupt support',
      interruptSupported: true,
    });
  }

  private handleWorkerMessage(message: PythonWorkerOutbound) {
    if (message.type === 'status') {
      this.options.onStatus?.(message.status);
      if (message.status.phase === 'running') {
        this.armExecutionTimeout();
      }
      return;
    }

    const pending = this.pendingRun;
    if (!pending || pending.requestId !== message.requestId) {
      return;
    }

    this.clearPendingTimers();
    const normalizedResult = this.normalizeResultAfterTimeout(message.result, pending);
    this.pendingRun = null;
    pending.resolve(normalizedResult);
  }

  private handleTimeout(requestId: string) {
    const pending = this.pendingRun;
    if (!pending || pending.requestId !== requestId) {
      return;
    }

    pending.didTimeout = true;

    if (this.interruptBuffer) {
      this.interruptBuffer[0] = 2;
      this.options.onStatus?.({
        phase: 'interrupting',
        message: 'Execution timed out; sending KeyboardInterrupt',
        interruptSupported: true,
      });

      pending.fallbackTimeoutId = window.setTimeout(() => {
        if (this.pendingRun?.requestId === requestId) {
          this.resolveWithTimeout(true);
        }
      }, INTERRUPT_GRACE_MS);
      return;
    }

    this.resolveWithTimeout(true);
  }

  private armExecutionTimeout() {
    const pending = this.pendingRun;
    if (!pending || pending.timeoutId) {
      return;
    }

    pending.timeoutId = window.setTimeout(() => {
      this.handleTimeout(pending.requestId);
    }, pending.timeoutMs);
  }

  private normalizeResultAfterTimeout(
    result: PythonRunResult,
    pending: PendingRun,
  ): PythonRunResult {
    const durationMs = performance.now() - pending.startedAt;

    if (pending.didTimeout || result.error?.name === 'KeyboardInterrupt') {
      return {
        ...result,
        status: 'timeout',
        durationMs,
        interruptMode: pending.interruptMode,
        error: result.error ?? {
          name: 'ExecutionTimeout',
          message: `Python execution exceeded ${pending.timeoutMs}ms and was interrupted.`,
        },
      };
    }

    return {
      ...result,
      durationMs,
      interruptMode: pending.interruptMode,
    };
  }

  private resolveWithTimeout(restartWorker: boolean) {
    const pending = this.pendingRun;
    if (!pending) {
      return;
    }

    this.options.onStatus?.({
      phase: 'restarting',
      message: 'Execution timed out; restarting Python worker',
      interruptSupported: Boolean(this.interruptBuffer),
    });
    this.clearPendingTimers();
    this.pendingRun = null;

    const result = createTimeoutResult(
      pending.requestId,
      pending.timeoutMs,
      pending.interruptMode,
      performance.now() - pending.startedAt,
    );

    if (restartWorker) {
      this.restartWorker();
    }

    pending.resolve(result);
  }

  private resolveWithRuntimeError(error: PythonRunError) {
    const pending = this.pendingRun;
    if (!pending) {
      return;
    }

    this.clearPendingTimers();
    this.pendingRun = null;
    this.restartWorker();
    pending.resolve({
      requestId: pending.requestId,
      status: 'error',
      stdout: '',
      stderr: '',
      traceEvents: [],
      diagnostics: [],
      durationMs: performance.now() - pending.startedAt,
      interruptMode: pending.interruptMode,
      error,
    });
  }

  private clearPendingTimers() {
    if (!this.pendingRun) {
      return;
    }

    if (this.pendingRun.timeoutId) {
      window.clearTimeout(this.pendingRun.timeoutId);
    }
    if (this.pendingRun.fallbackTimeoutId) {
      window.clearTimeout(this.pendingRun.fallbackTimeoutId);
    }
  }

  private restartWorker() {
    this.worker?.terminate();
    this.worker = null;
    this.interruptBuffer = null;
  }
}
