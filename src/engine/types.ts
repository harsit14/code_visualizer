/**
 * TypeScript mirror of the Python engine's JSON schema
 * (see engine/codeviz/serialize.py and runner.py).
 */

export type Language = 'python' | 'javascript' | 'typescript';

export type EncodedValue =
  | { k: 'none' }
  | { k: 'num'; t: string; v: string }
  | { k: 'str'; v: string; len?: number; truncated: boolean }
  | {
      k: 'seq';
      t: string;
      id: number;
      items: EncodedValue[];
      len: number;
      truncated: boolean;
    }
  | {
      k: 'dict';
      id: number;
      t?: string;
      entries: [EncodedValue, EncodedValue][];
      len: number;
      truncated: boolean;
    }
  | {
      k: 'tree';
      id: number;
      val: EncodedValue;
      left: EncodedValue | null;
      right: EncodedValue | null;
    }
  | {
      k: 'listnode';
      id: number;
      nodes: { id: number; val: EncodedValue }[];
      cyclic: boolean;
      truncated: boolean;
    }
  | { k: 'func'; name: string }
  | {
      k: 'obj';
      id: number;
      t: string;
      attrs: Record<string, EncodedValue>;
      preview: string;
    }
  | { k: 'ref'; id: number }
  | { k: 'repr'; t: string; v: string; id?: number };

export type FrameSnapshot = {
  id: string;
  func: string;
  qualname?: string;
  line: number;
  locals: Record<string, EncodedValue>;
  elided?: boolean;
};

export type TraceStep = {
  i: number;
  event: 'call' | 'line' | 'return' | 'exception';
  line: number;
  func: string;
  stack: FrameSnapshot[];
  globals: Record<string, EncodedValue>;
  stdoutLen: number;
  ret?: EncodedValue;
  exc?: { type: string; msg: string };
};

export type ParamInfo = {
  name: string;
  annotation: string | null;
  inferred: string;
  source: 'hint' | 'usage' | 'name' | 'default';
};

export type AssignmentHint = {
  target: string;
  line: number;
  statement: string;
  sources: string[];
};

export type FunctionInfo = {
  name: string;
  qualname: string;
  className: string | null;
  params: ParamInfo[];
  line: number;
  isGenerator: boolean;
  docstring: string | null;
  returns: string | null;
  pointerHints?: Record<string, string[]>;
  assignmentHints?: AssignmentHint[];
};

export type Diagnostic = {
  severity: 'error' | 'warning' | 'info';
  line?: number;
  column?: number;
  message: string;
};

export type AnalysisInfo = {
  mode: 'script' | 'function' | 'empty';
  functions: FunctionInfo[];
  defaultFunction: string | null;
  definesTreeNode: boolean;
  definesListNode: boolean;
  referencesTreeNode: boolean;
  referencesListNode: boolean;
  modulePointerHints?: Record<string, string[]>;
  moduleAssignmentHints?: AssignmentHint[];
  diagnostics: Diagnostic[];
};

export type GeneratedInputInfo = {
  name: string;
  type: string;
  literal: string;
};

export type EngineError = {
  type: string;
  msg: string;
  traceback?: string;
  line?: number;
};

export type RunInfo = {
  functionName: string | null;
  inputs: GeneratedInputInfo[];
  seed: number | null;
  steps: TraceStep[];
  returnValue: EncodedValue | null;
  exception: EngineError | null;
  setupError?: EngineError | null;
  stdout: string;
  stderr: string;
  opCount: number;
  runtimeMs: number;
  memoryMb: number | null;
  memoryIsEstimate?: boolean;
  truncated: boolean;
  truncationReason: string | null;
};

export type SessionResult = {
  status: 'ok' | 'error' | 'timeout';
  mode: 'script' | 'function' | 'empty';
  analysis: AnalysisInfo | null;
  run: RunInfo | null;
  error: EngineError | null;
  durationMs: number;
  pyodideVersion?: string;
};

export type ComplexitySample = { n: number; ops: number };

export type ComplexityResult = {
  functionName: string | null;
  seed: number | null;
  samples: ComplexitySample[];
  error: EngineError | null;
  truncated?: boolean;
  truncationReason?: string | null;
};

export type RunOptions = {
  mode?: 'script' | 'function';
  function?: string;
  inputs?: string[];
  seed?: number;
  maxSteps?: number;
  maxSeconds?: number;
};

export type EngineRequest =
  | { op: 'run'; source: string; options?: RunOptions }
  | { op: 'analyze'; source: string }
  | { op: 'complexity'; source: string; function?: string; seed?: number };

export type RuntimePhase = 'idle' | 'loading' | 'ready' | 'running' | 'interrupting' | 'restarting';

export type RuntimeStage =
  | 'idle'
  | 'runtime-loading'
  | 'engine-preparing'
  | 'analyzing'
  | 'instrumenting'
  | 'trace-generating'
  | 'executing'
  | 'ready'
  | 'interrupting'
  | 'restarting';

export type RuntimeStatus = {
  phase: RuntimePhase;
  message: string;
  interruptSupported: boolean;
  progress?: number;
  stage?: RuntimeStage;
};

export type WorkerInbound =
  | { type: 'setInterruptBuffer'; interruptBuffer: Uint8Array }
  | { type: 'request'; requestId: string; request: EngineRequest };

export type WorkerOutbound =
  | { type: 'status'; status: RuntimeStatus }
  | {
      type: 'response';
      requestId: string;
      data: unknown;
      durationMs: number;
    };
