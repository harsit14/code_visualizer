import { describe, expect, it } from 'vitest';
import { DEFAULT_EXAMPLE_ID } from '../examples/pythonExamples';
import { decodeShareHash, encodeShareState, SHARE_HASH_PREFIX } from './shareState';

describe('share state encoding', () => {
  it('round-trips code and example id through a URL hash', () => {
    const hash = encodeShareState({
      code: 'nums = [1, 2, 3]\nprint(nums)',
      exampleId: 'list-alias',
    });

    expect(hash.startsWith(SHARE_HASH_PREFIX)).toBe(true);
    expect(decodeShareHash(hash)).toEqual({
      code: 'nums = [1, 2, 3]\nprint(nums)',
      exampleId: 'list-alias',
    });
  });

  it('rejects malformed hashes', () => {
    expect(decodeShareHash('#missing')).toBeNull();
    expect(decodeShareHash(`${SHARE_HASH_PREFIX}bad-payload`)).toBeNull();
  });

  it('falls back when a shared example id is unknown', () => {
    const hash = encodeShareState({
      code: 'print("hello")',
      exampleId: 'unknown-example',
    });

    expect(decodeShareHash(hash)).toEqual({
      code: 'print("hello")',
      exampleId: DEFAULT_EXAMPLE_ID,
    });
  });
});
