import { describe, expect, it } from 'vitest';
import { didResetKeysChange } from './ErrorBoundary';

describe('didResetKeysChange', () => {
  it('detects changed reset keys', () => {
    expect(didResetKeysChange(['a', 1], ['a', 2])).toBe(true);
    expect(didResetKeysChange(['a'], ['a', 1])).toBe(true);
  });

  it('treats equivalent reset keys as unchanged', () => {
    const marker = {};
    expect(didResetKeysChange([marker, 1], [marker, 1])).toBe(false);
  });
});
