import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { VariablesPanel } from './VariablesPanel';
import type { EncodedValue, TraceStep } from '../engine/types';

const num = (v: number): EncodedValue => ({ k: 'num', t: 'int', v: String(v) });

describe('VariablesPanel', () => {
  it('shows public self attributes instead of the instance wrapper', () => {
    const currentStep: TraceStep = {
      i: 0,
      event: 'line',
      line: 1,
      func: 'solve',
      stack: [
        {
          id: 'frame-1',
          func: 'solve',
          qualname: 'Solution.solve',
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
                  entries: [[num(1), num(3)]],
                  len: 1,
                  truncated: false,
                },
              },
              preview: '<Solution object>',
            },
            n: num(1),
          },
        },
      ],
      globals: {},
      stdoutLen: 0,
    };

    const html = renderToStaticMarkup(
      <VariablesPanel
        currentStep={currentStep}
        frameIndex={null}
        onToggleWatch={() => {}}
        previousStep={undefined}
        watchedVariables={[]}
      />,
    );

    expect(html).toContain('self.memo');
    expect(html).toContain('{1: 3}');
    expect(html).toContain('n');
    expect(html).not.toContain('Solution object');
  });
});
