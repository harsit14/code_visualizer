import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { cspHash, sha256 } from './sha256';

describe('sha256', () => {
  it.each([
    '',
    'abc',
    'a'.repeat(55),
    'a'.repeat(56),
    'a'.repeat(64),
    'é☃  '.repeat(300),
    'x'.repeat(100_000),
  ])('matches Node for input of length %#', (text) => {
    expect(Buffer.from(sha256(text)).toString('hex')).toBe(
      createHash('sha256').update(text).digest('hex'),
    );
  });

  it('formats a CSP source expression', () => {
    expect(cspHash('abc')).toBe(`'sha256-${createHash('sha256').update('abc').digest('base64')}'`);
  });
});
