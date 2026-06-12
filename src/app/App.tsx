/**
 * App shell: layout, theme, share links, trace export/import, and wiring
 * between the session hook and the dashboard panels.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CallStackPanel } from '../components/CallStackPanel';
import { ConsolePanel } from '../components/ConsolePanel';
import { ControlsBar } from '../components/ControlsBar';
import { DataPanel } from '../components/DataPanel';
import { EditorPanel } from '../components/EditorPanel';
import { InputsPanel } from '../components/InputsPanel';
import { TopBar } from '../components/TopBar';
import { VariablesPanel } from '../components/VariablesPanel';
import type { SessionResult } from '../engine/types';
import { DEFAULT_EXAMPLE_ID, getExample } from '../examples/examples';
import { decodeShareHash, encodeShareState } from './shareState';
import { useSession } from './useSession';

type Theme = 'light' | 'dark';

const EXPORT_VERSION = 2;

function initialTheme(): Theme {
  const stored = window.localStorage.getItem('cv-theme');
  if (stored === 'light' || stored === 'dark') {
    return stored;
  }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function initialShare() {
  return decodeShareHash(window.location.hash);
}

export function App() {
  const [shared] = useState(initialShare);
  const [exampleId, setExampleId] = useState<string | null>(
    shared ? (shared.exampleId ?? null) : DEFAULT_EXAMPLE_ID,
  );
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [shareLabel, setShareLabel] = useState('Share');

  const initialCode = shared?.code ?? getExample(DEFAULT_EXAMPLE_ID)?.code ?? '';
  const session = useSession(initialCode);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('cv-theme', theme);
  }, [theme]);

  // Analyze the initial snippet so the inputs panel is ready pre-run.
  useEffect(() => {
    session.scheduleAnalyze(session.code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCodeChange = useCallback(
    (code: string) => {
      setExampleId(null);
      session.setCode(code);
    },
    [session],
  );

  const handleExampleChange = useCallback(
    (id: string) => {
      const example = getExample(id);
      if (!example) {
        return;
      }
      setExampleId(id);
      session.setCode(example.code);
    },
    [session],
  );

  const handleShare = useCallback(async () => {
    const url = new URL(window.location.href);
    url.hash = encodeShareState({
      code: session.code,
      exampleId: exampleId ?? undefined,
      seed: session.seed ?? undefined,
      functionName: session.functionOverride ?? undefined,
    });
    window.history.replaceState(null, '', url);
    try {
      await navigator.clipboard?.writeText(url.toString());
      setShareLabel('Copied!');
    } catch {
      setShareLabel('Link set');
    }
    window.setTimeout(() => setShareLabel('Share'), 1800);
  }, [exampleId, session.code, session.functionOverride, session.seed]);

  const handleExport = useCallback(() => {
    if (!session.result) {
      return;
    }
    const payload = {
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      code: session.code,
      step: session.step,
      result: session.result,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `code-visualizer-trace-${Date.now()}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [session.code, session.result, session.step]);

  const handleImport = useCallback(
    (file: File) => {
      void file.text().then((text) => {
        try {
          const payload = JSON.parse(text) as {
            version?: number;
            code?: string;
            result?: SessionResult;
          };
          if (typeof payload.code === 'string' && payload.result) {
            setExampleId(null);
            session.importSession(payload.code, payload.result);
          }
        } catch {
          /* invalid file — ignore */
        }
      });
    },
    [session],
  );

  const run = session.result?.run ?? null;
  const errorLine = useMemo(() => {
    if (session.currentStep?.exc) {
      return session.currentStep.line;
    }
    if (session.result?.error?.line) {
      return session.result.error.line;
    }
    return null;
  }, [session.currentStep, session.result]);

  const atLastStep = session.totalSteps > 0 && session.step === session.totalSteps - 1;
  const previousStep = session.step > 0 ? session.steps[session.step - 1] : undefined;
  const showInputs = session.analysis?.mode === 'function';

  return (
    <div className="app-shell">
      <TopBar
        canExport={Boolean(session.result?.run)}
        exampleId={exampleId}
        onExampleChange={handleExampleChange}
        onExport={handleExport}
        onImport={handleImport}
        onShare={() => void handleShare()}
        onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
        shareLabel={shareLabel}
        status={session.status}
        theme={theme}
      />

      <main className="workbench">
        <div className="column column-left">
          <EditorPanel
            activeLine={session.currentStep?.line ?? null}
            code={session.code}
            diagnostics={session.analysis?.diagnostics ?? []}
            errorLine={errorLine}
            onChange={handleCodeChange}
            theme={theme}
          />
          {showInputs ? (
            <InputsPanel
              activeFunction={session.activeFunction}
              analysis={session.analysis}
              drafts={session.inputDrafts}
              isBusy={session.isBusy}
              lastInputs={run?.inputs ?? null}
              onDraftsChange={session.setInputDrafts}
              onFunctionChange={session.setFunctionOverride}
              onRegenerate={session.regenerateInputs}
              onSeedChange={session.setSeed}
              seed={session.seed}
            />
          ) : null}
        </div>

        <div className="column column-center">
          <DataPanel
            analysis={session.analysis}
            atLastStep={atLastStep}
            currentStep={session.currentStep}
            frameIndex={session.selectedFrameIndex}
            returnValue={run?.returnValue ?? null}
          />
        </div>

        <div className="column column-right">
          <VariablesPanel
            currentStep={session.currentStep}
            frameIndex={session.selectedFrameIndex}
            previousStep={previousStep}
          />
          <CallStackPanel
            currentStep={session.currentStep}
            onSelectFrame={session.setSelectedFrameIndex}
            selectedFrameIndex={session.selectedFrameIndex}
          />
          <ConsolePanel
            atLastStep={atLastStep}
            canMeasureComplexity={showInputs && !session.isBusy}
            complexity={session.complexity}
            complexityBusy={session.complexityBusy}
            currentStep={session.currentStep}
            onMeasureComplexity={() => void session.measureComplexity()}
            result={session.result}
          />
        </div>
      </main>

      <ControlsBar
        currentStep={session.currentStep}
        isBusy={session.isBusy}
        onJump={session.jumpToStep}
        onRun={() => void session.run()}
        onSpeedChange={session.setSpeed}
        onStepBack={session.stepBack}
        onStepForward={session.stepForward}
        onTogglePlay={session.togglePlay}
        playing={session.playing}
        speed={session.speed}
        step={session.step}
        totalSteps={session.totalSteps}
      />
    </div>
  );
}
