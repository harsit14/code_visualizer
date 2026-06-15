import { describe, expect, it } from 'vitest';
import { DEFAULT_EXAMPLE_ID, examples, getExample } from './examples';

describe('examples', () => {
  it('includes LeetCode-style snippets without entry points', () => {
    const leetcode = examples.filter((example) => example.category === 'LeetCode style');
    expect(leetcode.length).toBeGreaterThanOrEqual(4);
    for (const example of leetcode) {
      expect(example.code).not.toContain('__main__');
      expect(example.code).not.toContain('print(');
    }
  });

  it('has a valid default example', () => {
    expect(getExample(DEFAULT_EXAMPLE_ID)).toBeDefined();
  });

  it('uses unique ids', () => {
    expect(new Set(examples.map((example) => example.id)).size).toBe(examples.length);
  });

  it('includes JavaScript and TypeScript examples', () => {
    expect(getExample('js-loop-accumulator')?.language).toBe('javascript');
    expect(getExample('ts-running-sum')?.language).toBe('typescript');
    expect(examples.every((example) => example.language)).toBe(true);
  });
});
