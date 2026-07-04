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

export function createEdgePracticeCases(
  activeFunction: FunctionInfo,
  startIndex: number,
): PracticeTestCase[] {
  const profiles = [
    { key: 'empty', label: 'Edge empty' },
    { key: 'single', label: 'Edge single' },
    { key: 'mixed', label: 'Edge mixed' },
  ] as const;

  return profiles.map((profile, profileIndex) => ({
    ...createPracticeTestCase(
      activeFunction,
      activeFunction.params.map((param) => literalForProfile(param, profile.key)),
      startIndex + profileIndex,
    ),
    name: profile.label,
  }));
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

function literalForProfile(
  param: FunctionInfo['params'][number],
  profile: 'empty' | 'mixed' | 'single',
): string {
  const inferred = param.inferred.toLowerCase();
  const name = param.name.toLowerCase();

  if (inferred.includes('tree') || name.includes('root')) {
    return profile === 'empty'
      ? 'tree([])'
      : profile === 'single'
        ? 'tree([1])'
        : 'tree([2, 1, 3])';
  }

  if (inferred.includes('listnode') || name.includes('head')) {
    return profile === 'empty'
      ? 'linked([])'
      : profile === 'single'
        ? 'linked([1])'
        : 'linked([1, 2, 3])';
  }

  if (inferred.includes('str') || name === 's' || name.includes('string')) {
    return profile === 'empty' ? "''" : profile === 'single' ? "'a'" : "'abba'";
  }

  if (inferred.includes('list') || name.endsWith('s') || name.includes('nums')) {
    return profile === 'empty' ? '[]' : profile === 'single' ? '[1]' : '[1, 1, 2, -3]';
  }

  if (inferred.includes('bool') || name.startsWith('is_')) {
    return profile === 'mixed' ? 'False' : 'True';
  }

  if (inferred.includes('float')) {
    return profile === 'empty' ? '0.0' : profile === 'single' ? '1.0' : '-1.5';
  }

  if (name === 'target') {
    return profile === 'empty' ? '0' : profile === 'single' ? '1' : '2';
  }

  if (name === 'k') {
    return profile === 'empty' ? '0' : '1';
  }

  return profile === 'empty' ? '0' : profile === 'single' ? '1' : '-1';
}
