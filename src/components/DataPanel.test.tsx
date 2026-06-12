import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DataPanel } from './DataPanel';
import type { AnalysisInfo, EncodedValue, TraceStep } from '../engine/types';

const num = (v: number): EncodedValue => ({ k: 'num', t: 'int', v: String(v) });
const str = (v: string): EncodedValue => ({ k: 'str', v, truncated: false });

const analysis: AnalysisInfo = {
  mode: 'function',
  functions: [
    {
      name: 'f',
      qualname: 'f',
      className: null,
      params: [],
      line: 1,
      isGenerator: false,
      docstring: null,
      returns: null,
      pointerHints: { s: ['hi'] },
    },
  ],
  defaultFunction: 'f',
  definesTreeNode: false,
  definesListNode: false,
  referencesTreeNode: false,
  referencesListNode: false,
  modulePointerHints: {},
  diagnostics: [],
};

describe('DataPanel', () => {
  it('renders string end pointers', () => {
    const currentStep: TraceStep = {
      i: 0,
      event: 'line',
      line: 1,
      func: 'f',
      stack: [
        {
          id: 'frame-1',
          func: 'f',
          qualname: 'f',
          line: 1,
          locals: { s: str('abc'), hi: num(3) },
        },
      ],
      globals: {},
      stdoutLen: 0,
    };

    const html = renderToStaticMarkup(
      <DataPanel
        analysis={analysis}
        atLastStep={false}
        currentStep={currentStep}
        frameIndex={null}
        returnValue={null}
      />,
    );

    expect(html).toContain('end');
    expect(html).toContain('▲ hi');
  });
});
