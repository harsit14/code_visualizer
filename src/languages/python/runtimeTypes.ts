export type PythonRunStatus = 'ok' | 'error' | 'timeout';

export type PythonRuntimePhase =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'running'
  | 'interrupting'
  | 'restarting';

export type PythonRunError = {
  name: string;
  message: string;
  traceback?: string;
};

export type PythonTraceEventType = 'call' | 'line' | 'return' | 'exception' | 'trace_limit';

export type PythonObjectKind = 'primitive' | 'collection' | 'function' | 'object';

export type PythonStaticNodeKind =
  | 'module'
  | 'function'
  | 'loop'
  | 'branch'
  | 'assignment'
  | 'call'
  | 'return'
  | 'statement';

export type PythonStaticDiagnostic = {
  column?: number;
  line?: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
};

export type PythonStaticNode = {
  id: string;
  kind: PythonStaticNodeKind;
  label: string;
  startLine: number;
  endLine: number;
  depth: number;
  parentId?: string;
  detail?: string;
  symbolNames: string[];
};

export type PythonStaticSymbol = {
  name: string;
  lines: number[];
  roles: string[];
};

export type PythonStaticSummary = {
  assignments: number;
  branches: number;
  functions: number;
  loops: number;
};

export type PythonStaticAnalysis = {
  diagnostics: PythonStaticDiagnostic[];
  lineToNodeIds: Record<string, string[]>;
  nodes: PythonStaticNode[];
  summary: PythonStaticSummary;
  symbols: PythonStaticSymbol[];
};

export type PythonObjectEntry = {
  key: string;
  keyPreview?: string;
  valuePreview: string;
  valueTypeName: string;
  objectId?: string;
};

export type PythonObjectSnapshot = {
  id: string;
  kind: PythonObjectKind;
  typeName: string;
  preview: string;
  size?: number;
  mutated: boolean;
  entries?: PythonObjectEntry[];
  entryCount?: number;
  truncated?: boolean;
};

export type PythonVariableSnapshot = {
  name: string;
  objectId: string;
  typeName: string;
  valuePreview: string;
  isNew: boolean;
  isChanged: boolean;
  isReferenceChanged: boolean;
};

export type PythonScopeSnapshot = {
  id: string;
  name: string;
  functionName: string;
  variables: PythonVariableSnapshot[];
};

export type PythonTraceChanges = {
  createdVariables: string[];
  updatedVariables: string[];
  referenceChangedVariables: string[];
  mutatedObjects: string[];
};

export type PythonLoopPhase = 'enter' | 'iterate' | 'body';

export type PythonLoopSnapshot = {
  loopId: string;
  label: string;
  startLine: number;
  endLine: number;
  depth: number;
  iteration: number;
  phase: PythonLoopPhase;
  changedVariables: string[];
  detail?: string;
  targetName?: string;
  targetValue?: string;
};

export type PythonLoopTransition = {
  loopId: string;
  label: string;
  startLine: number;
  endLine: number;
  depth: number;
  iteration: number;
  phase: 'exit';
};

export type PythonCallFrameStatus = 'entering' | 'active' | 'returning' | 'exception';

export type PythonCallFrameSnapshot = {
  frameId: string;
  functionName: string;
  displayName: string;
  depth: number;
  scopeId: string;
  line?: number;
  status: PythonCallFrameStatus;
  arguments: PythonVariableSnapshot[];
  variables: PythonVariableSnapshot[];
  returnValue?: string;
};

export type PythonFunctionTransition = {
  frameId: string;
  functionName: string;
  depth: number;
  type: 'call' | 'return' | 'exception';
  message?: string;
  valuePreview?: string;
};

export type PythonTraceEvent = {
  id: string;
  step: number;
  type: PythonTraceEventType;
  line?: number;
  staticNodeId?: string;
  functionName: string;
  depth: number;
  locals: Record<string, string>;
  scope: PythonScopeSnapshot;
  objects: PythonObjectSnapshot[];
  changes: PythonTraceChanges;
  loopStack: PythonLoopSnapshot[];
  loopTransitions: PythonLoopTransition[];
  callStack: PythonCallFrameSnapshot[];
  functionTransition?: PythonFunctionTransition;
  stdout: string;
  stdoutLength?: number;
  stderr: string;
  stderrLength?: number;
  valuePreview?: string;
  exception?: {
    name: string;
    message: string;
  };
};

export type PythonRunResult = {
  requestId: string;
  status: PythonRunStatus;
  stdout: string;
  stderr: string;
  traceEvents: PythonTraceEvent[];
  staticAnalysis?: PythonStaticAnalysis;
  diagnostics: string[];
  error?: PythonRunError;
  durationMs: number;
  interruptMode: 'shared-array-buffer' | 'worker-terminate' | 'none';
  pyodideVersion?: string;
};

export type PythonRuntimeStatus = {
  phase: PythonRuntimePhase;
  message: string;
  interruptSupported: boolean;
};

export type PythonRunOptions = {
  timeoutMs?: number;
};

export type PythonWorkerInbound =
  | {
      type: 'setInterruptBuffer';
      interruptBuffer: Uint8Array;
    }
  | {
      type: 'run';
      requestId: string;
      source: string;
    };

export type PythonWorkerOutbound =
  | {
      type: 'status';
      status: PythonRuntimeStatus;
    }
  | {
      type: 'result';
      requestId: string;
      result: PythonRunResult;
    };
