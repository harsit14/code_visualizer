import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react';

type SeenEntry = {
  index: number;
  value: number;
};

type TraceStep = {
  line: number;
  vars: {
    i: string;
    need: string;
    target: string;
    value: string;
  };
  index: number | null;
  seen: SeenEntry[];
  activeSeenValue: number | null;
  foundPair: readonly [number, number] | null;
  returnValue: string | null;
  message: string;
};

const STATIC_SCREENSHOT = `${import.meta.env.BASE_URL}screenshots/dashboard-overview.png`;

const CODE_LINES = [
  'def two_sum(nums, target):',
  '    seen = {}',
  '    for i, value in enumerate(nums):',
  '        need = target - value',
  '        if need in seen:',
  '            return [seen[need], i]',
  '        seen[value] = i',
  '    return []',
];

const ARRAY_DATA = [2, 7, 11, 15];

const TRACE_STEPS: TraceStep[] = [
  {
    activeSeenValue: null,
    foundPair: null,
    index: null,
    line: 1,
    message: 'Call two_sum([2, 7, 11, 15], 9).',
    returnValue: null,
    seen: [],
    vars: { i: '-', need: '-', target: '9', value: '-' },
  },
  {
    activeSeenValue: null,
    foundPair: null,
    index: null,
    line: 2,
    message: 'Create the empty lookup table.',
    returnValue: null,
    seen: [],
    vars: { i: '-', need: '-', target: '9', value: '-' },
  },
  {
    activeSeenValue: null,
    foundPair: null,
    index: 0,
    line: 3,
    message: 'Move the loop pointer to index 0.',
    returnValue: null,
    seen: [],
    vars: { i: '0', need: '-', target: '9', value: '2' },
  },
  {
    activeSeenValue: null,
    foundPair: null,
    index: 0,
    line: 4,
    message: 'Compute the missing complement: 9 - 2 = 7.',
    returnValue: null,
    seen: [],
    vars: { i: '0', need: '7', target: '9', value: '2' },
  },
  {
    activeSeenValue: null,
    foundPair: null,
    index: 0,
    line: 5,
    message: '7 is not in seen yet.',
    returnValue: null,
    seen: [],
    vars: { i: '0', need: '7', target: '9', value: '2' },
  },
  {
    activeSeenValue: 2,
    foundPair: null,
    index: 0,
    line: 7,
    message: 'Store value 2 so a later number can point back to it.',
    returnValue: null,
    seen: [{ value: 2, index: 0 }],
    vars: { i: '0', need: '7', target: '9', value: '2' },
  },
  {
    activeSeenValue: null,
    foundPair: null,
    index: 1,
    line: 3,
    message: 'Advance the pointer to index 1.',
    returnValue: null,
    seen: [{ value: 2, index: 0 }],
    vars: { i: '1', need: '-', target: '9', value: '7' },
  },
  {
    activeSeenValue: null,
    foundPair: null,
    index: 1,
    line: 4,
    message: 'Compute the missing complement: 9 - 7 = 2.',
    returnValue: null,
    seen: [{ value: 2, index: 0 }],
    vars: { i: '1', need: '2', target: '9', value: '7' },
  },
  {
    activeSeenValue: 2,
    foundPair: [0, 1],
    index: 1,
    line: 5,
    message: '2 is already in seen, so both indices are now connected.',
    returnValue: null,
    seen: [{ value: 2, index: 0 }],
    vars: { i: '1', need: '2', target: '9', value: '7' },
  },
  {
    activeSeenValue: 2,
    foundPair: [0, 1],
    index: 1,
    line: 6,
    message: 'Return the pair that adds to the target.',
    returnValue: '[0, 1]',
    seen: [{ value: 2, index: 0 }],
    vars: { i: '1', need: '2', target: '9', value: '7' },
  },
  {
    activeSeenValue: 2,
    foundPair: [0, 1],
    index: 1,
    line: 6,
    message: 'The trace can now be scrubbed, paused, shared, or embedded.',
    returnValue: '[0, 1]',
    seen: [{ value: 2, index: 0 }],
    vars: { i: '1', need: '2', target: '9', value: '7' },
  },
  {
    activeSeenValue: null,
    foundPair: null,
    index: null,
    line: 1,
    message: 'Looping the mini trace from the beginning.',
    returnValue: null,
    seen: [],
    vars: { i: '-', need: '-', target: '9', value: '-' },
  },
];

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return;
    setPrefersReducedMotion(query.matches);
    const handleChange = () => setPrefersReducedMotion(query.matches);
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);

  return prefersReducedMotion;
}

export function LandingInteractiveDemo() {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [stepIndex, setStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);

  useEffect(() => {
    if (prefersReducedMotion) {
      setIsPlaying(false);
    }
  }, [prefersReducedMotion]);

  useEffect(() => {
    if (!isPlaying || prefersReducedMotion) return;
    const interval = window.setInterval(() => {
      setStepIndex((current) => (current + 1) % TRACE_STEPS.length);
    }, 650);
    return () => window.clearInterval(interval);
  }, [isPlaying, prefersReducedMotion]);

  if (prefersReducedMotion) {
    return (
      <figure className="interactive-demo-card demo-static-fallback">
        <img
          alt="Static Code Visualizer dashboard preview showing code, data, variables, and trace controls."
          decoding="async"
          height="720"
          loading="eager"
          src={STATIC_SCREENSHOT}
          width="1280"
        />
      </figure>
    );
  }

  const step = TRACE_STEPS[stepIndex];
  const foundCells = new Set(step.foundPair ?? []);

  const handlePrev = () => {
    setIsPlaying(false);
    setStepIndex((current) => (current - 1 + TRACE_STEPS.length) % TRACE_STEPS.length);
  };

  const handleNext = () => {
    setIsPlaying(false);
    setStepIndex((current) => (current + 1) % TRACE_STEPS.length);
  };

  const handleReset = () => {
    setIsPlaying(false);
    setStepIndex(0);
  };

  return (
    <div className="interactive-demo-card" aria-label="Auto-playing Two Sum trace demo">
      <div className="demo-window-header">
        <div className="demo-window-dots" aria-hidden="true">
          <span className="dot red" />
          <span className="dot yellow" />
          <span className="dot green" />
        </div>
        <span className="demo-window-title">two_sum.py</span>
        <button
          className="demo-affordance"
          onClick={handleNext}
          onMouseEnter={() => setIsPlaying(false)}
          type="button"
        >
          <Play size={12} />
          Step through it yourself
        </button>
        <div className="demo-controls">
          <button aria-label="Step backward" onClick={handlePrev} title="Step backward" type="button">
            <SkipBack size={14} />
          </button>
          <button
            aria-label={isPlaying ? 'Pause mini trace' : 'Play mini trace'}
            aria-pressed={isPlaying}
            onClick={() => setIsPlaying((current) => !current)}
            title={isPlaying ? 'Pause' : 'Play'}
            type="button"
          >
            {isPlaying ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <button aria-label="Step forward" onClick={handleNext} title="Step forward" type="button">
            <SkipForward size={14} />
          </button>
          <button aria-label="Reset mini trace" onClick={handleReset} title="Reset" type="button">
            <RotateCcw size={14} />
          </button>
        </div>
      </div>

      <div className="demo-layout">
        <div className="demo-editor-panel">
          <pre className="demo-code">
            {CODE_LINES.map((lineText, index) => {
              const lineNumber = index + 1;
              return (
                <div
                  className={`demo-code-line ${step.line === lineNumber ? 'active-line' : ''}`}
                  key={lineNumber}
                >
                  <span className="line-number">{lineNumber}</span>
                  <span className="line-content">{lineText}</span>
                </div>
              );
            })}
          </pre>
        </div>

        <div className="demo-viz-panel">
          <div className="demo-panel-section">
            <div className="demo-panel-label">Array state</div>
            <div className="demo-array-container">
              <div
                className="demo-array"
                style={
                  {
                    '--array-index': step.index ?? 0,
                    '--array-size': ARRAY_DATA.length,
                  } as CSSProperties
                }
              >
                {ARRAY_DATA.map((value, index) => (
                  <div className="demo-array-cell-wrapper" key={value}>
                    <div
                      className={`demo-array-cell ${step.index === index ? 'mid-cell' : ''} ${
                        foundCells.has(index) ? 'found-cell' : ''
                      }`}
                    >
                      {value}
                      <span className="cell-index">{index}</span>
                    </div>
                  </div>
                ))}
                <span
                  className={`demo-array-index-marker ${step.index === null ? 'is-hidden' : ''}`}
                >
                  i
                </span>
              </div>
            </div>
          </div>

          <div className="demo-panel-columns">
            <div className="demo-panel-col">
              <div className="demo-panel-label">Variables</div>
              <table className="demo-variables-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>i</td>
                    <td className={step.vars.i !== '-' && step.line === 3 ? 'highlight-var' : ''}>
                      {step.vars.i}
                    </td>
                  </tr>
                  <tr>
                    <td>value</td>
                    <td className={step.vars.value !== '-' && step.line === 3 ? 'highlight-var' : ''}>
                      {step.vars.value}
                    </td>
                  </tr>
                  <tr>
                    <td>need</td>
                    <td className={step.vars.need !== '-' && step.line === 4 ? 'highlight-var' : ''}>
                      {step.vars.need}
                    </td>
                  </tr>
                  <tr>
                    <td>target</td>
                    <td>{step.vars.target}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="demo-panel-col">
              <div className="demo-panel-label">seen dict</div>
              <div className="demo-map">
                {step.seen.length === 0 ? (
                  <span className="demo-map-empty">{'{}'}</span>
                ) : (
                  step.seen.map((entry) => (
                    <div
                      className={`demo-map-entry ${
                        step.activeSeenValue === entry.value ? 'active-entry' : ''
                      }`}
                      key={entry.value}
                    >
                      <span>{entry.value}</span>
                      <span>{entry.index}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="demo-console">
            <div className="console-line">
              <span className="console-prompt">&gt;</span> two_sum(nums, 9)
            </div>
            <div className="console-line text-dim">{step.message}</div>
            {step.returnValue ? (
              <div className="console-line console-success">
                <span className="console-prompt">&lt;</span> Return value: {step.returnValue}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <div className="demo-step-badge">
        Step {stepIndex + 1} of {TRACE_STEPS.length}
      </div>
    </div>
  );
}
