import { useEffect, useMemo, useState } from 'react';
import { CodeEditorPanel } from '../components/editor/CodeEditorPanel';
import { ScopeInspector } from '../components/inspector/ScopeInspector';
import { OutputPanel } from '../components/panels/OutputPanel';
import { TimelineScrubber } from '../components/timeline/TimelineScrubber';
import { RunToolbar } from '../components/toolbar/RunToolbar';
import { VisualizationStage } from '../components/visualization/VisualizationStage';
import { decodeShareHash, encodeShareState, type SharedCodeState } from './shareState';
import {
  CUSTOM_SNIPPET_ID,
  CUSTOM_SNIPPET_TITLE,
  DEFAULT_EXAMPLE_ID,
  getPythonExample,
  isPythonExampleId,
  pythonExamples,
} from '../examples/pythonExamples';
import { usePythonRuntime } from '../languages/python/usePythonRuntime';
import type {
  PythonRunResult,
  PythonRuntimePhase,
  PythonStaticAnalysis,
  PythonTraceEvent,
} from '../languages/python/runtimeTypes';

const RUNTIME_BUSY_PHASES = new Set<PythonRuntimePhase>([
  'loading',
  'running',
  'interrupting',
  'restarting',
]);
const EMPTY_TRACE_EVENTS: PythonTraceEvent[] = [];
const EMPTY_STATIC_ANALYSIS: PythonStaticAnalysis = {
  diagnostics: [],
  lineToNodeIds: {},
  nodes: [],
  summary: {
    assignments: 0,
    branches: 0,
    functions: 0,
    loops: 0,
  },
  symbols: [],
};
const BASE_PLAYBACK_DELAY_MS = 820;

function readShareState(): SharedCodeState | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return decodeShareHash(window.location.hash);
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}

export function App() {
  const [initialShareState] = useState(readShareState);
  const [selectedExampleId, setSelectedExampleId] = useState(
    initialShareState?.exampleId ?? DEFAULT_EXAMPLE_ID,
  );
  const selectedExample = useMemo(
    () => (isPythonExampleId(selectedExampleId) ? getPythonExample(selectedExampleId) : null),
    [selectedExampleId],
  );
  const [code, setCode] = useState(
    () =>
      initialShareState?.code ??
      getPythonExample(initialShareState?.exampleId ?? DEFAULT_EXAMPLE_ID).code,
  );
  const [customCode, setCustomCode] = useState(() =>
    initialShareState?.exampleId === CUSTOM_SNIPPET_ID ? initialShareState.code : '',
  );
  const [currentStep, setCurrentStep] = useState(0);
  const [exportState, setExportState] = useState<'idle' | 'done'>('idle');
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [runResult, setRunResult] = useState<PythonRunResult | null>(null);
  const [selectedObjectId, setSelectedObjectId] = useState<string | undefined>(undefined);
  const [shareState, setShareState] = useState<'idle' | 'copied' | 'linked'>(
    initialShareState ? 'linked' : 'idle',
  );
  const { runPython, runtimeStatus } = usePythonRuntime();
  const isRuntimeBusy = RUNTIME_BUSY_PHASES.has(runtimeStatus.phase);
  const traceEvents = runResult?.traceEvents ?? EMPTY_TRACE_EVENTS;
  const staticAnalysis = runResult?.staticAnalysis ?? EMPTY_STATIC_ANALYSIS;
  const totalSteps = Math.max(traceEvents.length, 1);
  const currentEvent: PythonTraceEvent | null = traceEvents[currentStep] ?? null;
  const isCustomSnippet = selectedExampleId === CUSTOM_SNIPPET_ID;
  const sourceTitle = selectedExample?.title ?? CUSTOM_SNIPPET_TITLE;
  const activeLine = currentEvent?.line;
  const executedLines = useMemo(
    () =>
      Array.from(
        new Set(traceEvents.map((event) => event.line).filter((line): line is number => !!line)),
      ),
    [traceEvents],
  );
  const lineToStep = useMemo(() => {
    const map = new Map<number, number>();
    traceEvents.forEach((event, index) => {
      if (event.line && !map.has(event.line)) {
        map.set(event.line, index);
      }
    });
    return map;
  }, [traceEvents]);

  const clearRunState = () => {
    setCurrentStep(0);
    setExportState('idle');
    setIsPlaying(false);
    setRunResult(null);
    setSelectedObjectId(undefined);
  };

  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    const timer = window.setInterval(
      () => {
        setCurrentStep((step) => {
          if (step >= totalSteps - 1) {
            setIsPlaying(false);
            return step;
          }

          return step + 1;
        });
      },
      Math.max(120, Math.round(BASE_PLAYBACK_DELAY_MS / playbackSpeed)),
    );

    return () => window.clearInterval(timer);
  }, [isPlaying, playbackSpeed, totalSteps]);

  useEffect(() => {
    if (currentStep > totalSteps - 1) {
      setCurrentStep(Math.max(totalSteps - 1, 0));
    }
  }, [currentStep, totalSteps]);

  useEffect(() => {
    if (
      selectedObjectId &&
      !currentEvent?.objects.some(
        (object) => object.id === selectedObjectId && object.kind !== 'primitive',
      )
    ) {
      setSelectedObjectId(undefined);
    }
  }, [currentEvent, selectedObjectId]);

  const handleRun = async () => {
    if (isRuntimeBusy) {
      return;
    }

    setCurrentStep(0);
    setExportState('idle');
    setIsPlaying(false);
    setRunResult(null);
    setSelectedObjectId(undefined);

    try {
      const result = await runPython(code, { timeoutMs: 5000 });
      const errorStep = result.traceEvents.reduce(
        (lastExceptionStep, event, index) =>
          event.type === 'exception' ? index : lastExceptionStep,
        -1,
      );
      const failureStep = errorStep >= 0 ? errorStep : result.traceEvents.length - 1;
      setRunResult(result);
      setCurrentStep(result.status === 'ok' ? 0 : Math.max(failureStep, 0));
      setIsPlaying(result.status === 'ok' && result.traceEvents.length > 1);
    } catch (error) {
      setRunResult({
        requestId: 'client-error',
        status: 'error',
        stdout: '',
        stderr: '',
        traceEvents: [],
        diagnostics: [],
        durationMs: 0,
        interruptMode: 'none',
        error: {
          name: error instanceof Error ? error.name : 'ClientError',
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  };

  const handleReset = () => {
    if (selectedExample) {
      setCode(selectedExample.code);
    }

    setShareState('idle');
    clearRunState();
  };

  const handleCodeChange = (nextCode: string) => {
    setCode(nextCode);
    setCustomCode(nextCode);
    setSelectedExampleId(CUSTOM_SNIPPET_ID);
    setShareState('idle');
    clearRunState();
  };

  const handleExampleChange = (id: string) => {
    if (id === CUSTOM_SNIPPET_ID) {
      setSelectedExampleId(CUSTOM_SNIPPET_ID);
      setCode(customCode);
      setShareState('idle');
      clearRunState();
      return;
    }

    const nextExample = getPythonExample(id);

    setSelectedExampleId(id);
    setCode(nextExample.code);
    setShareState('idle');
    clearRunState();
  };

  const handleClearCustomSnippet = () => {
    setCode('');
    setCustomCode('');
    setShareState('idle');
    clearRunState();
  };

  const handleLineSelect = (line: number) => {
    const nextStep = lineToStep.get(line);
    if (nextStep === undefined) {
      return;
    }

    setIsPlaying(false);
    setCurrentStep(nextStep);
  };

  const handleTimelineChange = (step: number) => {
    setIsPlaying(false);
    setCurrentStep(step);
  };

  const handleObjectSelect = (objectId: string) => {
    setIsPlaying(false);
    setSelectedObjectId((currentObjectId) => (currentObjectId === objectId ? undefined : objectId));
  };

  const handleTogglePlayback = () => {
    if (traceEvents.length <= 1) {
      return;
    }

    if (!isPlaying && currentStep >= totalSteps - 1) {
      setCurrentStep(0);
    }

    setIsPlaying((playing) => !playing);
  };

  const handleExport = () => {
    if (!runResult || typeof window === 'undefined') {
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    downloadJson(`code-visualizer-${selectedExample?.id ?? CUSTOM_SNIPPET_ID}-${timestamp}.json`, {
      exportedAt: new Date().toISOString(),
      code,
      currentStep,
      source: {
        id: selectedExample?.id ?? CUSTOM_SNIPPET_ID,
        title: sourceTitle,
        type: selectedExample ? 'example' : 'custom',
      },
      runResult,
      selectedExampleId,
    });
    setExportState('done');
    window.setTimeout(() => setExportState('idle'), 1600);
  };

  const handleShare = async () => {
    if (typeof window === 'undefined' || code.trim().length === 0) {
      return;
    }

    const url = new URL(window.location.href);
    url.hash = encodeShareState({ code, exampleId: selectedExampleId });
    window.history.replaceState(null, '', url);

    try {
      await window.navigator.clipboard?.writeText(url.toString());
      setShareState('copied');
    } catch {
      setShareState('linked');
    }

    window.setTimeout(() => setShareState('linked'), 1800);
  };

  return (
    <main className="app-shell">
      <RunToolbar
        activeStep={currentStep}
        canExport={Boolean(runResult)}
        canShare={code.trim().length > 0}
        examples={pythonExamples}
        exportState={exportState}
        isBusy={isRuntimeBusy}
        onExampleChange={handleExampleChange}
        onExport={handleExport}
        onReset={handleReset}
        onRun={handleRun}
        onShare={handleShare}
        runtimeStatus={runtimeStatus}
        selectedExampleId={selectedExampleId}
        shareState={shareState}
        totalSteps={totalSteps}
      />

      <section className="workbench" aria-label="Code visualizer workspace">
        <CodeEditorPanel
          activeLine={activeLine}
          code={code}
          diagnostics={staticAnalysis.diagnostics}
          executedLines={executedLines}
          isCustomSnippet={isCustomSnippet}
          onClear={handleClearCustomSnippet}
          onChange={handleCodeChange}
          onLineSelect={handleLineSelect}
          sourceTitle={sourceTitle}
        />

        <VisualizationStage
          currentEvent={currentEvent}
          currentStep={currentStep}
          exampleTitle={sourceTitle}
          onObjectSelect={handleObjectSelect}
          selectedObjectId={selectedObjectId}
          staticAnalysis={staticAnalysis}
          totalSteps={totalSteps}
        />

        <aside className="inspector-stack" aria-label="Runtime inspector">
          <ScopeInspector
            currentEvent={currentEvent}
            currentStep={currentStep}
            onObjectSelect={handleObjectSelect}
            selectedObjectId={selectedObjectId}
            totalSteps={totalSteps}
          />
          <OutputPanel
            currentEvent={currentEvent}
            exampleTitle={sourceTitle}
            runResult={runResult}
            runtimeStatus={runtimeStatus}
          />
        </aside>
      </section>

      <TimelineScrubber
        currentStep={currentStep}
        events={traceEvents}
        isPlaying={isPlaying}
        onChange={handleTimelineChange}
        onPlaybackSpeedChange={setPlaybackSpeed}
        onTogglePlayback={handleTogglePlayback}
        playbackSpeed={playbackSpeed}
        totalSteps={totalSteps}
      />
    </main>
  );
}
