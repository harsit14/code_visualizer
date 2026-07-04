// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EMPTY_PRACTICE_NOTEBOOK,
  buildPracticeNotebookStorageKey,
  loadStoredPracticeNotebook,
  saveStoredPracticeNotebook,
} from './practiceNotebook';

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

beforeEach(() => {
  localStorageItems.clear();
  localStorageMock.getItem.mockClear();
  localStorageMock.removeItem.mockClear();
  localStorageMock.setItem.mockClear();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: localStorageMock,
  });
});

describe('practiceNotebook', () => {
  it('loads a stored notebook for the code/function scope', () => {
    const key = buildPracticeNotebookStorageKey('def solve():\n    pass', 'solve');
    localStorageItems.set(
      key,
      JSON.stringify({
        notes: 'Watch the invariant.',
        patterns: 'two pointers, sorting',
        status: 'practicing',
        updatedAt: 123,
      }),
    );

    expect(loadStoredPracticeNotebook(key)).toEqual({
      notes: 'Watch the invariant.',
      patterns: 'two pointers, sorting',
      status: 'practicing',
      updatedAt: 123,
    });
  });

  it('removes empty notebooks instead of storing noise', () => {
    const key = buildPracticeNotebookStorageKey('def solve():\n    pass', 'solve');

    saveStoredPracticeNotebook(key, EMPTY_PRACTICE_NOTEBOOK);

    expect(localStorageMock.removeItem).toHaveBeenCalledWith(key);
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
  });
});
