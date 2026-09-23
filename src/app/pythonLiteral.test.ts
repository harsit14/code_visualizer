import { describe, expect, it } from 'vitest';
import { explainMismatch, parsePythonLiteral, pyEqual, pyRepr } from './pythonLiteral';

describe('parsePythonLiteral', () => {
  it.each([
    ['[1, 2, 3]', '[1, 2, 3]'],
    ['(1,)', '(1,)'],
    ['()', '()'],
    ['(1)', '1'],
    ["{'a': [1, (2, 3)], 'b': None}", "{'a': [1, (2, 3)], 'b': None}"],
    ['{1, 2}', '{1, 2}'],
    ['set()', 'set()'],
    ['True', 'True'],
    ['-3.5', '-3.5'],
    ['1e3', '1000.0'],
    ['0x1F', '31'],
    ['1_000', '1000'],
    ["'it\\'s'", '"it\'s"'],
    ['"tab\\there"', "'tab\\there'"],
    ["'a' 'b'", "'ab'"],
    ["b'raw'", "b'raw'"],
    ['[1, 2,]', '[1, 2]'],
    ['12345678901234567890123', '12345678901234567890123'],
  ])('parses %s', (input, repr) => {
    expect(pyRepr(parsePythonLiteral(input), 200)).toBe(repr);
  });

  it.each(['[1, 2', '{1: }', 'foo', '1 2', "'open"])('rejects %s', (input) => {
    expect(() => parsePythonLiteral(input)).toThrow();
  });

  it('compares with Python equality rules used by the assertions', () => {
    const eq = (a: string, b: string) => pyEqual(parsePythonLiteral(a), parsePythonLiteral(b));
    expect(eq('{1, 2}', '{2, 1}')).toBe(true);
    expect(eq("{'a': 1, 'b': 2}", "{'b': 2, 'a': 1}")).toBe(true);
    expect(eq('[1, 2]', '[2, 1]')).toBe(false);
    expect(eq('1', '1.0')).toBe(false);
    expect(eq('True', '1')).toBe(false);
    expect(eq('(1, 2)', '[1, 2]')).toBe(false);
  });
});

describe('explainMismatch', () => {
  it.each([
    ['[0, 1]', '[1, 0]', ['Same items in a different order.']],
    ['[1, 2, 3]', '[1, 2]', ['Expected 3 items, got 2.', 'Missing [2] = 3.']],
    ['[1, 5, 3]', '[1, 4, 3]', ['At [1]: expected 5, got 4 (off by 1, too low).']],
    ['[[1, 2], [3, 4]]', '[[1, 2], [3, 9]]', ['At [1][1]: expected 4, got 9.']],
    ["'a b'", "'ab'", ['Only whitespace differs (3 vs 2 characters).']],
    ["'Hello'", "'hello'", ['Only capitalization differs.']],
    ["'abcd'", "'abxd'", ['They first differ at index 2.']],
    ['0.3', '0.30000000000000004', ['floating-point rounding']],
    ['1', '1.0', ['The numbers are equal but one is an int and the other a float.']],
    ['[1, 2]', '(1, 2)', ['Expected a list but got a tuple with the same items.']],
    ['[1]', 'None', ['Check that every path returns a value.']],
    [
      "{'a': 1, 'b': 2}",
      "{'a': 3, 'c': 2}",
      ["At ['a']: expected 1, got 3", "Missing key 'b' (expected 2).", "Unexpected key 'c' = 2."],
    ],
    ['{1, 2, 3}', '{1, 4}', ['Missing 2, 3; unexpected 4.']],
  ])('explains %s vs %s', (expected, actual, fragments) => {
    const hints = explainMismatch(expected, actual);
    expect(hints.length).toBeGreaterThanOrEqual(fragments.length);
    fragments.forEach((fragment, index) => {
      const hint = fragments.length === 1 ? hints.join(' ') : hints[index];
      expect(hint).toContain(fragment);
    });
  });

  it('returns nothing for equal or unparseable values', () => {
    expect(explainMismatch('{1, 2}', '{2, 1}')).toEqual([]);
    expect(explainMismatch('[1', '[1]')).toEqual([]);
  });

  it('caps the number of hints', () => {
    expect(explainMismatch("{'a': 1, 'b': 2, 'c': 3, 'd': 4}", '{}')).toHaveLength(3);
  });
});
