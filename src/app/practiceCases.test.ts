import { describe, expect, it } from 'vitest';
import type { EncodedValue, SessionResult, TraceStep } from '../engine/types';
import { summarizePracticeRun } from './practiceCases';

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
});
