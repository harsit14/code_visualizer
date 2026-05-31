import type { Diagnostic } from '../languages/types';

export type TraceEvent = {
  id: string;
  type: string;
  step: number;
  line?: number;
  scopeId?: string;
  objectId?: string;
  symbolId?: string;
  valuePreview?: string;
  payload?: Record<string, unknown>;
};

export type RuntimeTrace = {
  runId: string;
  sourceHash: string;
  status: 'ok' | 'error' | 'timeout';
  events: TraceEvent[];
  stdout: string;
  stderr: string;
  diagnostics: Diagnostic[];
};

export type VisualizationEntity = {
  id: string;
  kind: 'source' | 'scope' | 'variable' | 'object' | 'loop' | 'function' | 'output';
  label: string;
};

export type VisualizationRelationship = {
  id: string;
  from: string;
  to: string;
  kind: 'execution' | 'reference' | 'mutation' | 'call' | 'return';
};

export type VisualizationFrame = {
  step: number;
  activeLine?: number;
  activeEntities: string[];
  highlightedRelationships: string[];
  annotations: string[];
};

export type VisualizationModel = {
  runId: string;
  frames: VisualizationFrame[];
  entities: VisualizationEntity[];
  relationships: VisualizationRelationship[];
};
