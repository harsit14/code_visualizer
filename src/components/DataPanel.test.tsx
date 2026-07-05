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
      pointerHints: { s: ['hi'], nums: ['hi'], matrix: ['row'] },
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
    expect(html).toContain('<td>1</td>');
    expect(html).toContain('<span class="data-cell-value">2</span>');
    expect(html).not.toContain('&lt;Solution object&gt;');
  });

  it('renders a readable reference map for shared objects', () => {
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

    expect(html).toContain('reference map');
    expect(html).toContain('shared');
    expect(html).toContain('matrix');
    expect(html).toContain('row');
    expect(html).toContain('shared / row');
    expect(html).toContain('row 0');
    expect(html).toContain('row 1');
    expect(html).not.toContain('→ #');
    expect(html).not.toContain('>#');
  });

  it('shows matrix rows in the reference map without object ids or truncated values', () => {
    const row0: EncodedValue = {
      k: 'seq',
      t: 'list',
      id: 3,
      items: [num(1), num(3), num(5), num(7)],
      len: 4,
      truncated: false,
    };
    const row1: EncodedValue = {
      k: 'seq',
      t: 'list',
      id: 4,
      items: [num(10), num(11), num(16), num(20)],
      len: 4,
      truncated: false,
    };
    const row2: EncodedValue = {
      k: 'seq',
      t: 'list',
      id: 5,
      items: [num(23), num(30), num(34), num(60)],
      len: 4,
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
            matrix: {
              k: 'seq',
              t: 'list',
              id: 2,
              items: [row0, row1, row2],
              len: 3,
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

    expect(html).toContain('reference map');
    expect(html).toContain('3 rows x 4 cols');
    expect(html).toContain('row 0');
    expect(html).toContain('matrix[0]');
    expect(html).toContain('[23, 30, 34, 60]');
    expect(html).not.toContain('#2');
    expect(html).not.toContain('#3');
    expect(html).not.toContain('…');
  });

  it('highlights changed matrix cells and active row-column pointers', () => {
    const previousMatrix: EncodedValue = {
      k: 'seq',
      t: 'list',
      id: 2,
      items: [
        {
          k: 'seq',
          t: 'list',
          id: 3,
          items: [num(1), num(3), num(5)],
          len: 3,
          truncated: false,
        },
        {
          k: 'seq',
          t: 'list',
          id: 4,
          items: [num(10), num(11), num(16)],
          len: 3,
          truncated: false,
        },
      ],
      len: 2,
      truncated: false,
    };
    const currentMatrix: EncodedValue = {
      k: 'seq',
      t: 'list',
      id: 2,
      items: [
        {
          k: 'seq',
          t: 'list',
          id: 3,
          items: [num(1), num(3), num(5)],
          len: 3,
          truncated: false,
        },
        {
          k: 'seq',
          t: 'list',
          id: 4,
          items: [num(10), num(11), num(99)],
          len: 3,
          truncated: false,
        },
      ],
      len: 2,
      truncated: false,
    };
    const previousStep: TraceStep = {
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
            matrix: previousMatrix,
            row: num(1),
            col: num(2),
          },
        },
      ],
      globals: {},
      stdoutLen: 0,
    };
    const currentStep: TraceStep = {
      ...previousStep,
      i: 1,
      stack: [
        {
          id: 'frame-1',
          func: 'f',
          qualname: 'f',
          line: 2,
          locals: {
            matrix: currentMatrix,
            row: num(1),
            col: num(2),
          },
        },
      ],
    };

    const html = renderToStaticMarkup(
      <DataPanel
        analysis={analysis}
        atLastStep={false}
        currentStep={currentStep}
        frameIndex={null}
        previousStep={previousStep}
        returnValue={null}
      />,
    );

    expect(html).toContain('title="matrix[1][2] (row, col)"');
    expect(html).toContain('class="is-changed has-trace-pointer"');
    expect(html).toContain('<span class="data-cell-value">99</span>');
    expect(html).toContain('<span class="trace-badge">row, col</span>');
  });
});
