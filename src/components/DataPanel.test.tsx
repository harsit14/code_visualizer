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
      pointerHints: { s: ['hi'], nums: ['hi'] },
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

  it('surfaces a pointer that lands in a truncated string tail', () => {
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
          locals: {
            s: { k: 'str', v: 'abcde', len: 200, truncated: true },
            hi: num(150),
          },
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

    // The pointer at index 150 (past the 5 shown chars) rides the overflow cell.
    expect(html).toContain('▲ hi');
  });

  it('surfaces a pointer that lands in a truncated array tail', () => {
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
          locals: {
            nums: {
              k: 'seq',
              t: 'list',
              id: 1,
              items: [num(1), num(2)],
              len: 100,
              truncated: true,
            },
            hi: num(100),
          },
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

    // The overflow cell carries the pointer instead of dropping it.
    expect(html).toContain('+98');
    expect(html).toContain('▲ hi');
  });

  it('renders imported sized iterables as data cells', () => {
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
          locals: {
            q: {
              k: 'seq',
              t: 'deque',
              id: 1,
              items: [num(5), num(6)],
              len: 2,
              truncated: false,
            },
          },
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

    expect(html).toContain('<h3>q</h3>');
    expect(html).toContain('>5</span>');
    expect(html).toContain('>6</span>');
  });

  it('falls back to object previews when attrs are empty', () => {
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
          locals: {
            queue: {
              k: 'obj',
              id: 1,
              t: 'Queue',
              attrs: {},
              preview: '<Queue size=2>',
            },
          },
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

    expect(html).toContain('&lt;Queue size=2&gt;');
  });

  it('renders useful self attributes as data cards', () => {
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
          locals: {
            self: {
              k: 'obj',
              id: 1,
              t: 'Solution',
              attrs: {
                memo: {
                  k: 'dict',
                  id: 2,
                  entries: [[num(1), num(2)]],
                  len: 1,
                  truncated: false,
                },
              },
              preview: '<Solution object>',
            },
          },
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

    expect(html).toContain('<h3>self.memo</h3>');
    expect(html).toContain('<td>1</td><td>2</td>');
    expect(html).not.toContain('&lt;Solution object&gt;');
  });

  it('renders a heap memory map for referenced objects', () => {
    const shared: EncodedValue = {
      k: 'seq',
      t: 'list',
      id: 5,
      items: [num(1)],
      len: 1,
      truncated: false,
    };
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
          locals: {
            shared,
            matrix: {
              k: 'seq',
              t: 'list',
              id: 6,
              items: [shared, { k: 'ref', id: 5 }],
              len: 2,
              truncated: false,
            },
            row: { k: 'ref', id: 5 },
          },
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

    expect(html).toContain('memory map');
    expect(html).toContain('shared');
    expect(html).toContain('matrix');
    expect(html).toContain('row');
    expect(html).toContain('→ #5');
    expect(html).toContain('[0]');
  });
});
