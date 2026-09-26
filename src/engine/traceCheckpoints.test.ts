import { describe, expect, it } from 'vitest';
import {
  checkpointCaptions,
  checkpointNavigation,
  MAX_CHECKPOINTS,
  moveCheckpoint,
  normalizeCheckpoints,
  toggleCheckpoint,
} from './traceCheckpoints';

const bookmarks = [
  { step: 2, note: 'enter loop' },
  { step: 5, note: 'swap' },
  { step: 9, note: '' },
];

describe('trace checkpoints', () => {
  it('keeps presenter order while dropping duplicates and unbookmarked steps', () => {
    expect(normalizeCheckpoints([9, 2, 9, 7, 5], bookmarks)).toEqual([9, 2, 5]);
    const many = Array.from({ length: MAX_CHECKPOINTS + 5 }, (_, step) => ({ step, note: '' }));
    expect(
      normalizeCheckpoints(
        many.map((bookmark) => bookmark.step),
        many,
      ),
    ).toHaveLength(MAX_CHECKPOINTS);
  });

  it('adds new checkpoints in trace order and removes existing ones', () => {
    expect(toggleCheckpoint([2, 9], 5)).toEqual([2, 5, 9]);
    expect(toggleCheckpoint([9, 2], 12)).toEqual([9, 2, 12]);
    expect(toggleCheckpoint([2, 5, 9], 5)).toEqual([2, 9]);
  });

  it('reorders checkpoints within bounds', () => {
    expect(moveCheckpoint([2, 5, 9], 9, -1)).toEqual([2, 9, 5]);
    expect(moveCheckpoint([2, 5, 9], 2, -1)).toEqual([2, 5, 9]);
    expect(moveCheckpoint([2, 5, 9], 9, 1)).toEqual([2, 5, 9]);
  });

  it('captions checkpoints with their bookmark notes', () => {
    expect(checkpointCaptions([9, 2, 4], bookmarks)).toEqual([
      { step: 9, note: '' },
      { step: 2, note: 'enter loop' },
    ]);
  });

  it('follows presenter order on a checkpoint and trace order between them', () => {
    const order = [9, 2, 5];
    expect(checkpointNavigation(order, 2)).toEqual({ current: 1, previous: 0, next: 2 });
    expect(checkpointNavigation(order, 9)).toEqual({ current: 0, previous: null, next: 1 });
    expect(checkpointNavigation(order, 5)).toEqual({ current: 2, previous: 1, next: null });
    // Step 3 sits between steps 2 and 5 of the trace.
    expect(checkpointNavigation(order, 3)).toEqual({ current: null, previous: 1, next: 2 });
    expect(checkpointNavigation(order, 0)).toEqual({ current: null, previous: null, next: 1 });
    expect(checkpointNavigation(order, 12)).toEqual({ current: null, previous: 0, next: null });
    expect(checkpointNavigation([], 3)).toEqual({ current: null, previous: null, next: null });
  });
});
