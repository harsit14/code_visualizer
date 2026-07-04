import type { PracticeCaseStatus, PracticeTestCase } from './practiceCases';

const STORAGE_PREFIX = 'cv-practice-cases-v1';
const STATUSES: PracticeCaseStatus[] = ['idle', 'running', 'ran', 'pass', 'fail', 'error'];

export function buildPracticeCaseStorageKey(source: string, functionName: string): string {
  return `${STORAGE_PREFIX}:${hashSource(source)}:${encodeURIComponent(functionName)}`;
}

export function loadStoredPracticeCases(key: string, paramCount: number): PracticeTestCase[] {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((value, index) => normalizePracticeCase(value, index, paramCount))
      .filter((value): value is PracticeTestCase => value !== null);
  } catch {
    return [];
  }
}

export function saveStoredPracticeCases(key: string, testCases: readonly PracticeTestCase[]) {
  try {
    if (testCases.length === 0) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, JSON.stringify(testCases));
  } catch {
    /* local storage may be disabled or full */
  }
}

function normalizePracticeCase(
  value: unknown,
  index: number,
  paramCount: number,
): PracticeTestCase | null {
  if (!isRecord(value) || !Array.isArray(value.inputs)) {
    return null;
  }

  const inputs = value.inputs.slice(0, paramCount);
  if (!inputs.every((input) => typeof input === 'string')) {
    return null;
  }
  while (inputs.length < paramCount) {
    inputs.push('');
  }

  const status = isPracticeCaseStatus(value.status) ? value.status : 'idle';
  return {
    actual: typeof value.actual === 'string' ? value.actual : null,
    error: typeof value.error === 'string' ? value.error : null,
    expected: typeof value.expected === 'string' ? value.expected : '',
    id: typeof value.id === 'string' && value.id ? value.id : `stored-case-${index + 1}`,
    inputs,
    memoryMb: finiteNumberOrNull(value.memoryMb),
    name:
      typeof value.name === 'string' && value.name.trim().length > 0
        ? value.name
        : `Case ${index + 1}`,
    runtimeMs: finiteNumberOrNull(value.runtimeMs),
    status: status === 'running' ? 'idle' : status,
  };
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isPracticeCaseStatus(value: unknown): value is PracticeCaseStatus {
  return typeof value === 'string' && STATUSES.includes(value as PracticeCaseStatus);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hashSource(source: string): string {
  let hash = 5381;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 33) ^ source.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}
