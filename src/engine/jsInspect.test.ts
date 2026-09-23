import { format } from 'node:util';
import { describe, expect, it } from 'vitest';
import { formatLogArgs, inspect } from './jsInspect';

class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
}
class Empty {}
class Stack<T> extends Array<T> {}

function circular() {
  const node: Record<string, unknown> = { name: 'root' };
  node.self = node;
  node.child = { parent: node, list: [node] };
  return node;
}

const nullProto = Object.assign(Object.create(null), { a: 1 });
const sparse = [1, , 3]; // eslint-disable-line no-sparse-arrays
const withExtra = Object.assign([1, 2], { label: 'x' });
const accessors = {
  get value() {
    return 1;
  },
  set value(_next: number) {},
  get onlyGet() {
    return 2;
  },
};

const cases: [string, unknown[]][] = [
  ['primitives', [1, -0, 1.5, NaN, Infinity, 10n, true, null, undefined, Symbol('s')]],
  ['plain strings', ['hello', 'world']],
  ['nested strings', [['a', "it's", 'say "hi"', 'both \' and "', 'line\nbreak\ttab']]],
  ['empty containers', [[], {}, new Map(), new Set(), new Empty()]],
  [
    'small arrays',
    [
      [1, 2, 3],
      ['x', 'y'],
      [
        [1, 2],
        [3, 4],
      ],
    ],
  ],
  ['objects', [{ a: 1, b: 'two', 'needs-quote': true, 3: 'num' }]],
  ['nested depth', [{ a: { b: { c: { d: { e: 1 } } } } }]],
  ['array depth', [[[[[1]]]]]],
  ['class instances', [new Point(1, 2), [new Point(3, 4)]]],
  [
    'maps and sets',
    [
      new Map<unknown, unknown>([
        ['a', 1],
        [2, { b: 3 }],
      ]),
      new Set([1, 'two', [3]]),
    ],
  ],
  ['long numeric array', [Array.from({ length: 30 }, (_, i) => i * 7)]],
  ['long string array', [Array.from({ length: 12 }, (_, i) => `item-${i}`)]],
  ['over 100 items', [Array.from({ length: 120 }, (_, i) => i)]],
  [
    'wide object',
    [Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`key${i}`, 'value '.repeat(3)]))],
  ],
  ['sparse and extra keys', [sparse, withExtra]],
  ['accessors', [accessors]],
  ['null prototype', [nullProto]],
  ['circular', [circular()]],
  ['functions', [function named() {}, () => 1, class Klass {}, class Sub extends Point {}]],
  ['dates and regexps', [new Date(0), new Date(Number.NaN), /a+b/gi]],
  ['typed arrays', [new Uint8Array([1, 2, 3]), new Float64Array(0)]],
  ['array subclass', [Stack.from([1, 2])]],
  ['boxed', [Object(1), Object('ab'), Object(true)]],
  ['format specifiers', ['%s is %d years and %i, %f', 'Ada', 36.5, '42.9', '1.5']],
  ['json and objects', ['%j %o %O', { a: [1] }, { b: 2 }, { c: 3 }]],
  ['percent escapes', ['100%% sure %s', 'yes', 'extra', 4]],
  ['unused specifier', ['%s and %s', 'only']],
  ['string with objects', ['state:', { i: 1 }, [2]]],
  ['matrix', [Array.from({ length: 4 }, (_, r) => Array.from({ length: 4 }, (_, c) => r * 4 + c))]],
  [
    'mixed deep structure',
    [
      {
        users: [
          { name: 'a', tags: ['x', 'y'] },
          { name: 'b', tags: [] },
        ],
        total: 2,
      },
    ],
  ],
];

describe('Node-compatible console formatting', () => {
  it.each(cases)('matches util.format for %s', (_label, args) => {
    expect(formatLogArgs(args)).toBe(format(...args));
  });

  it('prints symbol keys like current Node and browser consoles', () => {
    expect(formatLogArgs([{ [Symbol('k')]: 1, plain: 2 }])).toBe('{ plain: 2, Symbol(k): 1 }');
  });

  it('formats errors without leaking instrumented stack frames', () => {
    expect(inspect(new TypeError('bad'))).toBe('TypeError: bad');
    expect(inspect({ error: new Error('inner') })).toBe('{ error: [Error: inner] }');
  });

  it('never invokes getters while formatting', () => {
    let calls = 0;
    const value = {
      get danger() {
        calls += 1;
        return 1;
      },
    };
    expect(formatLogArgs([value])).toBe('{ danger: [Getter] }');
    expect(calls).toBe(0);
  });
});
