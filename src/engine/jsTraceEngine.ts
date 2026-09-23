import { instrumentScript, JsSourceError, TRACE_RUNTIME } from './jsInstrument';
import { formatLogArgs, inspect } from './jsInspect';
import { Snapshotter, TraceLimitError } from './jsSnapshot';
import type {
  AnalysisInfo,
  EncodedValue,
  EngineError,
  FrameSnapshot,
  Language,
  RunInfo,
  SessionResult,
  TraceStep,
} from './types';

type JsLanguage = Extract<Language, 'javascript' | 'typescript'>;

const MODULE = '<module>';
const MAX_TRACE_STEPS = 3000;
const MAX_OUTPUT_CHARS = 100_000;
const MAX_DETAILED_FRAMES = 12;
const BYTES_PER_MB = 1024 * 1024;

type HeapPerformance = Performance & {
  memory?: {
    usedJSHeapSize?: number;
  };
};

function nowMs(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

function readHeapUsedBytes(): number | null {
  const heapBytes = (globalThis.performance as HeapPerformance | undefined)?.memory?.usedJSHeapSize;
  return Number.isFinite(heapBytes) ? (heapBytes as number) : null;
}

function serializedSizeMb(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length / BYTES_PER_MB;
}

function applyMemoryMetric(
  run: RunInfo,
  heapStartBytes: number | null,
  heapEndBytes: number | null,
) {
  if (heapStartBytes !== null && heapEndBytes !== null) {
    run.memoryMb = Math.max(0, heapEndBytes - heapStartBytes) / BYTES_PER_MB;
    run.memoryIsEstimate = false;
    return run;
  }

  run.memoryMb = serializedSizeMb({
    exception: run.exception,
    returnValue: run.returnValue,
    stderr: run.stderr,
    stdout: run.stdout,
    steps: run.steps,
  });
  run.memoryIsEstimate = true;
  return run;
}

function emptyAnalysis(): AnalysisInfo {
  return {
    mode: 'script',
    functions: [],
    defaultFunction: null,
    definesTreeNode: false,
    definesListNode: false,
    referencesTreeNode: false,
    referencesListNode: false,
    diagnostics: [],
  };
}

/** Reads `name`/`message` through descriptors so user getters never run. */
function errorInfo(error: unknown): { type: string; msg: string } {
  if (typeof error === 'object' && error !== null) {
    let name: unknown;
    let message: unknown;
    for (let current: object | null = error; current; current = Object.getPrototypeOf(current)) {
      const nameDescriptor = Object.getOwnPropertyDescriptor(current, 'name');
      if (name === undefined && nameDescriptor && 'value' in nameDescriptor) {
        name = nameDescriptor.value;
      }
      const messageDescriptor = Object.getOwnPropertyDescriptor(current, 'message');
      if (message === undefined && messageDescriptor && 'value' in messageDescriptor) {
        message = messageDescriptor.value;
      }
    }
    if (typeof message === 'string') {
      return { type: typeof name === 'string' ? name : 'Error', msg: message };
    }
  }
  return { type: 'Uncaught', msg: inspect(error) };
}

type Getter = readonly [string, () => unknown];

type LiveFrame = {
  id: string;
  func: string;
  qualname: string;
  line: number;
  base: readonly Getter[];
  block: readonly Getter[];
  returned: boolean;
  threw: boolean;
  /** Frames entered while the tracer itself runs user code (e.g. proxy traps). */
  ghost: boolean;
};

/** Receives calls from instrumented code and records Python-compatible steps. */
class TraceRecorder {
  readonly steps: TraceStep[] = [];
  stopped: TraceLimitError | null = null;
  stdout = '';
  stderr = '';
  private frames: LiveFrame[] = [];
  private nextFrameId = 0;
  private quiet = 0;
  private groupIndent = '';
  private counts = new Map<string, number>();
  private timers = new Map<string, number>();

  constructor(private readonly snapshotter: Snapshotter) {}

  private top(): LiveFrame | undefined {
    return this.frames[this.frames.length - 1];
  }

  /** Runs tracer work that may call back into user code without recording it. */
  private quietly<T>(work: () => T): T {
    this.quiet += 1;
    try {
      return work();
    } finally {
      this.quiet -= 1;
    }
  }

  private stop(reason: string): TraceLimitError {
    this.stopped ??= new TraceLimitError(reason);
    return this.stopped;
  }

  private locals(frame: LiveFrame): Record<string, EncodedValue> {
    const values = new Map<string, unknown>();
    for (const [name, read] of [...frame.base, ...frame.block]) {
      try {
        values.set(name, read());
      } catch {
        // Temporal dead zone: an uninitialized inner binding hides outer ones.
        values.delete(name);
      }
    }
    const locals: Record<string, EncodedValue> = {};
    for (const [name, value] of values) {
      if (value !== undefined) locals[name] = this.snapshotter.snapshot(value);
    }
    return locals;
  }

  private stack(): FrameSnapshot[] {
    const live = this.frames.filter((frame) => !frame.ghost);
    return live.map((frame, index) => {
      const detailed = live.length - 1 - index < MAX_DETAILED_FRAMES;
      return {
        id: frame.id,
        func: frame.func,
        qualname: frame.qualname,
        line: frame.line,
        locals: detailed ? this.locals(frame) : {},
        ...(detailed ? {} : { elided: true }),
      };
    });
  }

  private record(
    event: TraceStep['event'],
    line: number,
    extra: { ret?: unknown; hasRet?: boolean; exc?: TraceStep['exc'] } = {},
    force = false,
  ) {
    if (!force) {
      if (this.stopped) throw this.stopped;
      if (this.steps.length >= MAX_TRACE_STEPS) {
        throw this.stop(`Trace limit of ${MAX_TRACE_STEPS} steps reached; execution was stopped.`);
      }
    }
    try {
      this.quietly(() => {
        const stack = this.stack();
        const step: TraceStep = {
          i: this.steps.length,
          event,
          phase: event === 'line' ? 'before' : 'event',
          line,
          func: stack[stack.length - 1]?.func ?? MODULE,
          stack,
          globals: {},
          stdoutLen: this.stdout.length,
        };
        if (extra.hasRet) step.ret = this.snapshotter.snapshot(extra.ret);
        if (extra.exc) step.exc = extra.exc;
        this.steps.push(step);
      });
    } catch (error) {
      if (error instanceof TraceLimitError) {
        this.stopped ??= error;
        if (force) return;
      }
      throw error;
    }
  }

  readonly runtime = {
    enter: (func: string, qualname: string, line: number, base: readonly Getter[]) => {
      const frame: LiveFrame = {
        id: `js-frame-${this.nextFrameId++}`,
        func,
        qualname,
        line,
        base,
        block: [],
        returned: false,
        threw: false,
        ghost: this.quiet > 0,
      };
      this.frames.push(frame);
      if (!frame.ghost && func !== MODULE) this.record('call', line);
    },
    t: (line: number, block: readonly Getter[]) => {
      const frame = this.top();
      if (!frame || frame.ghost) return;
      frame.line = line;
      frame.block = block;
      this.record('line', line);
    },
    r: <T>(line: number, block: readonly Getter[], value: T): T => {
      const frame = this.top();
      if (frame && !frame.ghost) {
        frame.line = line;
        frame.block = block;
        frame.returned = true;
        this.record('return', line, { ret: value, hasRet: true });
      }
      return value;
    },
    x: (error: unknown) => {
      const frame = this.top();
      if (
        !frame ||
        frame.ghost ||
        frame.threw ||
        error instanceof TraceLimitError ||
        this.stopped
      ) {
        return;
      }
      frame.threw = true;
      this.record('exception', frame.line, { exc: this.quietly(() => errorInfo(error)) });
    },
    exit: (endLine: number) => {
      const frame = this.top();
      try {
        if (frame && !frame.ghost && !frame.returned && !frame.threw && !this.stopped) {
          frame.line = endLine;
          frame.block = [];
          this.record('return', endLine, { ret: undefined, hasRet: true });
        }
      } finally {
        this.frames.pop();
      }
    },
    c: (error: unknown) => {
      if (error instanceof TraceLimitError) throw error;
      if (this.stopped) throw this.stopped;
    },
  };

  /** Records the program's final state, like Python's module return event. */
  finish() {
    const frame = this.top();
    if (!frame || this.stopped) return;
    frame.block = [];
    this.record('return', frame.line, { ret: undefined, hasRet: true }, true);
  }

  /** Records an uncaught exception at the innermost remaining frame. */
  fail(error: unknown): EngineError {
    const info = this.quietly(() => errorInfo(error));
    const line = this.top()?.line ?? 1;
    this.record('exception', line, { exc: info }, true);
    return { ...info, line };
  }

  private write(stream: 'stdout' | 'stderr', args: readonly unknown[]) {
    const text = this.quietly(() => formatLogArgs(args));
    const indented = this.groupIndent
      ? text
          .split('\n')
          .map((line) => this.groupIndent + line)
          .join('\n')
      : text;
    const output = `${indented}\n`;
    const remaining = MAX_OUTPUT_CHARS - this[stream].length;
    this[stream] += output.slice(0, Math.max(0, remaining));
    if (output.length > remaining) throw this.stop('Output limit reached; execution was stopped.');
  }

  readonly console = {
    log: (...args: unknown[]) => this.write('stdout', args),
    info: (...args: unknown[]) => this.write('stdout', args),
    debug: (...args: unknown[]) => this.write('stdout', args),
    dir: (value: unknown) => this.write('stdout', [value]),
    table: (value: unknown) => this.write('stdout', [value]),
    warn: (...args: unknown[]) => this.write('stderr', args),
    error: (...args: unknown[]) => this.write('stderr', args),
    trace: (...args: unknown[]) =>
      this.write('stderr', [`Trace${args.length ? ': ' : ''}${formatLogArgs(args)}`]),
    assert: (condition?: unknown, ...args: unknown[]) => {
      if (condition) return;
      if (typeof args[0] === 'string') {
        this.write('stderr', [`Assertion failed: ${args[0]}`, ...args.slice(1)]);
      } else {
        this.write('stderr', args.length ? ['Assertion failed:', ...args] : ['Assertion failed']);
      }
    },
    count: (label = 'default') => {
      const count = (this.counts.get(String(label)) ?? 0) + 1;
      this.counts.set(String(label), count);
      this.write('stdout', [`${label}: ${count}`]);
    },
    countReset: (label = 'default') => {
      this.counts.delete(String(label));
    },
    group: (...args: unknown[]) => {
      if (args.length) this.write('stdout', args);
      this.groupIndent += '  ';
    },
    groupCollapsed: (...args: unknown[]) => {
      if (args.length) this.write('stdout', args);
      this.groupIndent += '  ';
    },
    groupEnd: () => {
      this.groupIndent = this.groupIndent.slice(0, -2);
    },
    time: (label = 'default') => {
      this.timers.set(String(label), nowMs());
    },
    timeLog: (label = 'default', ...args: unknown[]) => {
      const started = this.timers.get(String(label));
      if (started === undefined) return;
      this.write('stdout', [`${label}: ${(nowMs() - started).toFixed(3)}ms`, ...args]);
    },
    timeEnd: (label = 'default') => {
      const started = this.timers.get(String(label));
      if (started === undefined) return;
      this.timers.delete(String(label));
      this.write('stdout', [`${label}: ${(nowMs() - started).toFixed(3)}ms`]);
    },
  };
}

/**
 * Minimal TypeScript erasure used until a full TypeScript transform replaces it.
 * Only simple annotations are supported; anything left over is reported by the parser.
 */
function stripTypeScript(source: string): string {
  return source
    .replace(/^\s*interface\s+\w+\s*{[\s\S]*?}\s*/gm, '')
    .replace(/^\s*type\s+\w+\s*=[^;]+;\s*/gm, '')
    .replace(/(\bfunction\s*[\w$]*)\s*<[^>()]*>/g, '$1')
    .replace(/\)\s*:\s*[A-Za-z_$][\w$<>,\s.[\]|&?]*?\s*(?=\{|=>)/g, ') ')
    .replace(/\b(const|let|var)\s+([A-Za-z_$][\w$]*)\s*:\s*[^=;]+(?=[=;])/g, '$1 $2 ')
    .replace(/([(,]\s*[A-Za-z_$][\w$]*)\??\s*:\s*[^=,(){}]+(?=[=,)])/g, '$1')
    .replace(/\s+as\s+[A-Za-z_$][\w$<>,\s.[\]|&?]*/g, '')
    .replace(/([\w$\])])!(?=[.[)\s;,])/g, '$1');
}

export function instrumentJavaScript(source: string, language: JsLanguage): string {
  return instrumentScript(language === 'typescript' ? stripTypeScript(source) : source);
}

function runInfo(recorder: TraceRecorder, runtimeMs: number): RunInfo {
  return {
    functionName: null,
    inputs: [],
    seed: null,
    steps: recorder.steps,
    returnValue: null,
    exception: null,
    setupError: null,
    stdout: recorder.stdout,
    stderr: recorder.stderr,
    opCount: recorder.steps.length,
    runtimeMs,
    memoryMb: null,
    memoryIsEstimate: true,
    truncated: false,
    truncationReason: null,
  };
}

export function runJavaScriptTrace(source: string, language: JsLanguage): SessionResult {
  const startedAt = nowMs();
  const analysis = emptyAnalysis();
  let code: string;
  try {
    code = instrumentJavaScript(source, language);
  } catch (error) {
    const sourceError =
      error instanceof JsSourceError
        ? error
        : new JsSourceError(
            'SyntaxError',
            error instanceof Error ? error.message : String(error),
            1,
          );
    analysis.mode = 'empty';
    analysis.diagnostics = [
      {
        severity: 'error',
        line: sourceError.line,
        ...(sourceError.column === null ? {} : { column: sourceError.column }),
        message: sourceError.message,
      },
    ];
    return {
      status: 'error',
      mode: 'script',
      analysis,
      run: null,
      error: { type: sourceError.kind, msg: sourceError.message, line: sourceError.line },
      durationMs: nowMs() - startedAt,
    };
  }

  const recorder = new TraceRecorder(new Snapshotter());
  let runtimeMs = 0;
  let heapStartBytes: number | null = null;
  let heapEndBytes: number | null = null;
  let failure: unknown = null;
  let failed = false;
  try {
    const program = new Function('console', TRACE_RUNTIME, code) as (
      shim: TraceRecorder['console'],
      runtime: TraceRecorder['runtime'],
    ) => void;
    heapStartBytes = readHeapUsedBytes();
    const executionStartedAt = nowMs();
    try {
      program(recorder.console, recorder.runtime);
    } finally {
      runtimeMs = Math.max(0, nowMs() - executionStartedAt);
      heapEndBytes = readHeapUsedBytes();
    }
  } catch (error) {
    failed = true;
    failure = error;
  }
  heapEndBytes ??= readHeapUsedBytes();

  const run = runInfo(recorder, runtimeMs);
  if (recorder.stopped || failure instanceof TraceLimitError) {
    run.truncated = true;
    run.truncationReason = (recorder.stopped ?? (failure as TraceLimitError)).message;
    return {
      status: 'ok',
      mode: 'script',
      analysis,
      run: applyMemoryMetric(run, heapStartBytes, heapEndBytes),
      error: null,
      durationMs: nowMs() - startedAt,
    };
  }
  if (failed) {
    const error = recorder.fail(failure);
    run.exception = error;
    run.opCount = recorder.steps.length;
    return {
      status: 'error',
      mode: 'script',
      analysis,
      run: applyMemoryMetric(run, heapStartBytes, heapEndBytes),
      error,
      durationMs: nowMs() - startedAt,
    };
  }
  recorder.finish();
  run.opCount = recorder.steps.length;
  return {
    status: 'ok',
    mode: 'script',
    analysis,
    run: applyMemoryMetric(run, heapStartBytes, heapEndBytes),
    error: null,
    durationMs: nowMs() - startedAt,
  };
}
