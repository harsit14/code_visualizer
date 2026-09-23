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
  it('uses a typed engine verdict instead of display equality', () => {
    const data = result(num(1));
    data.run!.assessment = { expected: '1', actualLiteral: '1', status: 'pass', message: null };
    expect(summarizePracticeRun(data, '1').status).toBe('pass');
    expect(summarizePracticeRun(data, '2').status).toBe('inconclusive');
    data.run!.assessment = { expected: '2', actualLiteral: '1', status: 'fail', message: null };
    expect(summarizePracticeRun(data, '2').status).toBe('fail');
  });

  it('cannot score legacy display-only traces or incomplete runs', () => {
    const data = result(num(1));
    expect(summarizePracticeRun(data, '1').status).toBe('inconclusive');
    expect(summarizePracticeRun(data, '').status).toBe('ran');
    data.run!.assessment = { expected: '1', actualLiteral: '1', status: 'pass', message: null };
    data.run!.truncated = true;
    expect(summarizePracticeRun(data, '1').status).toBe('inconclusive');
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
