import ts from 'typescript';
import { format, inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { runTypeScriptTrace } from './tsTrace';

/** Compiles with the TypeScript compiler and runs the result natively. */
function runWithTsc(source: string) {
  const js = ts
    .transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, useDefineForClassFields: true },
    })
    .outputText.replace(/^export \{\};?$/m, ''); // module marker left by `import type`
  let stdout = '';
  const shim = {
    log: (...args: unknown[]) => {
      stdout += `${format(...args)}\n`;
    },
  };
  try {
    new Function('console', `"use strict";\n${js}`)(shim);
    return { stdout, error: null };
  } catch (error) {
    if (!(error instanceof Error))
      return { stdout, error: { type: 'Uncaught', msg: inspect(error) } };
    return { stdout, error: { type: error.name, msg: error.message } };
  }
}

const corpus: Record<string, string> = {
  'interfaces and type aliases': `interface Point {
  x: number;
  y: number;
}
type Pair = [Point, Point];
type Id = string | number;
const pair: Pair = [{ x: 0, y: 0 }, { x: 3, y: 4 }];
const id: Id = 'segment';
const dist = (p: Pair): number => Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y);
console.log(id, dist(pair));`,
  generics: `function first<T>(items: T[]): T | undefined {
  return items[0];
}
const identity = <T,>(value: T): T => value;
class Stack<T> {
  private items: T[] = [];
  push(item: T): this {
    this.items.push(item);
    return this;
  }
  peek(): T | undefined {
    return this.items[this.items.length - 1];
  }
}
const stack = new Stack<number>().push(1).push(2);
console.log(first(['a', 'b']), identity<number>(5), stack.peek());`,
  enums: `enum Direction {
  Up,
  Down = 5,
  Left,
}
enum Label {
  Yes = 'yes',
  No = 'no',
}
console.log(Direction.Up, Direction.Left, Direction[5], Label.No);`,
  'classes with modifiers': `abstract class Shape {
  static created = 0;
  constructor(protected readonly name: string) {
    Shape.created++;
  }
  abstract area(): number;
  describe(): string {
    return \`\${this.name}: \${this.area().toFixed(1)}\`;
  }
}
class Circle extends Shape {
  #secret = 'pi';
  constructor(private radius: number) {
    super('circle');
  }
  area(): number {
    return Math.PI * this.radius ** 2;
  }
  get hint(): string {
    return this.#secret;
  }
}
const c = new Circle(2);
console.log(c.describe(), Shape.created, c.hint);`,
  'annotations everywhere': `let total!: number;
total = 0;
const values: readonly number[] = [3, 1, 2];
function add(a: number, b?: number, ...rest: number[]): number {
  return a + (b ?? 0) + rest.reduce((s: number, n: number) => s + n, 0);
}
const config = { retries: 3 } satisfies Record<string, number>;
const maybe: number | null = values.length > 0 ? values[0] : null;
total = add(maybe!, values[1] as number, 10, 20);
const sorted = [...values].sort((a, b) => a - b) as number[];
console.log(total, config.retries, sorted);`,
  'overloads, guards and declarations': `declare const injected: number | undefined;
function pad(value: string): string;
function pad(value: number): string;
function pad(value: string | number): string {
  return String(value).padStart(3, '0');
}
function isText(value: unknown): value is string {
  return typeof value === 'string';
}
type Keys = keyof { a: 1; b: 2 };
const key: Keys = 'b';
const mixed: unknown[] = [7, 'x'];
console.log(pad(7), pad('42'), mixed.filter(isText), key);`,
  'type-only imports vanish': `import type { Something } from './types';
const describe = (value: Something | number) => typeof value;
console.log(describe(1));`,
  'runtime errors keep their type': `function parse(text: string): number {
  const value = Number(text);
  if (Number.isNaN(value)) throw new RangeError(\`not a number: \${text}\`);
  return value;
}
console.log(parse('4'));
parse('four');`,
};

describe('TypeScript tracing matches the TypeScript compiler', () => {
  it.each(Object.entries(corpus))('%s', (_name, source) => {
    const expected = runWithTsc(source);
    const traced = runTypeScriptTrace(source);
    expect(traced.run?.stdout).toBe(expected.stdout);
    if (expected.error) {
      expect(traced.status).toBe('error');
      expect(traced.error).toMatchObject(expected.error);
    } else {
      expect(traced.error).toBeNull();
    }
  });

  it('traces statements on their original TypeScript lines', () => {
    const result = runTypeScriptTrace(`interface Item {
  name: string;
  price: number;
}
const items: Item[] = [
  { name: 'pen', price: 2 },
];
let sum: number = 0;
for (const item of items) {
  sum += item.price;
}`);
    const lines = result
      .run!.steps.filter((step) => step.event === 'line')
      .map((step) => step.line);
    expect(lines).toEqual([5, 8, 9, 9, 10]);
    expect(result.run!.steps.at(-1)!.stack[0].locals.sum).toMatchObject({ v: '2' });
  });

  it.each([
    ['namespace Util {\n  export const two = 2;\n}', 'namespaces', 1],
    ['const a = 1;\n@sealed\nclass A {}', 'Decorators', 2],
    ['export const x: number = 1;', 'Modules', 1],
  ])('rejects %j clearly', (source, message, line) => {
    const result = runTypeScriptTrace(source);
    expect(result.error).toMatchObject({ type: 'NotSupportedError', line });
    expect(result.error?.msg).toContain(message);
  });

  it('reports TypeScript syntax errors with their line', () => {
    const result = runTypeScriptTrace('const ok = 1;\nlet broken: number = ;');
    expect(result.error).toMatchObject({ type: 'SyntaxError', line: 2 });
  });
});
