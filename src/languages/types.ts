export type LanguageId = 'python';

export type Diagnostic = {
  id: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  line?: number;
  column?: number;
};

export type ExecutionStatus = 'idle' | 'loading' | 'running' | 'ok' | 'error' | 'timeout';

export type ExecutionOptions = {
  maxSteps: number;
  maxRuntimeMs: number;
  maxSerializedDepth: number;
  maxCollectionPreview: number;
};
