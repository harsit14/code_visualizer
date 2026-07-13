import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COLUMN_WEIGHTS,
  DEFAULT_PANEL_VISIBILITY,
  FULL_PANEL_VISIBILITY,
  LEARN_PANEL_VISIBILITY,
  normalizePanelVisibility,
  normalizeWeights,
  pairPercentage,
} from './layoutState';

describe('layoutState', () => {
  it('normalizes missing panel visibility to defaults', () => {
    expect(normalizePanelVisibility({ code: false })).toEqual({
      ...DEFAULT_PANEL_VISIBILITY,
      code: false,
    });
  });

  it('ignores invalid visibility and weight values', () => {
    expect(normalizePanelVisibility({ data: 'nope' }).data).toBe(true);
    expect(normalizeWeights({ left: -1, center: 3 }, DEFAULT_COLUMN_WEIGHTS)).toEqual({
      ...DEFAULT_COLUMN_WEIGHTS,
      center: 3,
    });
  });

  it('separates the beginner default from the show-all preset', () => {
    expect(DEFAULT_PANEL_VISIBILITY).toMatchObject({
      code: true,
      data: true,
      variables: true,
      callStack: true,
      console: true,
      inputs: true,
      watch: false,
      explainer: false,
    });
    expect(Object.values(FULL_PANEL_VISIBILITY).every(Boolean)).toBe(true);
  });

  it('offers a focused learning preset without advanced analysis panels', () => {
    expect(LEARN_PANEL_VISIBILITY).toEqual({
      callStack: false,
      code: true,
      console: true,
      data: true,
      explainer: false,
      inputs: true,
      variables: true,
      watch: false,
    });
  });

  it('describes adjacent layout sizes as a percentage', () => {
    expect(pairPercentage(3, 1)).toBe(75);
    expect(pairPercentage(0, 0)).toBe(50);
  });
});
