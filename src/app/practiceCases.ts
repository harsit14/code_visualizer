import { formatValue } from '../engine/trace';
import type { EngineError, FunctionInfo, SessionResult } from '../engine/types';

export type PracticeCaseStatus = 'idle' | 'running' | 'ran' | 'pass' | 'fail' | 'error';

export type PracticeTestCase = {
  id: string;
  name: string;
  inputs: string[];
  expected: string;
  actual: string | null;
  status: PracticeCaseStatus;
  error: string | null;
  runtimeMs: number | null;
  memoryMb: number | null;
};

export type PracticeTestCaseUpdate = Partial<
  Pick<PracticeTestCase, 'expected' | 'inputs' | 'name'>
>;

let practiceCaseCounter = 0;

export function createPracticeTestCase(
  activeFunction: FunctionInfo,
  inputs: readonly string[] | undefined,
  index: number,
): PracticeTestCase {
  const literals = activeFunction.params.map((_, paramIndex) => inputs?.[paramIndex] ?? '');
  return {
    id: `case-${Date.now()}-${++practiceCaseCounter}`,
    name: `Case ${index + 1}`,
    inputs: literals,
    expected: '',
    actual: null,
    status: 'idle',
    error: null,
    runtimeMs: null,
    memoryMb: null,
  };
}

export function summarizePracticeRun(
  result: SessionResult,
  expected: string,
): Pick<PracticeTestCase, 'actual' | 'error' | 'memoryMb' | 'runtimeMs' | 'status'> {
  const runError = result.run?.exception ?? result.run?.setupError ?? result.error ?? null;
  const actual = result.run?.returnValue ? formatValue(result.run.returnValue) : '';

  if (runError) {
    return {
      actual,
      error: formatEngineError(runError),
      memoryMb: result.run?.memoryMb ?? null,
      runtimeMs: result.run?.runtimeMs ?? null,
      status: 'error',
    };
  }

  const hasExpected = expected.trim().length > 0;
  return {
    actual,
    error: null,
    memoryMb: result.run?.memoryMb ?? null,
    runtimeMs: result.run?.runtimeMs ?? null,
    status: hasExpected ? (matchesExpected(actual, expected) ? 'pass' : 'fail') : 'ran',
  };
}

function matchesExpected(actual: string, expected: string): boolean {
  const trimmedActual = actual.trim();
  const trimmedExpected = expected.trim();
  return (
    trimmedActual === trimmedExpected ||
    normalizeComparable(trimmedActual) === normalizeComparable(trimmedExpected)
  );
}

function normalizeComparable(value: string): string {
  return value.replace(/\s+/g, '');
}

function formatEngineError(error: EngineError): string {
  return `${error.type}: ${error.msg}`;
}
