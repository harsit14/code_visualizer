import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WatchPanel } from './WatchPanel';
import type { AnalysisInfo, EncodedValue, TraceStep } from '../engine/types';

const num = (v: number): EncodedValue => ({ k: 'num', t: 'int', v: String(v) });
const list = (id: number, values: number[]): EncodedValue => ({
  k: 'seq',
  t: 'list',
  id,
  items: values.map(num),
  len: values.length,
  truncated: false,
});

const analysis: AnalysisInfo = {
  mode: 'function',
  functions: [
    {
      name: 'twoSum',
      qualname: 'Solution.twoSum',
      className: 'Solution',
      params: [
        { name: 'nums', annotation: null, inferred: 'list[int]', source: 'name' },
        { name: 'target', annotation: null, inferred: 'int', source: 'name' },
      ],
      line: 2,
      isGenerator: false,
      docstring: null,
      returns: null,
      assignmentHints: [],
      pointerHints: {},
    },
  ],
  defaultFunction: 'Solution.twoSum',
  definesTreeNode: false,
  definesListNode: false,
  referencesTreeNode: false,
  referencesListNode: false,
  diagnostics: [],
};

describe('WatchPanel', () => {
  it('labels first parameter entries as test inputs', () => {
    const steps: TraceStep[] = [
      {
        i: 0,
        event: 'call',
        line: 2,
        func: 'twoSum',
        stack: [
          {
            id: 'frame-1',
            func: 'twoSum',
            qualname: 'Solution.twoSum',
            line: 3,
            locals: { nums: list(1, [2, 7]), target: num(9) },
          },
        ],
        globals: {},
        stdoutLen: 0,
      },
    ];

    const html = renderToStaticMarkup(
      <WatchPanel
        analysis={analysis}
        currentStep={steps[0]}
        frameIndex={null}
        onClear={() => {}}
        onJump={() => {}}
        onRemoveVariable={() => {}}
        step={0}
        steps={steps}
        watchedVariables={['nums']}
      />,
    );

    expect(html).toContain('parameter input · call');
    expect(html).toContain('nums received from the test input');
    expect(html).not.toContain('line 3 · call');
  });

  it('can watch expanded self attributes', () => {
    const steps: TraceStep[] = [
      {
        i: 0,
        event: 'line',
        line: 4,
        func: 'solve',
        stack: [
          {
            id: 'frame-1',
            func: 'solve',
            qualname: 'Solution.solve',
            line: 4,
            locals: {
              self: {
                k: 'obj',
                id: 10,
                t: 'Solution',
                attrs: { memo: list(11, [1, 2]) },
                preview: '<Solution object>',
              },
            },
          },
        ],
        globals: {},
        stdoutLen: 0,
      },
    ];

    const html = renderToStaticMarkup(
      <WatchPanel
        analysis={analysis}
        currentStep={steps[0]}
        frameIndex={null}
        onClear={() => {}}
        onJump={() => {}}
        onRemoveVariable={() => {}}
        step={0}
        steps={steps}
        watchedVariables={['self.memo']}
      />,
    );

    expect(html).toContain('self.memo');
    expect(html).toContain('[1, 2]');
    expect(html).not.toContain('not in scope');
  });
});
