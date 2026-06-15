import { describe, expect, it } from 'vitest';
import { explainException } from './exceptionExplanations';

describe('explainException', () => {
  it('explains common Python runtime errors', () => {
    expect(explainException({ type: 'IndexError', msg: 'list index out of range' })?.title).toBe(
      'An index went outside the sequence.',
    );
    expect(explainException({ type: 'KeyError', msg: "'x'" })?.detail).toContain(
      'key that is not present',
    );
  });

  it('returns null for unknown exception types', () => {
    expect(explainException({ type: 'CustomError', msg: 'no hint' })).toBeNull();
    expect(explainException(null)).toBeNull();
  });
});
