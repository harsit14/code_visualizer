import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CallStackPanel } from './CallStackPanel';
import type { EncodedValue, FrameSnapshot, TraceStep } from '../engine/types';

const num = (value: number): EncodedValue => ({ k: 'num', t: 'int', v: String(value) });

const frame = (id: string, func: string, line: number): FrameSnapshot => ({
  id,
  func,
  line,
  locals: {},
});

const moduleFrame = frame('module-1', '<module>', 5);
const factorial2 = frame('factorial-2', 'factorial', 3);
const factorial1 = frame('factorial-1', 'factorial', 2);

const step = (
  i: number,
  event: TraceStep['event'],
  line: number,
  stack: FrameSnapshot[],
  ret?: EncodedValue,
): TraceStep => ({
  i,
  event,
  line,
  func: stack.at(-1)?.func ?? '<module>',
  stack,
  globals: {},
  stdoutLen: 0,
  ...(ret ? { ret } : {}),
});

describe('CallStackPanel', () => {
  it('renders returned recursive calls in a persistent call tree', () => {
    const steps: TraceStep[] = [
      step(0, 'call', 5, [moduleFrame]),
      step(1, 'call', 3, [moduleFrame, factorial2]),
      step(2, 'call', 2, [moduleFrame, factorial2, factorial1]),
      step(3, 'return', 2, [moduleFrame, factorial2, factorial1], num(1)),
      step(4, 'return', 3, [moduleFrame, factorial2], num(2)),
    ];

    const html = renderToStaticMarkup(
      <CallStackPanel
        currentStep={steps[4]}
        onSelectFrame={() => {}}
        selectedFrameIndex={null}
        step={4}
        steps={steps}
      />,
    );

    expect(html).toContain('Call tree');
    expect(html.match(/factorial\(\)/g)).toHaveLength(3);
    expect(html).toContain('returned');
    expect(html).toContain('returning');
  });
});
