import { describe, expect, it } from 'vitest';
import {
  addTag,
  localDate,
  MAX_TAGS,
  normalizeTag,
  parseWorkspaceMeta,
  reviewDue,
  suggestTags,
  SUGGESTED_TAGS,
} from './workspaceTags';

describe('workspace tags', () => {
  it('normalizes case, spacing, hashes and common spellings', () => {
    expect(normalizeTag('  Sliding   Window ')).toBe('sliding window');
    expect(normalizeTag('#BFS')).toBe('bfs');
    expect(normalizeTag('Dynamic Programming')).toBe('dp');
    expect(normalizeTag('two-pointer')).toBe('two pointers');
    expect(normalizeTag('c++')).toBe('c++');
  });
  it('rejects empty, overlong and unprintable tags', () => {
    expect(normalizeTag('   ')).toBeNull();
    expect(normalizeTag('x'.repeat(33))).toBeNull();
    expect(normalizeTag('bad\u0000tag')).toBeNull();
    expect(normalizeTag('<script>')).toBeNull();
  });
  it('adds tags once and bounds the count', () => {
    expect(addTag(['dp'], 'DP')).toEqual({ tags: ['dp'], error: null });
    expect(addTag([], 'Heap').tags).toEqual(['heap']);
    const full = Array.from({ length: MAX_TAGS }, (_, i) => `tag ${i}`);
    expect(addTag(full, 'one more').error).toContain(`${MAX_TAGS} tags`);
    expect(addTag([], '!!').error).toContain('letters');
  });
  it('suggests notebook patterns first and hides applied tags', () => {
    const suggestions = suggestTags(['dp'], 'Uses a sliding window and breadth-first search');
    expect(suggestions.slice(0, 2)).toEqual(['sliding window', 'bfs']);
    expect(suggestions).not.toContain('dp');
    expect(suggestions).toHaveLength(SUGGESTED_TAGS.length - 1);
  });
});

describe('review state', () => {
  it('is due when flagged or when the review date has arrived', () => {
    const meta = { tags: [], needsReview: false, reviewBy: null };
    expect(reviewDue(meta, '2026-09-25')).toBe(false);
    expect(reviewDue({ ...meta, needsReview: true }, '2026-09-25')).toBe(true);
    expect(reviewDue({ ...meta, reviewBy: '2026-09-25' }, '2026-09-25')).toBe(true);
    expect(reviewDue({ ...meta, reviewBy: '2026-09-26' }, '2026-09-25')).toBe(false);
    expect(localDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
  it('validates untrusted metadata', () => {
    expect(
      parseWorkspaceMeta({ tags: ['BFS', 'bfs', 'Graph'], needsReview: true, reviewBy: null }),
    ).toEqual({ tags: ['bfs', 'graph'], needsReview: true, reviewBy: null });
    for (const bad of [
      null,
      { tags: 'dp', needsReview: false, reviewBy: null },
      { tags: [7], needsReview: false, reviewBy: null },
      { tags: Array(MAX_TAGS + 1).fill('dp'), needsReview: false, reviewBy: null },
      { tags: [], needsReview: 'yes', reviewBy: null },
      { tags: [], needsReview: false, reviewBy: '2026-02-30' },
      { tags: [], needsReview: false, reviewBy: 'tomorrow' },
    ]) {
      expect(() => parseWorkspaceMeta(bad)).toThrow();
    }
  });
});
