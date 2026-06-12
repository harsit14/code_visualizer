import { describe, expect, it } from 'vitest';
import { decodeShareHash, encodeShareState } from './shareState';

describe('share state', () => {
  it('round-trips code with metadata', () => {
    const state = {
      code: 'def f(nums):\n    return nums # ünïcode ✓',
      exampleId: 'two-sum',
      inputs: ['[2, 7, 11, 15]', '9'],
      seed: 42,
      functionName: 'Solution.twoSum',
    };
    expect(decodeShareHash(encodeShareState(state))).toEqual(state);
  });

  it('round-trips minimal state', () => {
    expect(decodeShareHash(encodeShareState({ code: 'x = 1' }))).toEqual({ code: 'x = 1' });
  });

  it('rejects unknown hashes', () => {
    expect(decodeShareHash('')).toBeNull();
    expect(decodeShareHash('#other=abc')).toBeNull();
    expect(decodeShareHash('#cv=!!!not-base64!!!')).toBeNull();
  });

  it('rejects payloads without code', () => {
    expect(decodeShareHash('#cv=' + btoa(JSON.stringify({ seed: 1 })))).toBeNull();
  });
});
