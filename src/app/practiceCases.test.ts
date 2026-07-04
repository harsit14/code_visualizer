import { describe, expect, it } from 'vitest';
import type { EncodedValue, SessionResult, TraceStep } from '../engine/types';
import { createEdgePracticeCases, summarizePracticeRun } from './practiceCases';

const num = (value: number): EncodedValue => ({ k: 'num', t: 'int', v: String(value) });

function result(returnValue: EncodedValue): SessionResult {
  const step: TraceStep = {
    event: 'return',
    func: 'solve',
    globals: {},
    i: 0,
    line: 1,
    stack: [],
    stdoutLen: 0,
    ret: returnValue,
  };
  return {
    analysis: null,
    durationMs: 4,
    error: null,
    mode: 'function',
    run: {
      exception: null,
      functionName: 'solve',
      inputs: [],
      memoryMb: 0.1,
      opCount: 1,
      returnValue,
      runtimeMs: 1,
      seed: null,
      setupError: null,
      stderr: '',
      stdout: '',
      steps: [step],
      truncated: false,
      truncationReason: null,
    },
    status: 'ok',
  };
}

describe('practiceCases', () => {
  it('compares expected values against visualizer-formatted return values', () => {
    const returnValue: EncodedValue = {
      id: 1,
      items: [num(0), num(1)],
      k: 'seq',
      len: 2,
      t: 'list',
      truncated: false,
    };

    expect(summarizePracticeRun(result(returnValue), '[0,1]').status).toBe('pass');
    expect(summarizePracticeRun(result(returnValue), '[1,0]').status).toBe('fail');
    expect(summarizePracticeRun(result(returnValue), '').status).toBe('ran');
  });

  it('creates a small edge-case set from inferred parameter types', () => {
    const cases = createEdgePracticeCases(
      {
        className: null,
        docstring: null,
        isGenerator: false,
        line: 1,
        name: 'two_sum',
        params: [
          { annotation: null, inferred: 'list[int]', name: 'nums', source: 'name' },
          { annotation: null, inferred: 'int', name: 'target', source: 'name' },
        ],
        qualname: 'two_sum',
        returns: null,
      },
      0,
    );

    expect(cases.map((testCase) => testCase.name)).toEqual([
      'Edge empty',
      'Edge single',
      'Edge mixed',
    ]);
    expect(cases.map((testCase) => testCase.inputs)).toEqual([
      ['[]', '0'],
      ['[1]', '1'],
      ['[1, 1, 2, -3]', '2'],
    ]);
  });
});
