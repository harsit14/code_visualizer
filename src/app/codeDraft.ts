/**
 * Local draft of the user's custom code. Saved while they type so switching
 * to an example, changing language, or reloading never loses typed work.
 * A single draft is kept: the most recently edited custom snippet.
 */
import type { Language } from '../engine/types';

const STORAGE_KEY = 'cv-code-draft-v1';
const MAX_DRAFT_CHARS = 100_000;
const LANGUAGES: Language[] = ['python', 'javascript', 'typescript'];

export type CodeDraft = {
  code: string;
  language: Language;
  savedAt: string;
};

export function loadStoredCodeDraft(): CodeDraft | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeCodeDraft(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Empty code clears the draft; oversized code keeps the previous draft. */
export function saveStoredCodeDraft(code: string, language: Language) {
  try {
    if (code.trim().length === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    if (code.length > MAX_DRAFT_CHARS) {
      return;
    }
    const draft: CodeDraft = { code, language, savedAt: new Date().toISOString() };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    /* local storage may be disabled or full */
  }
}

function normalizeCodeDraft(value: unknown): CodeDraft | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.code !== 'string' || record.code.trim().length === 0) {
    return null;
  }
  const language = LANGUAGES.includes(record.language as Language)
    ? (record.language as Language)
    : 'python';
  return {
    code: record.code,
    language,
    savedAt: typeof record.savedAt === 'string' ? record.savedAt : '',
  };
}
