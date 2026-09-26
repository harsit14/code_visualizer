// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRESENTATION_COLUMN_WEIGHTS, PRESENTATION_PANEL_VISIBILITY } from './layoutState';
import { readStoredPanelVisibility, useResizableLayout } from './useResizableLayout';

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

describe('presentation layout', () => {
  beforeEach(() => {
    localStorageItems.clear();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: localStorageMock,
    });
  });

  it('overrides panels and sizes while presenting and restores the user layout exactly', () => {
    localStorageItems.set('cv-column-weights-v1', JSON.stringify({ left: 2, center: 1, right: 3 }));
    localStorageItems.set('cv-panel-weights-v1', JSON.stringify({ code: 3, console: 0.5 }));
    const { result, rerender } = renderHook(
      ({ presentation }) => useResizableLayout(false, presentation),
      { initialProps: { presentation: null as typeof PRESENTATION_PANEL_VISIBILITY | null } },
    );
    act(() => {
      result.current.togglePanelVisibility('watch', true);
      result.current.togglePanelVisibility('callStack', false);
    });
    const before = {
      panels: result.current.panelVisibility,
      columns: result.current.columnWeights,
      weights: result.current.panelWeights,
      template: result.current.columnsTemplate(['left', 'center', 'right']),
      stored: Object.fromEntries(localStorageItems),
    };

    rerender({ presentation: PRESENTATION_PANEL_VISIBILITY });
    expect(result.current.panelVisibility).toEqual(PRESENTATION_PANEL_VISIBILITY);
    expect(result.current.columnWeights).toEqual(PRESENTATION_COLUMN_WEIGHTS);
    expect(result.current.panelWeights.code).toBe(1);
    // The workspace menu keeps describing the user's own layout meanwhile.
    expect(result.current.panelControls.find((panel) => panel.id === 'watch')?.visible).toBe(true);
    expect(Object.fromEntries(localStorageItems)).toEqual(before.stored);

    rerender({ presentation: null });
    expect(result.current.panelVisibility).toEqual(before.panels);
    expect(result.current.columnWeights).toEqual(before.columns);
    expect(result.current.panelWeights).toEqual(before.weights);
    expect(result.current.columnsTemplate(['left', 'center', 'right'])).toBe(before.template);
    expect(Object.fromEntries(localStorageItems)).toEqual(before.stored);
  });
});
