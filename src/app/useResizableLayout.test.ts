// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readStoredPanelVisibility } from './useResizableLayout';

const localStorageItems = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((key: string) => localStorageItems.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => localStorageItems.set(key, value)),
};

describe('readStoredPanelVisibility', () => {
  beforeEach(() => {
    localStorageItems.clear();
    localStorageMock.getItem.mockClear();
    localStorageMock.setItem.mockClear();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: localStorageMock,
    });
  });

  it('enables contextual inputs for a new workspace', () => {
    expect(readStoredPanelVisibility().inputs).toBe(true);
  });

  it('reveals inputs while preserving other legacy layout choices', () => {
    localStorageItems.set(
      'cv-panel-visibility-v1',
      JSON.stringify({ code: false, inputs: false, callStack: false }),
    );

    expect(readStoredPanelVisibility()).toMatchObject({
      callStack: false,
      code: false,
      inputs: true,
    });
  });

  it('respects an explicit input choice after migration', () => {
    localStorageItems.set('cv-panel-visibility-v2', JSON.stringify({ inputs: false }));

    expect(readStoredPanelVisibility().inputs).toBe(false);
  });
});
