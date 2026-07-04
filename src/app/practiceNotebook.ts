export type PracticeNotebookStatus = 'new' | 'practicing' | 'reviewed';

export type PracticeNotebook = {
  notes: string;
  patterns: string;
  status: PracticeNotebookStatus;
  updatedAt: number | null;
};

export type PracticeNotebookUpdate = Partial<Pick<PracticeNotebook, 'notes' | 'patterns' | 'status'>>;

const STORAGE_PREFIX = 'cv-practice-notebook-v1';
const STATUSES: PracticeNotebookStatus[] = ['new', 'practicing', 'reviewed'];

export const EMPTY_PRACTICE_NOTEBOOK: PracticeNotebook = {
  notes: '',
  patterns: '',
  status: 'new',
  updatedAt: null,
};

export function buildPracticeNotebookStorageKey(source: string, functionName: string): string {
  return `${STORAGE_PREFIX}:${hashSource(source)}:${encodeURIComponent(functionName)}`;
}

export function loadStoredPracticeNotebook(key: string): PracticeNotebook {
  try {
    const raw = window.localStorage.getItem(key);
    return normalizeNotebook(raw ? JSON.parse(raw) : null);
  } catch {
    return EMPTY_PRACTICE_NOTEBOOK;
  }
}

export function saveStoredPracticeNotebook(key: string, notebook: PracticeNotebook) {
  try {
    if (isEmptyNotebook(notebook)) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, JSON.stringify(notebook));
  } catch {
    /* local storage may be disabled or full */
  }
}

function normalizeNotebook(value: unknown): PracticeNotebook {
  if (!isRecord(value)) {
    return EMPTY_PRACTICE_NOTEBOOK;
  }
  return {
    notes: typeof value.notes === 'string' ? value.notes : '',
    patterns: typeof value.patterns === 'string' ? value.patterns : '',
    status: isNotebookStatus(value.status) ? value.status : 'new',
    updatedAt:
      typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt)
        ? value.updatedAt
        : null,
  };
}

function isEmptyNotebook(notebook: PracticeNotebook): boolean {
  return (
    notebook.notes.trim().length === 0 &&
    notebook.patterns.trim().length === 0 &&
    notebook.status === 'new'
  );
}

function isNotebookStatus(value: unknown): value is PracticeNotebookStatus {
  return typeof value === 'string' && STATUSES.includes(value as PracticeNotebookStatus);
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
