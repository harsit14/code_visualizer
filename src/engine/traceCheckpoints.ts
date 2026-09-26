/**
 * Presentation checkpoints: bookmarked steps a presenter walks through in a
 * chosen order, each captioned by its bookmark note. Stored as step numbers
 * in presentation order; the notes stay on the bookmarks.
 */
import type { TraceBookmark } from './traceSearch';

export const MAX_CHECKPOINTS = 500;

export type Checkpoint = { step: number; note: string };

export type CheckpointNavigation = {
  /** Position of the current step in the list, or null between checkpoints. */
  current: number | null;
  previous: number | null;
  next: number | null;
};

/** Keeps the order, drops duplicates and anything that is not a bookmarked step. */
export function normalizeCheckpoints(
  checkpoints: readonly number[],
  bookmarks: readonly TraceBookmark[],
): number[] {
  const bookmarked = new Set(bookmarks.map((bookmark) => bookmark.step));
  const kept: number[] = [];
  for (const step of checkpoints) {
    if (bookmarked.has(step) && !kept.includes(step)) kept.push(step);
    if (kept.length === MAX_CHECKPOINTS) break;
  }
  return kept;
}

/** Removes a checkpoint, or adds one where it falls in trace order. */
export function toggleCheckpoint(checkpoints: readonly number[], step: number): number[] {
  if (checkpoints.includes(step)) return checkpoints.filter((item) => item !== step);
  const after = checkpoints.findIndex((item) => item > step);
  return after < 0
    ? [...checkpoints, step]
    : [...checkpoints.slice(0, after), step, ...checkpoints.slice(after)];
}

export function moveCheckpoint(
  checkpoints: readonly number[],
  step: number,
  direction: -1 | 1,
): number[] {
  const from = checkpoints.indexOf(step);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= checkpoints.length) return [...checkpoints];
  const moved = [...checkpoints];
  [moved[from], moved[to]] = [moved[to], moved[from]];
  return moved;
}

export function checkpointCaptions(
  checkpoints: readonly number[],
  bookmarks: readonly TraceBookmark[],
): Checkpoint[] {
  const notes = new Map(bookmarks.map((bookmark) => [bookmark.step, bookmark.note]));
  return checkpoints
    .filter((step) => notes.has(step))
    .map((step) => ({ step, note: notes.get(step) ?? '' }));
}

/**
 * On a checkpoint, previous/next follow the presenter's order. Between
 * checkpoints (after scrubbing or stepping) they are the nearest checkpoints
 * earlier and later in the trace. The standalone replay player mirrors this.
 */
export function checkpointNavigation(
  checkpoints: readonly number[],
  step: number,
): CheckpointNavigation {
  const current = checkpoints.indexOf(step);
  if (current >= 0) {
    return {
      current,
      previous: current > 0 ? current - 1 : null,
      next: current < checkpoints.length - 1 ? current + 1 : null,
    };
  }
  let previous: number | null = null;
  let next: number | null = null;
  checkpoints.forEach((item, index) => {
    if (item < step && (previous === null || item > checkpoints[previous])) previous = index;
    if (item > step && (next === null || item < checkpoints[next])) next = index;
  });
  return { current: null, previous, next };
}
