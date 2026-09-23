import { format, inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { instrumentJavaScript, runJavaScriptTrace } from './jsTraceEngine';
import { runTypeScriptTrace } from './tsTrace';
import type { EncodedValue, TraceStep } from './types';

/** Runs the original program without instrumentation, as Node would print it. */
function runNative(source: string) {
  let stdout = '';
  let stderr = '';
  const shim = {
    log: (...args: unknown[]) => {
      stdout += `${format(...args)}\n`;
    },
    error: (...args: unknown[]) => {
      stderr += `${format(...args)}\n`;
    },
  };
  try {
    new Function('console', `"use strict";\n${source}`)(shim);
    return { stdout, stderr, error: null };
  } catch (error) {
    if (!(error instanceof Error)) {
      return { stdout, stderr, error: { type: 'Uncaught', msg: inspect(error) } };
    }
    return { stdout, stderr, error: { type: error.name, msg: error.message } };
  }
}

const corpus: Record<string, string> = {
  'console after array literal': 'const nums = [1, 2];\nconsole.log(nums.length);',
  'if/else branches':
    "const n = 1;\nif (n > 0) {\n  console.log('positive');\n} else {\n  console.log('negative');\n}",
  'single-line loop': 'let sum = 0;\nfor (let i = 0; i < 5; i++) sum += i;\nconsole.log(sum);',
  'recursive factorial':
    'function fact(n) {\n  if (n <= 1) return 1;\n  return n * fact(n - 1);\n}\nconsole.log(fact(5));',
  'multi-line literals':
    'const nums = [\n  1,\n  2,\n];\nconst obj = {\n  a: nums,\n  b: { c: "d" },\n};\nconsole.log(obj);',
  destructuring:
    'const [a, b = 5, ...rest] = [1, undefined, 3, 4];\nconst { x, y: z = 3, ...others } = { x: 1, w: 2 };\nconsole.log(a, b, rest, x, z, others);',
  closures:
    'function counter() {\n  let count = 0;\n  return () => ++count;\n}\nconst inc = counter();\ninc();\nconsole.log(inc(), inc());',
  classes: `class Animal {
  constructor(name) {
    this.name = name;
  }
  speak() {
    return \`\${this.name} makes a sound\`;
  }
}
class Dog extends Animal {
  static count = 0;
  #secret = 'bone';
  speak() {
    Dog.count++;
    return \`\${super.speak()} (woof)\`;
  }
  get upper() {
    return this.name.toUpperCase();
  }
  get secret() {
    return this.#secret;
  }
  static create() {
    return new Dog('rex');
  }
}
const d = Dog.create();
console.log(d.speak(), d.upper, d.secret, Dog.count, d);`,
  'labeled loops': `const found = [];
outer: for (let i = 0; i < 4; i++) {
  for (let j = 0; j < 4; j++) {
    if (j > i) continue outer;
    if (i === 3) break outer;
    found.push([i, j]);
  }
}
console.log(found);`,
  'switch fallthrough': `function kind(n) {
  let label = '';
  switch (n) {
    case 1:
      label += 'one ';
    case 2: {
      const extra = 'two';
      label += extra;
      break;
    }
    default:
      label = 'many';
  }
  return label;
}
console.log(kind(1), '|', kind(2), '|', kind(9));`,
  'try/catch/finally': `function risky(n) {
  try {
    if (n > 1) throw new RangeError('too big');
    return 'ok';
  } catch (e) {
    return e.name;
  } finally {
    console.log('finally', n);
  }
}
console.log(risky(1), risky(2));
try {
  null.x;
} catch {
  console.log('caught without binding');
}`,
  'array callbacks': `const people = [{ name: 'b', age: 30 }, { name: 'a', age: 25 }];
const sorted = [...people].sort((p, q) => p.age - q.age).map((p) => p.name);
const total = people.reduce((sum, p) => sum + p.age, 0);
console.log(sorted, total, people.filter(function (p) { return p.age > 26; }));`,
  'asi without semicolons': 'let a = 1\nlet b = a\n++b\nconst c = [a, b]\nconsole.log(c)',
  'loop variants': `let n = 0;
do {
  n++;
} while (n < 3);
const obj = { p: 1, q: 2 };
for (const key in obj) console.log(key, obj[key]);
for (const [k, v] of new Map([['m', 1]])) {
  console.log(k, v);
}
while (n > 0) n--;
console.log(n);`,
  'shadowing and tdz': `let x = 'outer';
{
  let x = 'inner';
  console.log(x);
}
function peek() {
  return typeof later;
}
let later = 1;
console.log(peek(), x);`,
  'nested throw': 'function a() {\n  b();\n}\nfunction b() {\n  null.x;\n}\na();',
  'templates and optional chaining':
    "const user = { profile: null };\nconst tag = (s, ...v) => s.raw.join('|') + v.length;\nconsole.log(`hi ${user.profile?.name ?? 'anon'}`, tag`a${1}b`, user?.missing?.());",
  'rest, spread, defaults':
    'function f(a, b = () => a * 2, ...more) {\n  return [a, b(), more.length];\n}\nconsole.log(f(2), f(1, undefined, 3, 4), Math.max(...[3, 9]));',
  'methods and this':
    'const acc = {\n  total: 0,\n  add(n) {\n    this.total += n;\n    return this;\n  },\n};\nacc.add(2).add(3);\nconsole.log(acc.total);',
  numbers: 'console.log(0.1 + 0.2, -0, 1e21, [1.5, -0], 2n ** 64n, NaN, 7 / 0);',
  unicode: "console.log('héllo', [...'👍a'], 'tab\\there');",
  'linked list': `class ListNode {
  constructor(val, next = null) {
    this.val = val;
    this.next = next;
  }
}
let head = new ListNode(1, new ListNode(2, new ListNode(3)));
let prev = null;
let curr = head;
while (curr) {
  const nxt = curr.next;
  curr.next = prev;
  prev = curr;
  curr = nxt;
}
console.log(prev.val, prev.next.val);`,
  'uncaught custom error': `class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}
function check(v) {
  if (v < 0) throw new ValidationError('negative: ' + v);
  return v;
}
console.log(check(1));
check(-1);`,
  'throw non-error': 'console.log("before");\nthrow "plain string";',
  'static blocks and getters': `class Config {
  static values;
  static {
    const base = [1, 2];
    Config.values = base.map((v) => v * 10);
  }
}
console.log(Config.values);`,
};

describe('JavaScript tracing preserves native behavior', () => {
  it.each(Object.entries(corpus))('%s', (_name, source) => {
    const native = runNative(source);
    const traced = runJavaScriptTrace(source, 'javascript');
    expect(traced.run?.truncated).toBe(false);
    expect(traced.run?.stdout).toBe(native.stdout);
    expect(traced.run?.stderr).toBe(native.stderr);
    if (native.error) {
      expect(traced.status).toBe('error');
      expect(traced.error).toMatchObject(native.error);
    } else {
      expect(traced.error).toBeNull();
      expect(traced.status).toBe('ok');
    }
  });
});

function lineSteps(steps: TraceStep[], line: number) {
  return steps.filter((step) => step.event === 'line' && step.line === line);
}

function num(value: string): EncodedValue {
  return { k: 'num', t: 'number', v: value };
}

describe('runJavaScriptTrace', () => {
  it('records before-execution line steps and a final state step', () => {
    const result = runJavaScriptTrace('let x = 1;\nx = 2;\nconst nums = [x, 5];', 'javascript');
    const steps = result.run!.steps;
    expect(steps.every((step) => step.phase === (step.event === 'line' ? 'before' : 'event'))).toBe(
      true,
    );
    expect(steps.map((step) => [step.event, step.line])).toEqual([
      ['line', 1],
      ['line', 2],
      ['line', 3],
      ['return', 3],
    ]);
    expect(steps[1].stack[0].locals.x).toEqual(num('1'));
    const final = steps.at(-1)!.stack[0];
    expect(final.func).toBe('<module>');
    expect(final.locals.x).toEqual(num('2'));
    expect(final.locals.nums?.k).toBe('seq');
  });

  it('traces every iteration of a single-line loop with its loop variable', () => {
    const result = runJavaScriptTrace(
      'let sum = 0;\nfor (let i = 0; i < 3; i++) sum += i;\nconsole.log(sum);',
      'javascript',
    );
    const iterations = lineSteps(result.run!.steps, 2).map((step) => step.stack[0].locals.i);
    expect(iterations).toEqual([undefined, num('0'), num('1'), num('2')]);
    expect(result.run!.steps.at(-1)!.stack[0].locals.sum).toEqual(num('3'));
  });

  it('records a real call stack with call, return and return values for recursion', () => {
    const result = runJavaScriptTrace(
      'function fact(n) {\n  if (n <= 1) return 1;\n  return n * fact(n - 1);\n}\nconst out = fact(4);',
      'javascript',
    );
    const steps = result.run!.steps;
    expect(Math.max(...steps.map((step) => step.stack.length))).toBe(5);
    const calls = steps.filter((step) => step.event === 'call');
    expect(calls.map((step) => step.stack.at(-1)!.locals.n)).toEqual(['4', '3', '2', '1'].map(num));
    expect(calls[0]).toMatchObject({ func: 'fact', line: 1, phase: 'event' });
    const returns = steps.filter((step) => step.event === 'return' && step.func === 'fact');
    expect(returns.map((step) => step.ret)).toEqual(['1', '2', '6', '24'].map(num));
    expect(returns[0].line).toBe(2);
    const deepest = steps.find((step) => step.stack.length === 5)!;
    expect(deepest.stack.map((frame) => frame.func)).toEqual([
      '<module>',
      'fact',
      'fact',
      'fact',
      'fact',
    ]);
    expect(deepest.stack[1].line).toBe(3);
    expect(steps.at(-1)!.stack[0].locals.out).toEqual(num('24'));
  });

  it('records implicit returns at the closing brace and method frames with this', () => {
    const result = runJavaScriptTrace(
      'class Box {\n  constructor(v) {\n    this.v = v;\n  }\n  bump() {\n    this.v++;\n  }\n}\nconst box = new Box(1);\nbox.bump();',
      'javascript',
    );
    const steps = result.run!.steps;
    const bumpCall = steps.find((step) => step.event === 'call' && step.func === 'bump')!;
    expect(bumpCall.stack.at(-1)!.qualname).toBe('Box.bump');
    expect(bumpCall.stack.at(-1)!.locals.this?.k).toBe('obj');
    const implicit = steps.find((step) => step.event === 'return' && step.func === 'bump')!;
    expect(implicit.line).toBe(7);
    expect(implicit.ret).toEqual({ k: 'repr', t: 'undefined', v: 'undefined' });
  });

  it('marks the failing statement, unwinds frames and reports the line', () => {
    const result = runJavaScriptTrace(
      'function a() {\n  return b();\n}\nfunction b() {\n  const x = 1;\n  null.boom;\n}\na();',
      'javascript',
    );
    expect(result.status).toBe('error');
    expect(result.error).toMatchObject({ type: 'TypeError', line: 8 });
    const exceptions = result.run!.steps.filter((step) => step.event === 'exception');
    expect(exceptions.map((step) => [step.func, step.line])).toEqual([
      ['b', 6],
      ['a', 2],
      ['<module>', 8],
    ]);
    expect(exceptions[0].stack.at(-1)!.locals.x).toEqual(num('1'));
    expect(result.run!.exception?.type).toBe('TypeError');
  });

  it('continues after caught exceptions', () => {
    const result = runJavaScriptTrace(
      'let status = "start";\ntry {\n  JSON.parse("{");\n} catch (error) {\n  status = error.name;\n}\nstatus += "!";',
      'javascript',
    );
    expect(result.status).toBe('ok');
    expect(result.run!.steps.at(-1)!.stack[0].locals.status).toMatchObject({ v: 'SyntaxError!' });
  });

  it('shows block-scoped values only while initialized and prefers inner bindings', () => {
    const result = runJavaScriptTrace(
      'let x = "outer";\n{\n  let x = "inner";\n  x += "!";\n}\nx += "?";',
      'javascript',
    );
    const steps = result.run!.steps;
    expect(lineSteps(steps, 3)[0].stack[0].locals.x).toBeUndefined();
    expect(lineSteps(steps, 4)[0].stack[0].locals.x).toMatchObject({ v: 'inner' });
    expect(lineSteps(steps, 6)[0].stack[0].locals.x).toMatchObject({ v: 'outer' });
  });

  it('captures nested mutations on every step with stable object identity', () => {
    const result = runJavaScriptTrace(
      'const root = { child: { count: 1 } };\nroot.child.count = 2;\nroot.child.self = root.child;',
      'javascript',
    );
    expect(result.status).toBe('ok');
    const roots = result
      .run!.steps.map((step) => step.stack[0].locals.root)
      .filter((value): value is EncodedValue => value !== undefined);
    const first = roots[0];
    const last = roots.at(-1)!;
    if (first.k !== 'obj' || last.k !== 'obj') throw new Error('Missing object snapshots');
    const before = first.attrs.child;
    const after = last.attrs.child;
    if (before.k !== 'obj' || after.k !== 'obj') throw new Error('Missing nested snapshots');
    expect(before.id).toBe(after.id);
    expect(before.attrs.count).toMatchObject({ v: '1' });
    expect(after.attrs.count).toMatchObject({ v: '2' });
    expect(after.attrs.self).toEqual({ k: 'ref', id: after.id });
  });

  it('keeps both aliases expanded unless they form an ancestor cycle', () => {
    const result = runJavaScriptTrace(
      'const child = { value: 1 };\nconst root = { a: child, b: child };\nchild.value = 2;',
      'javascript',
    );
    const root = result.run!.steps.at(-1)!.stack[0].locals.root;
    if (root.k !== 'obj' || root.attrs.a.k !== 'obj' || root.attrs.b.k !== 'obj')
      throw new Error('Missing alias state');
    expect(root.attrs.a.id).toBe(root.attrs.b.id);
    expect(root.attrs.b.attrs.value).toMatchObject({ v: '2' });
  });

  it('encodes trees, linked lists, sets, class instances and JS null', () => {
    const result = runJavaScriptTrace(
      `class TreeNode {
  constructor(val, left = null, right = null) {
    this.val = val;
    this.left = left;
    this.right = right;
  }
}
class ListNode {
  constructor(val, next = null) {
    this.val = val;
    this.next = next;
  }
}
class Point {
  constructor(x) {
    this.x = x;
  }
}
const tree = new TreeNode(2, new TreeNode(1), null);
const list = new ListNode(1, new ListNode(2));
const seen = new Set([1, 2]);
const point = new Point(3);
const empty = null;`,
      'javascript',
    );
    const locals = result.run!.steps.at(-1)!.stack[0].locals;
    expect(locals.tree).toMatchObject({ k: 'tree', val: num('2'), right: null });
    expect(locals.list).toMatchObject({ k: 'listnode', cyclic: false });
    if (locals.list.k !== 'listnode') throw new Error('Expected a linked list');
    expect(locals.list.nodes.map((node) => node.val)).toEqual([num('1'), num('2')]);
    expect(locals.seen).toMatchObject({ k: 'seq', t: 'Set', len: 2 });
    expect(locals.point).toMatchObject({ k: 'obj', t: 'Point', preview: 'Point {...}' });
    expect(locals.empty).toEqual({ k: 'repr', t: 'null', v: 'null' });
  });

  it('does not invoke accessors or record tracer-triggered proxy traps', () => {
    const result = runJavaScriptTrace(
      `const value = { get danger() { throw new Error("getter"); } };
const proxy = new Proxy({}, {
  ownKeys(target) {
    return Reflect.ownKeys(target);
  },
});
console.log(value, proxy);`,
      'javascript',
    );
    expect(result.status).toBe('ok');
    expect(result.run!.steps.some((step) => step.func === 'ownKeys')).toBe(false);
    expect(result.run!.stdout).toBe('{ danger: [Getter] } {}\n');
  });

  it('elides locals below the twelve most recent frames', () => {
    const result = runJavaScriptTrace(
      'function down(n) {\n  if (n === 0) return 0;\n  return down(n - 1);\n}\ndown(15);',
      'javascript',
    );
    const deepest = result.run!.steps.reduce((best, step) =>
      step.stack.length > best.stack.length ? step : best,
    );
    expect(deepest.stack).toHaveLength(17);
    expect(deepest.stack.filter((frame) => frame.elided)).toHaveLength(5);
    expect(deepest.stack.at(-1)!.locals.n).toEqual(num('0'));
  });

  it('writes console.error and console.warn to stderr', () => {
    const result = runJavaScriptTrace(
      'console.log("out");\nconsole.error("bad", { code: 1 });\nconsole.warn("careful");',
      'javascript',
    );
    expect(result.run!.stdout).toBe('out\n');
    expect(result.run!.stderr).toBe('bad { code: 1 }\ncareful\n');
  });

  it('bounds the trace and output while retaining a partial replay', () => {
    const result = runJavaScriptTrace('let n = 0;\nwhile (n < 5000) {\n  n++;\n}', 'javascript');
    expect(result.run!.truncated).toBe(true);
    expect(result.run!.steps.length).toBeLessThanOrEqual(3000);
    expect(result.run!.truncationReason).toContain('Trace limit');
    const output = runJavaScriptTrace('console.log("x".repeat(100001));', 'javascript');
    expect(output.run!.truncated).toBe(true);
    expect(output.run!.stdout.length).toBe(100000);
  });

  it('cannot be kept running by catching the trace limit', () => {
    const result = runJavaScriptTrace(
      'let n = 0;\nwhile (true) {\n  try {\n    n++;\n  } catch {}\n  try { n++; } catch ({ message }) {}\n}',
      'javascript',
    );
    expect(result.run!.truncated).toBe(true);
    expect(result.status).toBe('ok');
  });

  it('bounds cumulative snapshot size for wide nested data', () => {
    const result = runJavaScriptTrace(
      'const data = Array.from({length: 24}, () => Array(24).fill(1));\nfor (let i = 0; i < 500; i++) {\n data[0][0] = i;\n}',
      'javascript',
    );
    expect(result.run!.truncated).toBe(true);
    expect(result.run!.truncationReason).toContain('Snapshot size limit');
    expect(result.run!.steps.length).toBeLessThan(3000);
  });

  it('reports syntax errors with their source line before running anything', () => {
    const result = runJavaScriptTrace('let ok = 1;\nlet x = ;\n', 'javascript');
    expect(result.status).toBe('error');
    expect(result.run).toBeNull();
    expect(result.error).toMatchObject({ type: 'SyntaxError', line: 2 });
    expect(result.analysis?.diagnostics[0]).toMatchObject({ severity: 'error', line: 2 });
  });

  it.each([
    ['async function load() {}', 'Async functions', 1],
    ['const x = 1;\nfunction* gen() {}', 'Generator functions', 2],
    ['import fs from "fs";', 'Modules', 1],
    ['export const x = 1;', 'Modules', 1],
    ['const x = 1;\nawait x;', '`await`', 2],
    ['const __cv$t = 1;', 'reserved by the tracer', 1],
  ])('rejects unsupported code %j with a clear message', (source, message, line) => {
    const result = runJavaScriptTrace(source, 'javascript');
    expect(result.status).toBe('error');
    expect(result.error?.type).toBe('NotSupportedError');
    expect(result.error?.msg).toContain(message);
    expect(result.error?.line).toBe(line);
  });

  it('strips TypeScript annotations without breaking object literals', () => {
    const result = runTypeScriptTrace(
      `const nums: number[] = [2, 4];
let total: number = 0;
const item = { value: 2 };
function add(a: number, b?: number): number {
  return a + (b ?? 0);
}
for (const value of nums) {
  total = add(total, value);
}
console.log(total, item.value, (total as number) + 1);`,
    );
    expect(result.status).toBe('ok');
    expect(result.run?.stdout).toBe('6 2 7\n');
  });
});

describe('TypeScript without the transform', () => {
  it('fails clearly instead of parsing TypeScript as JavaScript', () => {
    const result = runJavaScriptTrace('let x: number = 1;', 'typescript');
    expect(result.status).toBe('error');
    expect(result.error?.msg).toContain('TypeScript transform');
  });
});

describe('instrumentJavaScript', () => {
  it('keeps user code on its original lines', () => {
    const source = 'let total = 0;\nfor (let i = 0; i < 2; i++) {\n  total += i;\n}';
    const instrumented = instrumentJavaScript(source);
    expect(instrumented.split('\n')).toHaveLength(source.split('\n').length + 1);
    expect(instrumented).toContain('__cv$.t(3,[["i",()=>i]]);total += i;');
  });
});
