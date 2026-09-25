import { describe, expect, it } from 'vitest';
import { closestName, withNameSuggestion } from './nameSuggestions';

describe('closestName', () => {
  it('finds typos, transpositions and missing letters', () => {
    expect(closestName('lenght', ['length', 'left'])).toBe('length');
    expect(closestName('totl', ['total', 'tail'])).toBe('total');
    expect(closestName('defauldict', ['defaultdict', 'dict'])).toBe('defaultdict');
  });

  it('ignores distant, identical, internal and non-identifier names', () => {
    expect(closestName('i', ['j', 'k'])).toBeNull();
    expect(closestName('nums', ['nums'])).toBeNull();
    expect(closestName('trace', ['__trace'])).toBeNull();
    expect(closestName('ab', ['a-b'])).toBeNull();
  });
});

describe('withNameSuggestion', () => {
  it('only changes ReferenceError "is not defined" messages', () => {
    const names = () => ['total'];
    expect(
      withNameSuggestion({ type: 'ReferenceError', msg: 'totl is not defined' }, names),
    ).toEqual({ type: 'ReferenceError', msg: "totl is not defined. Did you mean 'total'?" });
    const typeError = { type: 'TypeError', msg: 'totl is not defined' };
    expect(withNameSuggestion(typeError, names)).toBe(typeError);
    const tdz = { type: 'ReferenceError', msg: "Cannot access 'total' before initialization" };
    expect(withNameSuggestion(tdz, names)).toBe(tdz);
  });
});
