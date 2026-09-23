import { describe, expect, it } from 'vitest';
import { callTreeAt, indexCallTree } from './callTree';
import { runJavaScriptTrace } from './jsTraceEngine';
import type { TraceStep } from './types';

const steps = runJavaScriptTrace(
  'function fib(n) {\n  if (n < 2) return n;\n  return fib(n - 1) + fib(n - 2);\n}\nfib(3);',
  'javascript',
).run!.steps;

function names(tree: ReturnType<typeof callTreeAt>['roots']): unknown[] {
  return tree.map((node) => [
    node.func,
    node.returnValue?.k === 'num' ? node.returnValue.v : null,
    names(node.children),
  ]);
}

describe('call tree index', () => {
  it('matches the tree as of each step, including pending returns', () => {
    const index = indexCallTree(steps);
    const firstCall = steps.findIndex((step) => step.event === 'call');
    const early = callTreeAt(index, steps, firstCall);
    expect(names(early.roots)).toEqual([['<module>', null, [['fib', null, []]]]]);
    const final = callTreeAt(index, steps, steps.length - 1);
    expect(names(final.roots)).toEqual([
      [
        '<module>',
        null,
        [
          [
            'fib',
            '2',
            [
              [
                'fib',
                '1',
                [
                  ['fib', '1', []],
                  ['fib', '0', []],
                ],
              ],
              ['fib', '1', []],
            ],
          ],
        ],
      ],
    ]);
  });

  it('reports the line each call was on at that step', () => {
    const index = indexCallTree(steps);
    const deepest = steps.findIndex((step) => step.stack.length === 4);
    const tree = callTreeAt(index, steps, deepest);
    const outer = tree.roots[0].children[0];
    expect(outer.line).toBe(3);
  });

  it('keeps only the most recent sibling calls', () => {
    const loop = runJavaScriptTrace(
      'function id(x) {\n  return x;\n}\nfor (let i = 0; i < 30; i++) id(i);',
      'javascript',
    ).run!.steps;
    const tree = callTreeAt(indexCallTree(loop), loop, loop.length - 1, 5);
    expect(tree.roots[0].children).toHaveLength(5);
    expect(tree.roots[0].hiddenEarlier).toBe(25);
  });

  it('treats a reused frame id as a new call once the old frame ended', () => {
    const frame = (id: string, func: string) => ({ id, func, line: 1, locals: {} });
    const reused: TraceStep[] = [
      {
        i: 0,
        event: 'call',
        line: 1,
        func: 'f',
        stack: [frame('m', '<module>'), frame('x', 'f')],
        globals: {},
        stdoutLen: 0,
      },
      {
        i: 1,
        event: 'line',
        line: 2,
        func: '<module>',
        stack: [frame('m', '<module>')],
        globals: {},
        stdoutLen: 0,
      },
      {
        i: 2,
        event: 'call',
        line: 1,
        func: 'g',
        stack: [frame('m', '<module>'), frame('x', 'g')],
        globals: {},
        stdoutLen: 0,
      },
    ];
    const tree = callTreeAt(indexCallTree(reused), reused, 2);
    expect(tree.roots[0].children.map((node) => node.func)).toEqual(['f', 'g']);
  });
});
