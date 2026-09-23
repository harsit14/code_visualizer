import type { AnalysisInfo, EncodedValue, Language, SessionResult, TraceStep } from './types';

type JsLanguage = Extract<Language, 'javascript' | 'typescript'>;

const USER_FUNC = '__codeviz_user__';
const MAX_ITEMS = 24;
const MAX_STRING = 160;
const MAX_DEPTH = 4;
const MAX_TRACE_STEPS = 3000;
const MAX_OUTPUT_CHARS = 100_000;
const MAX_SNAPSHOT_NODES = 200_000;

class TraceLimitError extends Error {}
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
  run: NonNullable<SessionResult['run']>,
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

function errorPayload(error: unknown) {
  return {
    type: error instanceof Error ? error.name : 'Error',
    msg: error instanceof Error ? error.message : String(error),
  };
}

function stripTypeScript(source: string): string {
  return source
    .replace(/^\s*interface\s+\w+\s*{[\s\S]*?}\s*/gm, '')
    .replace(/^\s*type\s+\w+\s*=[^;]+;\s*/gm, '')
    .replace(/\)\s*:\s*[A-Za-z_$][\w$<>,\s.[\]|&?]*\s*{/g, ') {')
    .replace(/\b([A-Za-z_$][\w$]*)\s*:\s*[^=,);{]+(?=[=,);{])/g, '$1')
    .replace(/\s+as\s+[A-Za-z_$][\w$<>,\s.[\]|&?]*/g, '');
}

function countChar(text: string, char: string): number {
  return [...text].filter((item) => item === char).length;
}

function cleanParamName(param: string): string | null {
  const name = param.trim().replace(/=.*$/, '').trim();
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : null;
}

function namesFromLine(line: string): string[] {
  const names: string[] = [];
  const declaration = line.match(/\b(?:let|const|var)\s+([^;]+)/);
  if (declaration) {
    for (const part of declaration[1].split(',')) {
      const match = part.trim().match(/^([A-Za-z_$][\w$]*)/);
      if (match) {
        names.push(match[1]);
      }
    }
  }

  const functionMatch = line.match(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/);
  if (functionMatch) {
    names.push(functionMatch[1]);
    for (const param of functionMatch[2].split(',')) {
      const name = cleanParamName(param);
      if (name) {
        names.push(name);
      }
    }
  }

  const arrowMatch = line.match(
    /\b(?:let|const|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\(([^)]*)\)|([A-Za-z_$][\w$]*))\s*=>/,
  );
  if (arrowMatch) {
    names.push(arrowMatch[1]);
    const params = arrowMatch[2] ?? arrowMatch[3] ?? '';
    for (const param of params.split(',')) {
      const name = cleanParamName(param);
      if (name) {
        names.push(name);
      }
    }
  }

  return names;
}

function traceCall(lineNumber: number, names: readonly string[]): string {
  const entries = names
    .map((name) => `["${name}", (typeof ${name} === "undefined" ? undefined : ${name})]`)
    .join(',');
  return `__trace(${lineNumber}, [${entries}]);`;
}

export function instrumentJavaScript(source: string, language: JsLanguage): string {
  const normalized = language === 'typescript' ? stripTypeScript(source) : source;
  const lines = normalized.replace(/\r\n?/g, '\n').split('\n');
  const names = new Set<string>();
  const output = ['"use strict";', 'const console = __console;'];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    output.push(line);
    for (const name of namesFromLine(line)) {
      names.add(name);
    }
    const trimmed = line.trim();
    if (
      trimmed === '' ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*') ||
      trimmed.endsWith(',') ||
      countChar(line, '`') % 2 === 1
    ) {
      continue;
    }
    output.push(traceCall(index + 1, [...names]));
  }

  return output.join('\n');
}

class Snapshotter {
  private ids = new WeakMap<object, number>();
  private nextId = 1;
  private nodes = 0;

  snapshot(value: unknown, depth = 0, active = new Set<object>()): EncodedValue {
    if (++this.nodes > MAX_SNAPSHOT_NODES)
      throw new TraceLimitError('Snapshot size limit reached; execution was stopped.');
    if (value === null || value === undefined) {
      return { k: 'repr', t: value === null ? 'null' : 'undefined', v: String(value) };
    }
    if (typeof value === 'number') {
      return { k: 'num', t: Number.isInteger(value) ? 'number' : 'number', v: String(value) };
    }
    if (typeof value === 'bigint') {
      return { k: 'num', t: 'bigint', v: value.toString() };
    }
    if (typeof value === 'boolean') {
      return { k: 'repr', t: 'boolean', v: String(value) };
    }
    if (typeof value === 'string') {
      return {
        k: 'str',
        v: value.slice(0, MAX_STRING),
        len: value.length,
        truncated: value.length > MAX_STRING,
      };
    }
    if (typeof value === 'function') {
      return { k: 'func', name: value.name || 'anonymous' };
    }
    if (typeof value !== 'object') {
      return { k: 'repr', t: typeof value, v: String(value) };
    }

    const existing = this.ids.get(value);
    if (active.has(value)) {
      return { k: 'ref', id: existing ?? this.nextId };
    }
    const id = existing ?? this.nextId++;
    this.ids.set(value, id);
    active = new Set([...active, value]);

    if (depth >= MAX_DEPTH) {
      return { k: 'repr', t: 'Object', v: '[Object]', id };
    }

    if (Array.isArray(value)) {
      return {
        k: 'seq',
        t: 'Array',
        id,
        items: value.slice(0, MAX_ITEMS).map((item) => this.snapshot(item, depth + 1, active)),
        len: value.length,
        truncated: value.length > MAX_ITEMS,
      };
    }

    if (value instanceof Map) {
      const entries: [EncodedValue, EncodedValue][] = [];
      for (const [key, item] of value) {
        if (entries.length >= MAX_ITEMS) break;
        entries.push([
          this.snapshot(key, depth + 1, active),
          this.snapshot(item, depth + 1, active),
        ]);
      }
      return {
        k: 'dict',
        id,
        t: 'Map',
        entries,
        len: value.size,
        truncated: value.size > MAX_ITEMS,
      };
    }

    const attrs: Record<string, EncodedValue> = {};
    const entries = Object.entries(Object.getOwnPropertyDescriptors(value)).slice(0, MAX_ITEMS);
    for (const [key, descriptor] of entries) {
      attrs[key] =
        'value' in descriptor
          ? this.snapshot(descriptor.value, depth + 1, active)
          : { k: 'repr', t: 'accessor', v: '[Getter/Setter]' };
    }
    return {
      k: 'obj',
      id,
      t: 'Object',
      attrs,
      preview: '{...}',
    };
  }
}

function encodeLocals(snapshotter: Snapshotter, entries: [string, unknown][]) {
  const locals: Record<string, EncodedValue> = {};
  for (const [name, value] of entries) {
    if (value !== undefined) {
      locals[name] = snapshotter.snapshot(value);
    }
  }
  return locals;
}

export function runJavaScriptTrace(source: string, language: JsLanguage): SessionResult {
  const startedAt = nowMs();
  const analysis = emptyAnalysis();
  const snapshotter = new Snapshotter();
  const steps: TraceStep[] = [];
  let stdout = '';
  let opCount = 0;
  let runtimeMs = 0;
  let heapStartBytes: number | null = null;
  let heapEndBytes: number | null = null;

  const trace = (line: number, entries: [string, unknown][]) => {
    if (steps.length >= MAX_TRACE_STEPS)
      throw new TraceLimitError(
        `Trace limit of ${MAX_TRACE_STEPS} steps reached; execution was stopped.`,
      );
    const locals = encodeLocals(snapshotter, entries);
    steps.push({
      i: steps.length,
      event: 'line',
      phase: 'after',
      line,
      func: USER_FUNC,
      stack: [
        {
          id: 'js-frame-0',
          func: USER_FUNC,
          qualname: USER_FUNC,
          line,
          locals,
        },
      ],
      globals: {},
      stdoutLen: stdout.length,
    });
    opCount += 1;
  };

  const consoleShim = {
    log: (...args: unknown[]) => {
      const output = `${args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')}\n`;
      const remaining = MAX_OUTPUT_CHARS - stdout.length;
      stdout += output.slice(0, remaining);
      if (output.length > remaining)
        throw new TraceLimitError('Output limit reached; execution was stopped.');
    },
  };

  try {
    const code = instrumentJavaScript(source, language);
    const userProgram = new Function('__trace', '__console', code);
    heapStartBytes = readHeapUsedBytes();
    const executionStartedAt = nowMs();
    try {
      userProgram(trace, consoleShim);
    } finally {
      runtimeMs = Math.max(0, nowMs() - executionStartedAt);
      heapEndBytes = readHeapUsedBytes();
    }
    const run = applyMemoryMetric(
      {
        functionName: null,
        inputs: [],
        seed: null,
        steps,
        returnValue: null,
        exception: null,
        setupError: null,
        stdout,
        stderr: '',
        opCount,
        runtimeMs,
        memoryMb: null,
        memoryIsEstimate: true,
        truncated: false,
        truncationReason: null,
      },
      heapStartBytes,
      heapEndBytes,
    );
    return {
      status: 'ok',
      mode: 'script',
      analysis,
      run,
      error: null,
      durationMs: nowMs() - startedAt,
    };
  } catch (error) {
    heapEndBytes ??= readHeapUsedBytes();
    if (error instanceof TraceLimitError) {
      return {
        status: 'ok',
        mode: 'script',
        analysis,
        error: null,
        durationMs: nowMs() - startedAt,
        run: applyMemoryMetric(
          {
            functionName: null,
            inputs: [],
            seed: null,
            steps,
            returnValue: null,
            exception: null,
            setupError: null,
            stdout,
            stderr: '',
            opCount,
            runtimeMs,
            memoryMb: null,
            memoryIsEstimate: true,
            truncated: true,
            truncationReason: error.message,
          },
          heapStartBytes,
          heapEndBytes,
        ),
      };
    }
    const payload = errorPayload(error);
    const line = steps.at(-1)?.line ?? 1;
    const exceptionStep: TraceStep = {
      i: steps.length,
      event: 'exception',
      line,
      func: USER_FUNC,
      stack: [
        {
          id: 'js-frame-0',
          func: USER_FUNC,
          qualname: USER_FUNC,
          line,
          locals: {},
        },
      ],
      globals: {},
      stdoutLen: stdout.length,
      exc: { type: payload.type, msg: payload.msg },
    };
    steps.push(exceptionStep);
    const run = applyMemoryMetric(
      {
        functionName: null,
        inputs: [],
        seed: null,
        steps,
        returnValue: null,
        exception: payload,
        setupError: null,
        stdout,
        stderr: '',
        opCount,
        runtimeMs,
        memoryMb: null,
        memoryIsEstimate: true,
        truncated: false,
        truncationReason: null,
      },
      heapStartBytes,
      heapEndBytes,
    );
    return {
      status: 'error',
      mode: 'script',
      analysis,
      run,
      error: payload,
      durationMs: nowMs() - startedAt,
    };
  }
}
