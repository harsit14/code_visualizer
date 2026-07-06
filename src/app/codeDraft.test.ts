// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadStoredCodeDraft, saveStoredCodeDraft } from './codeDraft';

const localStorageItems = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((key: string) => localStorageItems.get(key) ?? null),
  removeItem: vi.fn((key: string) => {
    localStorageItems.delete(key);
  }),
  setItem: vi.fn((key: string, value: string) => {
    localStorageItems.set(key, value);
  }),
};

vi.stubGlobal('localStorage', localStorageMock);

beforeEach(() => {
  localStorageItems.clear();
  localStorageMock.getItem.mockClear();
  localStorageMock.removeItem.mockClear();
  localStorageMock.setItem.mockClear();
});

describe('codeDraft storage', () => {
  it('round-trips a saved draft', () => {
    saveStoredCodeDraft('print("hi")', 'python');
    const draft = loadStoredCodeDraft();
    expect(draft?.code).toBe('print("hi")');
    expect(draft?.language).toBe('python');
    expect(draft?.savedAt).toBeTruthy();
  });

  it('returns null when nothing is stored', () => {
    expect(loadStoredCodeDraft()).toBeNull();
  });

  it('clears the draft when the code is empty', () => {
    saveStoredCodeDraft('const x = 1;', 'javascript');
    saveStoredCodeDraft('   \n', 'javascript');
    expect(loadStoredCodeDraft()).toBeNull();
  });

  it('keeps the previous draft when the new code is oversized', () => {
    saveStoredCodeDraft('keep me', 'python');
    saveStoredCodeDraft('x'.repeat(200_001), 'python');
    expect(loadStoredCodeDraft()?.code).toBe('keep me');
  });

  it('ignores malformed stored values', () => {
    localStorageItems.set('cv-code-draft-v1', 'not json');
    expect(loadStoredCodeDraft()).toBeNull();
    localStorageItems.set('cv-code-draft-v1', JSON.stringify({ language: 'python' }));
    expect(loadStoredCodeDraft()).toBeNull();
    localStorageItems.set('cv-code-draft-v1', JSON.stringify({ code: '   ' }));
    expect(loadStoredCodeDraft()).toBeNull();
  });

  it('falls back to python for unknown stored languages', () => {
    localStorageItems.set(
      'cv-code-draft-v1',
      JSON.stringify({ code: 'print(1)', language: 'ruby' }),
    );
    expect(loadStoredCodeDraft()?.language).toBe('python');
  });
});
